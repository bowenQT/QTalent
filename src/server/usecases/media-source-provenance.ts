import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '../db/client';
import type { TalentKind, TalentSubject } from '../authz/talent';
import type { StoredArrangeInput } from '../modules/records/arrange/input-state/schema';
import { mediaRecordOriginalInputSchema } from '../modules/records/arrange/input-state/original-input';
import { mediaMaterials } from '../modules/records/material-review/schema';
import {
  uploadIntents,
  uploadObjects,
} from '../modules/records/uploads/schema';
import { materialParses, originalVersions } from '../modules/records/schema';
import {
  readMaterialParse,
  MaterialStoreError,
} from '../modules/records/material-sources/store';
import { auditEvents } from '../platform/audit/schema';
import type { MaterialSourceReference } from '../../contracts/sources';

const id = z.string().min(1);
const kind = z.enum([
  'person',
  'evaluation',
  'restricted-evaluation',
  'confirmed-score',
  'quadrant',
  'management-observation',
  'change',
  'performance',
  'ai-inference',
]);
export const capturedMediaScopeSchema = z.strictObject({
  subjects: z
    .array(
      z.strictObject({
        personId: id,
        evaluationNodeId: id,
        cohortId: z.string().nullable(),
      }),
    )
    .min(1),
  kind,
  requiredKinds: z.array(kind),
  occurredOn: z.iso.date(),
});
export type MediaSourceProvenance = {
  inputId: string;
  inputVersion: string;
  materialId: string;
  materialRevision: number;
  captureAuditId: string;
  originalId: string;
  originalVersionId: string;
  parseVersionId: string;
  reference: MaterialSourceReference;
  sourceDigest: string;
  subjects: TalentSubject[];
  kind: TalentKind;
  requiredKinds: TalentKind[];
  occurredOn: string;
};
export function mediaSourceDigest(
  parseVersionId: string,
  reference: MaterialSourceReference,
  text: string,
) {
  return createHash('sha256')
    .update(JSON.stringify([parseVersionId, reference, text]))
    .digest('hex');
}

/** Native facts only, not grants. The caller supplies the COMPLETE intake rows
 * read in this transaction. Scope must already have been captured by a trusted
 * producer; this reader never creates a capture, infers names or uses uploader
 * identity as source scope. Unknown anywhere on the same original stays unknown.
 * Historical captures remain restrictions after undo, release or supersession. */
export async function readMediaSourceProvenance(
  tx: Transaction,
  inputs: readonly StoredArrangeInput[],
): Promise<MediaSourceProvenance[]> {
  const materials = await tx.select().from(mediaMaterials);
  if (!materials.length) return [];
  const uploads = await tx.select().from(uploadIntents);
  const objects = await tx.select().from(uploadObjects);
  const versions = await tx.select().from(originalVersions);
  const parses = await tx.select().from(materialParses);
  const captures = await tx
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, 'material.capture'));
  const result: MediaSourceProvenance[] = [];
  const parseCache = new Map<
    string,
    Awaited<ReturnType<typeof readMaterialParse>>
  >();
  for (const material of materials) {
    const input = inputs.find(
      (row) =>
        row.id === material.inputId &&
        row.inputVersion === material.inputVersion,
    );
    const originalInput = mediaRecordOriginalInputSchema.safeParse(
      input?.originalInput,
    );
    if (
      !input ||
      input.origin !== 'attachment' ||
      !input.batchId ||
      !input.evaluationNodeId ||
      !input.boundAt ||
      !input.occurredOn ||
      !originalInput.success ||
      !originalInput.data.materialIds.includes(material.id)
    )
      continue;
    const upload = uploads.find((row) => row.id === material.uploadId);
    const object = objects.find(
      (row) =>
        row.uploadId === material.uploadId &&
        row.originalVersionId === material.originalVersionId,
    );
    const version = versions.find(
      (row) => row.id === material.originalVersionId,
    );
    if (
      !upload ||
      !object ||
      !version ||
      upload.recordCollectionId !== material.recordCollectionId ||
      upload.completed?.originalVersionId !== material.originalVersionId ||
      upload.completed.originalId !== version.originalId ||
      version.contentDigest !== object.sha256
    )
      continue;
    const related = materials.filter(
      (row) => row.originalVersionId === material.originalVersionId,
    );
    const scopes: z.infer<typeof capturedMediaScopeSchema>[] = [];
    for (const historical of related) {
      const scope = capturedMediaScopeSchema.safeParse(historical.intakeScope);
      if (
        !scope.success ||
        !historical.scopeAuditId ||
        !captures.some(
          (audit) =>
            audit.id === historical.scopeAuditId &&
            audit.resourceId === historical.id,
        )
      )
        break;
      scopes.push(scope.data);
    }
    if (scopes.length !== related.length || !material.scopeAuditId) continue;
    const localScope = capturedMediaScopeSchema.parse(material.intakeScope);
    const matching = parses.filter(
      (row) =>
        row.jobId === material.parseJobId &&
        row.originalVersionId === material.originalVersionId,
    );
    if (matching.length !== 1) continue;
    const parse = matching[0]!;
    let canonical: Awaited<ReturnType<typeof readMaterialParse>>;
    try {
      if (!parseCache.has(parse.id))
        parseCache.set(parse.id, await readMaterialParse(tx, parse.id));
      canonical = parseCache.get(parse.id)!;
    } catch (error) {
      if (
        error instanceof MaterialStoreError &&
        error.code !== 'storage_unavailable'
      )
        continue;
      throw error;
    }
    if (
      !canonical ||
      canonical.jobId !== material.parseJobId ||
      canonical.binding.originalVersionId !== material.originalVersionId ||
      canonical.fragments.some(
        (fragment) =>
          fragment.sourceCategory !== 'original' ||
          !['document', 'pdf'].includes(fragment.location.kind),
      )
    )
      continue;
    const subjects = [
      ...new Map(
        scopes
          .flatMap((scope) => scope.subjects)
          .map((subject) => [JSON.stringify(subject), subject]),
      ).values(),
    ];
    const requiredKinds = [
      ...new Set(
        scopes.flatMap((scope) => [scope.kind, ...scope.requiredKinds]),
      ),
    ].filter((value) => value !== localScope.kind);
    for (const source of canonical.fragments) {
      const reference = {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      };
      result.push({
        inputId: input.id,
        inputVersion: input.inputVersion,
        materialId: material.id,
        materialRevision: material.revision,
        captureAuditId: material.scopeAuditId,
        originalId: version.originalId,
        originalVersionId: version.id,
        parseVersionId: parse.id,
        reference,
        sourceDigest: mediaSourceDigest(parse.id, reference, source.excerpt),
        subjects,
        kind: localScope.kind,
        requiredKinds,
        occurredOn: localScope.occurredOn,
      });
    }
  }
  return result;
}
