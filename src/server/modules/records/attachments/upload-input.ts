import type { JobRecord } from '../../../jobs/state';
import type { AttachmentBinding, AttachmentParsePorts } from './flow';
import { z } from 'zod';
import { materialUploadRequestSchema } from '../../../../contracts/media';
import { attachmentVersionSchema } from './parse';

const id = z.string().min(1).max(200).regex(/\S/);
const validatedUploadSchema = z.strictObject({
  uploadId: id,
  recordCollectionId: id,
  originalId: id,
  originalVersionId: id,
  jobId: id.nullable(),
  purpose: z.enum(['audio', 'video', 'attachment', 'image']),
  filename: attachmentVersionSchema.shape.filename,
  accountId: id,
  quotaScope: id,
  target: materialUploadRequestSchema.shape.target,
  object: z.strictObject({
    objectKey: z.string().min(1).regex(/\S/),
    byteLength: attachmentVersionSchema.shape.byteLength,
    mediaType: attachmentVersionSchema.shape.mediaType,
    sha256: attachmentVersionSchema.shape.sha256,
    etag: z.string().min(1),
  }),
});
function bindingFrom(
  upload: z.infer<typeof validatedUploadSchema>,
  jobId: string,
): AttachmentBinding | null {
  if (
    upload.purpose === 'audio' ||
    upload.recordCollectionId !== upload.quotaScope
  )
    return null;
  return {
    purpose: upload.purpose,
    completedJobId: jobId,
    recordCollectionId: upload.recordCollectionId,
    accountId: upload.accountId,
    quotaScope: upload.quotaScope,
    target: upload.target,
    version: {
      mediaId: upload.uploadId,
      originalVersionId: upload.originalVersionId,
      filename: upload.filename,
      mediaType: upload.object.mediaType,
      byteLength: upload.object.byteLength,
      sha256: upload.object.sha256,
    },
  };
}

export interface ValidatedAttachmentInputOptions<C> {
  /** Bind native 873 readValidatedUploadInTransaction using THIS context.
   * Claim/completion must not start another transaction or reuse an earlier read. */
  readValidatedUploadInContext(
    context: C,
    reference: {
      uploadId: string;
      originalVersionId: string;
    },
  ): Promise<unknown>;
  /** Standalone fresh read before opening bytes outside the job transaction. */
  readValidatedUpload(reference: {
    uploadId: string;
    originalVersionId: string;
  }): Promise<unknown>;
  /** The parse job a material batch created for this staged upload, read in
   * THIS context; null when no current batch holds the upload. */
  stagedJob(
    context: C,
    reference: { uploadId: string; originalVersionId: string },
  ): Promise<string | null>;
  canProcess(context: C, binding: AttachmentBinding): Promise<boolean>;
  openObject(
    objectKey: string,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
}
export function createValidatedAttachmentInput<C>(
  options: ValidatedAttachmentInputOptions<C>,
): Pick<AttachmentParsePorts<C>, 'loadAuthorizedAttachment' | 'open'> {
  return {
    loadAuthorizedAttachment: async (context: C, job: JobRecord) => {
      const upload = validatedUploadSchema.safeParse(
        await options.readValidatedUploadInContext(context, {
          uploadId: job.resourceId,
          originalVersionId: job.inputVersion,
        }),
      );
      if (
        !upload.success ||
        upload.data.uploadId !== job.resourceId ||
        upload.data.originalVersionId !== job.inputVersion
      )
        return null;
      // Dispatched uploads carry their job; staged ones are bound by a batch.
      const jobId =
        upload.data.jobId ??
        (upload.data.target.kind === 'unassigned'
          ? await options.stagedJob(context, {
              uploadId: upload.data.uploadId,
              originalVersionId: upload.data.originalVersionId,
            })
          : null);
      if (jobId !== job.jobId) return null;
      const binding = bindingFrom(upload.data, jobId);
      return binding && (await options.canProcess(context, binding))
        ? binding
        : null;
    },
    open: async (binding: AttachmentBinding, signal?: AbortSignal) => {
      const upload = validatedUploadSchema.safeParse(
        await options.readValidatedUpload({
          uploadId: binding.version.mediaId,
          originalVersionId: binding.version.originalVersionId,
        }),
      );
      if (
        !upload.success ||
        JSON.stringify(bindingFrom(upload.data, binding.completedJobId)) !==
          JSON.stringify(binding)
      )
        throw new Error('Attachment input changed');
      return options.openObject(upload.data.object.objectKey, signal);
    },
  };
}
