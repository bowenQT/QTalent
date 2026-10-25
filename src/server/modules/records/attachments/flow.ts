import type { JobCommand } from '../../../../contracts/jobs';
import type { UploadRequest } from '../../../../contracts/media';
import type {
  SourceReadInput,
  SourceReference,
} from '../../../../contracts/sources';
import type { JobRecord } from '../../../jobs/state';
import type { AttachmentVersion, ParsedAttachment } from './types';

export interface AttachmentBinding {
  purpose: 'attachment';
  completedJobId: string;
  accountId: string;
  quotaScope: string;
  target: UploadRequest['target'];
  version: AttachmentVersion;
}
export interface ArrangeAttachmentRequest {
  mediaId: string;
  parseVersionId: string;
  originalVersionId: string;
  accountId: string;
  target: UploadRequest['target'];
  sources: SourceReference[];
}
export interface AttachmentParsePorts<C> {
  /** 873 persisted binding + CURRENT record write permission. Not the public
   * original reader, which cannot authorize an unparsed, unclassified version.
   */
  loadAuthorizedAttachment(
    context: C,
    job: JobRecord,
  ): Promise<AttachmentBinding | null>;
  open(
    binding: AttachmentBinding,
    signal?: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
  /** Same context/transaction as job save and enqueue. Existing must compare the
   * entire immutable bundle, never silently accept a same-id/different-content row.
   */
  saveParse(
    context: C,
    binding: AttachmentBinding,
    parsed: ParsedAttachment,
  ): Promise<'created' | 'existing'>;
  /** 845 enqueue only, using its trusted source loader later; no model call here. */
  enqueueArrange(context: C, request: ArrangeAttachmentRequest): Promise<void>;
}
export interface AttachmentPolicyPorts<C> {
  /** Verify attachment purpose/binding and CURRENT requester/action permissions. */
  can(
    context: C,
    requesterAccountId: string,
    job: JobRecord,
    action: 'read' | JobCommand['action'],
  ): Promise<boolean>;
  inputVersion(context: C, job: JobRecord): Promise<string | null>;
  /** 837/873 current filtered and classified sources, never uploader-based access. */
  visibleSources(
    context: C,
    requesterAccountId: string,
    job: JobRecord,
  ): Promise<SourceReadInput[]>;
  enqueue(
    context: C,
    job: JobRecord,
    action: JobCommand['action'],
  ): Promise<void>;
}
