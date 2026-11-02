import type { Transaction } from '../../db/client';
import { recordAudit } from '../../platform/audit';
import type { EntryAudit } from './context';
/** Pass directly as EntryTransactionPorts<Transaction>.audit. The tool owns the
 * outer transaction; this never commits independently or loses channel/version.
 */
export async function recordEntryAudit(
  tx: Transaction,
  event: EntryAudit,
): Promise<void> {
  await recordAudit(tx, {
    actorId: event.actorId,
    action: event.action,
    resourceId: event.resourceId,
    metadata: { channel: event.channel, revision: event.revision },
  });
}
