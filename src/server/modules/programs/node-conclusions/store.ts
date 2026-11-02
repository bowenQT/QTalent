import { and, desc, eq } from 'drizzle-orm';
import type { Database, Transaction } from '../../../db/client';
import { recordAudit } from '../../../platform/audit';
import {
  immutableNodeConclusion,
  NodeConclusionError,
  type NodeConclusionIdentity,
  type NodeConclusionOperation,
  type NodeConclusionVersion,
} from '../node-conclusion';
import { createPostgresNodeConclusionContext } from './postgres';
import {
  nodeConclusions,
  nodeConclusionVersions,
  nodeConclusionOperations,
} from './schema';
import { decodeStoredNodeConclusion } from './stored-version';

function conflict(): never {
  throw new NodeConclusionError('conflict', '结论版本或请求已变化');
}
function checked(record: NodeConclusionVersion) {
  try {
    return immutableNodeConclusion(record);
  } catch {
    return conflict();
  }
}
async function write<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const cause = error instanceof Error && error.cause ? error.cause : error;
    if (
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      ['23505', '23503', '23514', '40001', '40P01'].includes(String(cause.code))
    )
      conflict();
    throw error;
  }
}

/** Internal persistence only. Callers must use the authorized usecase in one tx. */
export function createPostgresNodeConclusionStore(db: Database) {
  const locks = createPostgresNodeConclusionContext(db);
  async function root(tx: Transaction, identity: NodeConclusionIdentity) {
    const [row] = await tx
      .select()
      .from(nodeConclusions)
      .where(
        and(
          eq(nodeConclusions.evaluationNodeId, identity.evaluationNodeId),
          eq(nodeConclusions.personId, identity.personId),
        ),
      );
    return row ?? null;
  }
  async function readCurrent(
    tx: Transaction,
    identity: NodeConclusionIdentity,
  ) {
    const identityRow = await root(tx, identity);
    if (identityRow === null) return null;
    const [row] = await tx
      .select()
      .from(nodeConclusionVersions)
      .where(eq(nodeConclusionVersions.conclusionId, identityRow.id))
      .orderBy(desc(nodeConclusionVersions.version))
      .limit(1);
    if (!row) return conflict();
    return decodeStoredNodeConclusion(row);
  }
  async function readVersion(
    tx: Transaction,
    identity: NodeConclusionIdentity,
    version: number,
  ) {
    if (!Number.isSafeInteger(version) || version < 1) return conflict();
    const identityRow = await root(tx, identity);
    if (identityRow === null) return null;
    const [row] = await tx
      .select()
      .from(nodeConclusionVersions)
      .where(
        and(
          eq(nodeConclusionVersions.conclusionId, identityRow.id),
          eq(nodeConclusionVersions.version, version),
        ),
      );
    return row ? decodeStoredNodeConclusion(row) : null;
  }
  async function readOperation(
    tx: Transaction,
    accountId: string,
    operationId: string,
  ) {
    const [row] = await tx
      .select()
      .from(nodeConclusionOperations)
      .where(
        and(
          eq(nodeConclusionOperations.accountId, accountId),
          eq(nodeConclusionOperations.operationId, operationId),
        ),
      );
    if (!row) return null;
    if (!/^[0-9a-f]{64}$/.test(row.fingerprint)) return conflict();
    const [version] = await tx
      .select()
      .from(nodeConclusionVersions)
      .where(
        and(
          eq(nodeConclusionVersions.conclusionId, row.conclusionId),
          eq(nodeConclusionVersions.version, row.version),
        ),
      );
    if (!version) return conflict();
    return {
      fingerprint: row.fingerprint,
      conclusion: decodeStoredNodeConclusion(version),
    };
  }
  return {
    readCurrent,
    readVersion,
    readOperation,
    async appendVersion(
      tx: Transaction,
      input: NodeConclusionVersion,
      expectedVersion: number,
    ) {
      const record = checked(input);
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0 ||
        record.version !== expectedVersion + 1
      )
        return conflict();
      // The identity lock also exists before the first root row. Do not rely
      // on callers remembering it: two first writers must share the same CAS.
      await locks.lockConclusion(tx, record);
      return write(async () => {
        const existing = await root(tx, record);
        if (existing === null) {
          if (expectedVersion !== 0) return conflict();
          await tx.insert(nodeConclusions).values({
            id: record.id,
            evaluationNodeId: record.evaluationNodeId,
            personId: record.personId,
          });
        } else {
          if (existing.id !== record.id) return conflict();
          const current = await readCurrent(tx, record);
          if (current?.version !== expectedVersion) return conflict();
        }
        // There is deliberately no UPDATE path for a historical version.
        await tx.insert(nodeConclusionVersions).values({
          conclusionId: record.id,
          version: record.version,
          evaluationNodeId: record.evaluationNodeId,
          personId: record.personId,
          payload: record,
        });
      });
    },
    async saveOperation(
      tx: Transaction,
      accountId: string,
      operationId: string,
      operation: NodeConclusionOperation,
    ) {
      if (!/^[0-9a-f]{64}$/.test(operation.fingerprint)) return conflict();
      const record = checked(operation.conclusion);
      await locks.lockOperation(tx, accountId, operationId);
      const stored = await readVersion(tx, record, record.version);
      if (!stored || JSON.stringify(stored) !== JSON.stringify(record))
        return conflict();
      // A successful operation points at exactly one immutable version. A
      // duplicate key is a conflict here; the usecase reads/re-authorizes first.
      await write(() =>
        tx.insert(nodeConclusionOperations).values({
          accountId,
          operationId,
          fingerprint: operation.fingerprint,
          conclusionId: record.id,
          version: record.version,
        }),
      );
    },
    async appendAudit(
      tx: Transaction,
      audit: {
        accountId: string;
        action: 'node_conclusion.confirm';
        conclusionId: string;
      },
    ) {
      await recordAudit(tx, {
        actorId: audit.accountId,
        action: audit.action,
        resourceId: audit.conclusionId,
      });
    },
  };
}
