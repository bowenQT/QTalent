import type { JobStore } from '../jobs/service';
import type { AttachmentParsePorts } from '../modules/records/attachments/flow';
import type { ParseAttachmentInput } from '../modules/records/attachments';

export type AttachmentRunOutcome = {
  status:
    'parsed' | 'unsupported' | 'failed' | 'cancelled' | 'ignored' | 'forbidden';
};
export interface AttachmentRunOptions {
  limits: ParseAttachmentInput['limits'];
  decoders?: ParseAttachmentInput['decoders'];
  signal?: AbortSignal;
  now: () => string;
}
export async function runAttachmentParse<C>(
  _store: JobStore<C>,
  _ports: AttachmentParsePorts<C>,
  _payload: unknown,
  _options: AttachmentRunOptions,
): Promise<AttachmentRunOutcome> {
  throw new Error('not implemented');
}
