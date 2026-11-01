import { isDeepStrictEqual } from 'node:util';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../../../db/client';
import { jobSnapshots } from '../../../jobs/schema';
import {
  attachmentBindingSchema,
  attachmentJobResultSchema,
} from '../attachments/flow';
import { MATERIAL_PDF_DECODER_VERSION } from '../attachments/document-protocol';
import { readValidatedUploadInTransaction } from '../uploads/handoff-transaction';
import { MaterialProjectionError, projectAttachmentPdf } from './projection';
import { MaterialStoreError, writeMaterialParse } from './store';

const provenanceSchema = z.discriminatedUnion('sourceCategory', [
  z.strictObject({ sourceCategory: z.literal('original'), demo: z.boolean() }),
  z.strictObject({
    sourceCategory: z.literal('historical_evaluation'),
    evaluationKind: z.literal('interview'),
    demo: z.boolean(),
  }),
]);

/** Concrete saveParse adapter for the explicit PDF page-text producer only.
 * Call AFTER current complete-source/write authorization in runAttachmentParse's
 * completion transaction. Neither archived upload facts nor provenance grant
 * permission. The caller still owns classification, enqueue and job commit. */
export async function saveAttachmentPdf(
  tx: Transaction,
  bindingInput: unknown,
  parsed: unknown,
  serverProvenance: unknown,
): Promise<'created' | 'existing'> {
  try {
    const binding = attachmentBindingSchema.parse(bindingInput);
    const provenance = provenanceSchema.parse(serverProvenance);
    const [job] = await tx
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, binding.completedJobId))
      .for('update');
    const result = attachmentJobResultSchema.safeParse(job?.result);
    if (
      !job ||
      job.kind !== 'media' ||
      job.resourceId !== binding.version.mediaId ||
      job.inputVersion !== binding.version.originalVersionId ||
      !['running', 'partial'].includes(job.status) ||
      job.cancelRequestedAt !== null ||
      !result.success ||
      result.data.stage !== 'parsing' ||
      result.data.mediaId !== job.resourceId
    )
      throw new MaterialStoreError('material_conflict');
    // Same RC transaction and collection lock as completion; no independent read.
    const upload = await readValidatedUploadInTransaction(tx, {
      uploadId: binding.version.mediaId,
      originalVersionId: binding.version.originalVersionId,
    });
    if (
      !upload ||
      upload.purpose !== 'attachment' ||
      upload.jobId !== job.jobId ||
      upload.accountId !== binding.accountId ||
      upload.recordCollectionId !== binding.recordCollectionId ||
      upload.quotaScope !== binding.quotaScope ||
      !isDeepStrictEqual(upload.target, binding.target) ||
      upload.filename !== binding.version.filename ||
      upload.object.mediaType !== 'application/pdf' ||
      binding.version.mediaType !== upload.object.mediaType ||
      upload.object.byteLength !== binding.version.byteLength ||
      upload.object.sha256 !== binding.version.sha256
    )
      throw new MaterialStoreError('material_conflict');
    const identity = z
      .object({ parseVersionId: z.string().min(1) })
      .parse(parsed);
    const projected = projectAttachmentPdf(
      parsed,
      {
        parseVersionId: identity.parseVersionId,
        originalVersionId: upload.originalVersionId,
        contentDigest: upload.object.sha256,
        parserVersion: `pdf:${MATERIAL_PDF_DECODER_VERSION}`,
        projectionVersion: 'pdf-page-text-v1',
      },
      provenance,
    );
    return await writeMaterialParse(
      tx,
      {
        binding: projected.binding,
        pages: projected.pages.map(({ page, text }) => ({ page, text })),
        fragments: projected.fragments,
      },
      {
        jobId: job.jobId,
        attempt: job.attempt,
        expectedRevision: job.revision,
        inputVersion: job.inputVersion,
      },
    );
  } catch (error) {
    if (error instanceof MaterialStoreError) throw error;
    throw new MaterialStoreError(
      error instanceof z.ZodError || error instanceof MaterialProjectionError
        ? 'invalid_material_parse'
        : 'storage_unavailable',
    );
  }
}
