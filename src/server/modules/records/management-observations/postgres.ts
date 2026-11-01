import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../../db/client';
import { recordAudit } from '../../../platform/audit';
import type { ManagementObservationPorts } from '../../../usecases/management-observations';
import {
  managementObservationSchema,
  ObservationError,
  type ManagementObservation,
} from './model';
import {
  managementObservations,
  managementObservationSources,
  managementObservationOperations,
} from './schema';

/** Canonical readers must use this transaction and lock their complete authorization/source read sets. */
export type ObservationFactReaders = Pick<
  ManagementObservationPorts<Transaction>,
  'loadSnapshot' | 'loadSources' | 'loadAttribution'
> & {
  lockFacts(tx: Transaction): Promise<void>;
};
/** Do not leak Drizzle's SQL/parameters (observation text) from a database rejection. */
export class ObservationPersistenceError extends Error {
  constructor(readonly sqlState: string) {
    super('Management observation persistence failed');
    this.name = 'ObservationPersistenceError';
  }
}
function sqlState(error: unknown): string | undefined {
  let current = error;
  for (
    let n = 0;
    n < 4 && current !== null && typeof current === 'object';
    n++
  ) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === 'string' && /^[0-9A-Z]{5}$/.test(value.code))
      return value.code;
    current = value.cause;
  }
}
export function createManagementObservationPostgresPorts(
  database: Database,
  facts: ObservationFactReaders,
): ManagementObservationPorts<Transaction> {
  if (
    !facts ||
    !['lockFacts', 'loadSnapshot', 'loadSources', 'loadAttribution'].every(
      (key) => typeof facts[key as keyof ObservationFactReaders] === 'function',
    )
  )
    throw new ObservationError('invalid_data');
  const { lockFacts, loadSnapshot, loadSources, loadAttribution } = facts;
  const active = new WeakSet<Transaction>();
  const fences = new WeakMap<Transaction, Promise<void>>();
  function requireTransaction(tx: Transaction) {
    if (!active.has(tx)) throw new ObservationError('invalid_data');
  }
  async function fenced(tx: Transaction) {
    requireTransaction(tx);
    let pending = fences.get(tx);
    if (!pending) {
      pending = Promise.resolve().then(() => lockFacts(tx));
      fences.set(tx, pending);
    }
    await pending;
  }
  async function hydrate(
    tx: Transaction,
    row: typeof managementObservations.$inferSelect,
  ): Promise<ManagementObservation> {
    const links = await tx
      .select()
      .from(managementObservationSources)
      .where(eq(managementObservationSources.observationId, row.id))
      .orderBy(asc(managementObservationSources.position))
      .for('share');
    const result = managementObservationSchema.safeParse({
      id: row.id,
      evaluationNodeId: row.evaluationNodeId,
      personId: row.personId,
      text: row.text,
      origin: row.origin,
      kind: 'management-observation',
      nature: 'management_observation',
      author: { personId: row.authorPersonId, name: row.authorName },
      authorUnconfirmed: row.authorUnconfirmed,
      importedBy:
        row.importedByAccountId === null
          ? null
          : {
              accountId: row.importedByAccountId,
              personId: row.importedByPersonId,
              name: row.importedByName,
            },
      recordedByAccountId: row.recordedByAccountId,
      recordedAt: row.recordedAt.toISOString(),
      occurredAt: row.occurredAt,
      attributionId: row.attributionId,
      sources: links.map((link) => ({
        fragmentId: link.fragmentId,
        originalVersionId: link.originalVersionId,
      })),
    });
    if (!result.success) throw new ObservationError('invalid_data');
    return result.data;
  }
  return {
    async transaction(work) {
      try {
        return await database.transaction(
          async (tx) => {
            active.add(tx);
            try {
              return await work(tx);
            } finally {
              active.delete(tx);
              fences.delete(tx);
            }
          },
          { isolationLevel: 'read committed' },
        );
      } catch (error) {
        const code = sqlState(error);
        if (code) throw new ObservationPersistenceError(code);
        throw error;
      }
    },
    async lockOperation(tx, accountId, operationId) {
      requireTransaction(tx);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['management-observation', accountId, operationId])},0))`,
      );
    },
    async loadSnapshot(tx, accountId) {
      await fenced(tx);
      return loadSnapshot(tx, accountId);
    },
    async loadSources(tx, references) {
      await fenced(tx);
      return loadSources(tx, references);
    },
    async loadAttribution(tx, id) {
      await fenced(tx);
      return loadAttribution(tx, id);
    },
    async readOperation(tx, accountId, operationId) {
      requireTransaction(tx);
      const [row] = await tx
        .select({
          fingerprint: managementObservationOperations.fingerprint,
          observationId: managementObservationOperations.observationId,
        })
        .from(managementObservationOperations)
        .where(
          and(
            eq(managementObservationOperations.accountId, accountId),
            eq(managementObservationOperations.operationId, operationId),
          ),
        )
        .for('share');
      return row ?? null;
    },
    async readObservation(tx, id) {
      requireTransaction(tx);
      const [row] = await tx
        .select()
        .from(managementObservations)
        .where(eq(managementObservations.id, id))
        .for('share');
      return row ? hydrate(tx, row) : null;
    },
    async listObservations(tx, subject) {
      requireTransaction(tx);
      const rows = await tx
        .select()
        .from(managementObservations)
        .where(
          and(
            eq(
              managementObservations.evaluationNodeId,
              subject.evaluationNodeId,
            ),
            eq(managementObservations.personId, subject.personId),
          ),
        )
        .orderBy(
          asc(managementObservations.recordedAt),
          asc(managementObservations.id),
        )
        .for('share');
      return Promise.all(rows.map((row) => hydrate(tx, row)));
    },
    async insertObservation(tx, value) {
      await fenced(tx);
      const checked = managementObservationSchema.safeParse(value);
      if (!checked.success) throw new ObservationError('invalid_data');
      const row = checked.data;
      await tx.insert(managementObservations).values({
        id: row.id,
        evaluationNodeId: row.evaluationNodeId,
        personId: row.personId,
        text: row.text,
        origin: row.origin,
        authorPersonId: row.author.personId,
        authorName: row.author.name,
        authorUnconfirmed: row.authorUnconfirmed,
        importedByAccountId: row.importedBy?.accountId ?? null,
        importedByPersonId: row.importedBy?.personId ?? null,
        importedByName: row.importedBy?.name ?? null,
        recordedByAccountId: row.recordedByAccountId,
        recordedAt: new Date(row.recordedAt),
        occurredAt: row.occurredAt,
        attributionId: row.attributionId,
      });
      if (row.sources.length)
        await tx.insert(managementObservationSources).values(
          row.sources.map((ref, position) => ({
            observationId: row.id,
            position,
            ...ref,
          })),
        );
    },
    async saveOperation(
      tx,
      accountId,
      operationId,
      fingerprint,
      observationId,
    ) {
      requireTransaction(tx);
      await tx
        .insert(managementObservationOperations)
        .values({ accountId, operationId, fingerprint, observationId });
    },
    async audit(tx, accountId, observationId) {
      requireTransaction(tx);
      await recordAudit(tx, {
        actorId: accountId,
        action: 'management_observation.recorded',
        resourceId: observationId,
      });
    },
    allocateId: randomUUID,
  };
}
