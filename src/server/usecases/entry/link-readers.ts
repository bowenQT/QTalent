import { eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { canReadDemand } from '../../modules/staffing/demand/policy';
import { demandRoots } from '../../modules/staffing/demand/schema';
import type { createRecordBatchArrangeRequests } from '../record-batch-arrange-requests';
import type { EntryLinkReader, EntryLinkResource } from './deep-links';

type BatchReader = Pick<
  ReturnType<typeof createRecordBatchArrangeRequests>,
  'readBatchInTransaction'
>;

/** Real object readers for ordinary deep links, bound to the account the
 * request already verified. Read-only: nothing here creates or enqueues.
 * - staffing_demand: the root row under FOR SHARE, so its revision holds until
 *   commit; the demand worker locks job → root and this holds no job lock.
 * - material_batch: readBatchInTransaction (intake SHARE, then the job row).
 *   This transaction never calls createInTransaction, so no SHARE is upgraded
 *   to the intake writer lock and it cannot cycle with the arrange runner.
 */
export function createEntryLinkReaders(input: {
  accountId: string;
  records: BatchReader;
}): EntryLinkReader<Transaction> {
  const root = async (tx: Transaction, id: string) => {
    const [row] = await tx
      .select({
        id: demandRoots.id,
        projectId: demandRoots.projectId,
        initiatorAccountId: demandRoots.initiatorAccountId,
        revision: demandRoots.currentRevision,
      })
      .from(demandRoots)
      .where(eq(demandRoots.id, id))
      .for('share');
    return row ?? null;
  };
  // Creator-scoped native read; anything but success is "not visible".
  const batch = async (tx: Transaction, id: string) => {
    const read = await input.records.readBatchInTransaction(
      tx,
      input.accountId,
      { batchId: id },
    );
    return read.status === 'success' ? read.result : null;
  };
  const same = (resource: EntryLinkResource, revision: number) =>
    revision === resource.revision;
  return {
    async load(tx, target) {
      if (target.kind === 'staffing_demand') {
        const row = await root(tx, target.id);
        // Revision 0 is a demand still generating; no link names it.
        return row && row.revision > 0
          ? { kind: target.kind, id: row.id, revision: row.revision }
          : null;
      }
      const receipt = await batch(tx, target.id);
      return receipt
        ? { kind: target.kind, id: receipt.batchId, revision: receipt.revision }
        : null;
    },
    async authorize(tx, current, resource) {
      if (current.account.id !== input.accountId) return false;
      if (resource.kind === 'staffing_demand') {
        const row = await root(tx, resource.id);
        return (
          row !== null &&
          same(resource, row.revision) &&
          canReadDemand(current, row)
        );
      }
      const receipt = await batch(tx, resource.id);
      return receipt !== null && same(resource, receipt.revision);
    },
    async landing(tx, resource) {
      if (resource.kind === 'staffing_demand') {
        const row = await root(tx, resource.id);
        if (!row) throw new Error('authorized demand vanished in transaction');
        return `/staffing?${new URLSearchParams({ project: row.projectId, demand: row.id })}`;
      }
      return `/receipt?${new URLSearchParams({ id: resource.id })}`;
    },
  };
}
