import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../../../db/client';
import { loadEvaluationContext } from '../../../usecases/evaluation-context';
import { ForbiddenError } from '../../../usecases/project-context';
import type { NodeConclusionDependencies } from '../../../usecases/node-conclusion';
import { NodeConclusionError } from '../node-conclusion';

type ContextPorts = Pick<
  NodeConclusionDependencies<Transaction>,
  'transaction' | 'lockOperation' | 'lockConclusion' | 'loadAuthorization'
>;

/** Native foundation shared by the persistence adapter. No in-memory fallback. */
export function createPostgresNodeConclusionContext(
  db: Database,
): ContextPorts {
  return {
    transaction: (run) =>
      db.transaction(run, { isolationLevel: 'read committed' }),
    async lockOperation(tx, accountId, operationId) {
      // JSON tuples avoid ambiguous concatenation; a hash collision only serializes.
      const key = JSON.stringify([
        'node-conclusion-operation',
        accountId,
        operationId,
      ]);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
    },
    async lockConclusion(tx, identity) {
      // The advisory identity exists before the first conclusion row is inserted.
      const key = JSON.stringify([
        'node-conclusion-identity',
        identity.evaluationNodeId,
        identity.personId,
      ]);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
      );
    },
    async loadAuthorization(tx, accountId, businessNow) {
      try {
        const { context, directory } = await loadEvaluationContext(
          tx,
          accountId,
          businessNow,
        );
        const actor = directory.people.find(
          (person) => person.id === context.account.personId,
        );
        if (!actor || !actor.name.trim())
          throw new NodeConclusionError('forbidden', '当前署名不可用');
        return { context, actor: { id: actor.id, name: actor.name } };
      } catch (error) {
        if (error instanceof ForbiddenError)
          throw new NodeConclusionError('forbidden', '当前身份不可用');
        throw error;
      }
    },
  };
}
