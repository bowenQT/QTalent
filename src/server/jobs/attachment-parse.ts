import type { PgBoss } from 'pg-boss';
import type { JobPolicy } from './service';
import type { AttachmentPolicyPorts } from '../modules/records/attachments/flow';
export const attachmentParseQueue = 'attachment-parse';
export function createAttachmentParsePolicy<C>(
  _ports: AttachmentPolicyPorts<C>,
): JobPolicy<C> {
  throw new Error('not implemented');
}
export async function registerAttachmentParseJob(
  _boss: PgBoss,
  _run: (payload: unknown) => Promise<unknown>,
): Promise<void> {
  throw new Error('not implemented');
}
