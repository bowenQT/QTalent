import type { JobRecord } from '../../../jobs/state';
import type { AttachmentBinding, AttachmentParsePorts } from './flow';
import { z } from 'zod';
import { uploadRequestSchema } from '../../../../contracts/media';
import { attachmentVersionSchema } from './parse';

const id = z.string().min(1).max(200).regex(/\S/);
const validatedUploadSchema = z.strictObject({
  uploadId: id,
  recordCollectionId: id,
  originalId: id,
  originalVersionId: id,
  jobId: id,
  purpose: z.enum(['audio', 'attachment']),
  filename: attachmentVersionSchema.shape.filename,
  accountId: id,
  quotaScope: id,
  target: uploadRequestSchema.shape.target,
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
): AttachmentBinding | null {
  if (
    upload.purpose !== 'attachment' ||
    upload.recordCollectionId !== upload.quotaScope
  )
    return null;
  return {
    purpose: 'attachment',
    completedJobId: upload.jobId,
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
        upload.data.jobId !== job.jobId ||
        upload.data.uploadId !== job.resourceId ||
        upload.data.originalVersionId !== job.inputVersion
      )
        return null;
      const binding = bindingFrom(upload.data);
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
        JSON.stringify(bindingFrom(upload.data)) !== JSON.stringify(binding)
      )
        throw new Error('Attachment input changed');
      return options.openObject(upload.data.object.objectKey, signal);
    },
  };
}
