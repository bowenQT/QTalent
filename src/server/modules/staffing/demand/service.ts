import { randomUUID, createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../../db/client';
import type { AuthzContext } from '../../../authz';
import { newJob, type JobRecord } from '../../../jobs/state';
import { insertJob } from '../../../jobs/repository';
import {
  staffingDemandSchema,
  staffingDemandJobSnapshotSchema,
  type StaffingDemand,
} from '../../../../contracts/staffing';
import { demandRoots, demandVersions, demandOperations } from './schema';
import { canReadDemand, canWriteDemand } from './policy';
import { DEMAND_PROMPT_VERSION } from './prompt';
import { reviseDemand, DemandConflictError } from './version';

export interface DemandDependencies {
  db: Database;
  now(): string;
  loadContext(
    tx: Transaction,
    accountId: string,
    now: string,
  ): Promise<{ context: AuthzContext; actorName: string }>;
  enqueue(tx: Transaction, job: JobRecord): Promise<void>;
}
export class DemandAccessError extends Error {}
export const inputVersion = (inputText: string, promptVersion: string) =>
  createHash('sha256')
    .update(JSON.stringify([inputText, promptVersion]))
    .digest('hex');

async function operationLock(
  tx: Transaction,
  accountId: string,
  operationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'staffing-demand:' + accountId + ':' + operationId},0))`,
  );
}
export async function loadDemandRoot(
  tx: Transaction,
  id: string,
  lock = false,
) {
  const query = tx.select().from(demandRoots).where(eq(demandRoots.id, id));
  const rows = lock ? await query.for('update') : await query;
  return rows[0];
}
async function loadVersion(tx: Transaction, id: string, revision: number) {
  const [row] = await tx
    .select()
    .from(demandVersions)
    .where(
      and(
        eq(demandVersions.demandId, id),
        eq(demandVersions.revision, revision),
      ),
    );
  return row;
}
export function queuedSnapshot(job: JobRecord) {
  return staffingDemandJobSnapshotSchema.parse({
    schemaVersion: 1,
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    attempt: job.attempt,
    revision: job.revision,
    updatedAt: job.updatedAt,
    progress: null,
    result: null,
    error: null,
    canRetry: false,
    canCancel: true,
    cancelRequestedAt: null,
  });
}
export function createDemandService(deps: DemandDependencies) {
  async function createInTransaction(
    tx: Transaction,
    accountId: string,
    input: { operationId: string; projectId: string; inputText: string },
  ) {
    await operationLock(tx, accountId, input.operationId);
    const now = deps.now();
    const { context } = await deps.loadContext(tx, accountId, now);
    if (
      !canWriteDemand(context, {
        projectId: input.projectId,
        initiatorAccountId: '',
      })
    )
      throw new DemandAccessError();
    const fingerprint = JSON.stringify([
      'create',
      input.projectId,
      input.inputText,
    ]);
    const [old] = await tx
      .select()
      .from(demandOperations)
      .where(
        and(
          eq(demandOperations.accountId, accountId),
          eq(demandOperations.operationId, input.operationId),
        ),
      );
    if (old) {
      if (old.fingerprint !== fingerprint || old.revision !== null)
        throw new DemandConflictError();
      // The initial acknowledgement is immutable; current progress is read from the shared jobs endpoint.
      const root = await loadDemandRoot(tx, old.demandId);
      if (!root || !canReadDemand(context, root)) throw new DemandAccessError();
      const job = newJob(
        {
          jobId: root.id,
          kind: 'staffing_demand',
          resourceId: root.id,
          inputVersion: inputVersion(root.inputText, root.promptVersion),
        },
        root.createdAt,
      );
      return { snapshot: queuedSnapshot(job), replayed: true };
    }
    const id = randomUUID();
    await tx.insert(demandRoots).values({
      id,
      projectId: input.projectId,
      initiatorAccountId: accountId,
      initiatorPersonId: context.account.personId,
      inputText: input.inputText,
      promptVersion: DEMAND_PROMPT_VERSION,
      createdAt: now,
    });
    const job = newJob(
      {
        jobId: id,
        kind: 'staffing_demand',
        resourceId: id,
        inputVersion: inputVersion(input.inputText, DEMAND_PROMPT_VERSION),
      },
      now,
    );
    await insertJob(tx, job);
    await deps.enqueue(tx, job);
    await tx.insert(demandOperations).values({
      accountId,
      operationId: input.operationId,
      fingerprint,
      demandId: id,
      revision: null,
    });
    return { snapshot: queuedSnapshot(job), replayed: false };
  }
  async function readInTransaction(
    tx: Transaction,
    accountId: string,
    demandId: string,
    revision?: number,
  ): Promise<StaffingDemand | null> {
    const { context } = await deps.loadContext(tx, accountId, deps.now());
    const root = await loadDemandRoot(tx, demandId);
    if (!root || !canReadDemand(context, root)) return null;
    const row = await loadVersion(
      tx,
      root.id,
      revision ?? root.currentRevision,
    );
    return row ? staffingDemandSchema.parse(row.demand) : null;
  }
  return {
    createInTransaction,
    readInTransaction,
    async create(
      accountId: string,
      input: { operationId: string; projectId: string; inputText: string },
    ) {
      return deps.db.transaction((tx) =>
        createInTransaction(tx, accountId, input),
      );
    },
    async change(
      accountId: string,
      input: {
        operationId: string;
        demandId: string;
        expectedRevision: number;
      },
      change:
        | { action: 'edit'; requirements: StaffingDemand['requirements'] }
        | { action: 'confirm' },
    ) {
      return deps.db.transaction(async (tx) => {
        await operationLock(tx, accountId, input.operationId);
        const root = await loadDemandRoot(tx, input.demandId, true);
        const now = deps.now();
        const { context, actorName } = await deps.loadContext(
          tx,
          accountId,
          now,
        );
        if (!root || !canWriteDemand(context, root))
          throw new DemandAccessError();
        const fingerprint = JSON.stringify([
          change.action,
          input.demandId,
          input.expectedRevision,
          change.action === 'edit' ? change.requirements : null,
        ]);
        const [old] = await tx
          .select()
          .from(demandOperations)
          .where(
            and(
              eq(demandOperations.accountId, accountId),
              eq(demandOperations.operationId, input.operationId),
            ),
          );
        if (old) {
          if (old.fingerprint !== fingerprint || old.revision === null)
            throw new DemandConflictError();
          const previous = await loadVersion(tx, old.demandId, old.revision);
          if (!previous) throw new Error('Missing demand operation version');
          return {
            demand: staffingDemandSchema.parse(previous.demand),
            replayed: true,
          };
        }
        if (root.currentRevision !== input.expectedRevision)
          throw new DemandConflictError();
        const current = await loadVersion(tx, root.id, root.currentRevision);
        if (!current) throw new DemandConflictError();
        const demand = reviseDemand(
          staffingDemandSchema.parse(current.demand),
          input.expectedRevision,
          change.action === 'edit'
            ? change
            : {
                action: 'confirm',
                actor: { id: context.account.personId, name: actorName },
                now,
              },
        );
        await tx.insert(demandVersions).values({
          ...current,
          revision: demand.revision,
          demand,
          actorAccountId: accountId,
          createdAt: now,
        });
        await tx
          .update(demandRoots)
          .set({ currentRevision: demand.revision })
          .where(eq(demandRoots.id, root.id));
        await tx.insert(demandOperations).values({
          accountId,
          operationId: input.operationId,
          fingerprint,
          demandId: root.id,
          revision: demand.revision,
        });
        return { demand, replayed: false };
      });
    },
    async read(
      accountId: string,
      demandId: string,
      revision?: number,
    ): Promise<StaffingDemand | null> {
      return deps.db.transaction((tx) =>
        readInTransaction(tx, accountId, demandId, revision),
      );
    },
  };
}
