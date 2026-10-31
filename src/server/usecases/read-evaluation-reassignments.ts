import { activeGrants } from '../authz';
import { canManageNodeAssignments } from '../authz/evaluation-node';
import type { Database } from '../db/client';
import { eligibleEvaluationWorkRelations } from '../authz/reassignment-handlers';
import {
  assignedEvaluationRelationIsCurrent,
  readEvaluationWorkItems,
  EvaluationReassignmentError,
} from '../modules/programs';
import { loadEvaluationContext } from './evaluation-context';

export async function readEvaluationReassignments(
  db: Database,
  accountId: string,
  now: string,
) {
  return db.transaction(
    async (tx) => {
      const { context, directory, facts } = await loadEvaluationContext(
        tx,
        accountId,
        now,
      );
      if (!activeGrants(context).some((grant) => grant.role === 'hr'))
        throw new EvaluationReassignmentError(
          'forbidden',
          '只有有权限的 HR 可以重新分派',
        );
      const work = await readEvaluationWorkItems(tx);
      const people = new Map(
        directory.people.map((person) => [person.id, person]),
      );
      const nodes = new Map(
        facts.evaluationNodes.map((node) => [node.id, node]),
      );
      const items = work
        .filter(
          (item) =>
            (item.state === 'pending' || item.state === 'processing') &&
            canManageNodeAssignments(
              context,
              item.evaluationNodeId,
              item.personId,
            ) &&
            !assignedEvaluationRelationIsCurrent(context, item),
        )
        .map((item) => {
          const node = nodes.get(item.evaluationNodeId);
          const person = people.get(item.personId);
          if (!node || !person)
            throw new Error('Authorized node or subject is missing');
          return {
            workItemId: item.id,
            revision: item.revision,
            kind: item.kind,
            resourceId: item.resourceId,
            state: item.state,
            node: { id: node.id, name: node.name, kind: node.kind },
            person: { id: person.id, name: person.name },
            previousEvaluator: {
              id: item.assignedEvaluatorId,
              displayName: people.get(item.assignedEvaluatorId)?.name ?? null,
            },
            candidates: eligibleEvaluationWorkRelations(context, item)
              .map((relation) => ({
                relationId: relation.id,
                evaluatorId: relation.evaluatorId,
                displayName: people.get(relation.evaluatorId)!.name,
                kind: relation.kind,
              }))
              .sort((a, b) => a.relationId.localeCompare(b.relationId)),
          };
        })
        .sort((a, b) => a.workItemId.localeCompare(b.workItemId));
      return { asOf: now, items };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
