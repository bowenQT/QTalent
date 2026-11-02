import { isCurrent } from '../../../authz';
import type { EvaluationAuthzContext } from '../../../authz/evaluation-node';

export type DefaultIntakeNode =
  | { status: 'resolved'; evaluationNodeId: string }
  | { status: 'default_node_missing' }
  | { status: 'default_node_ambiguous' };

/** The node a material is delivered to when the submitter names none: among
 * nodes where the submitter holds a current relation and may write records,
 * the one whose relation started last. Equal starts are ambiguous rather than
 * guessed. The upload entry and batch intake both resolve through here.
 */
export function resolveDefaultIntakeNode(
  context: Pick<
    EvaluationAuthzContext,
    'account' | 'evaluationRelations' | 'now'
  >,
  canWrite: (evaluationNodeId: string) => boolean,
): DefaultIntakeNode {
  const latest = new Map<string, number>();
  for (const relation of context.evaluationRelations) {
    if (
      relation.evaluatorId !== context.account.personId ||
      !isCurrent(relation, context.now)
    )
      continue;
    const start = Date.parse(relation.validFrom);
    const known = latest.get(relation.evaluationNodeId);
    if (known === undefined || start > known)
      latest.set(relation.evaluationNodeId, start);
  }
  const candidates = [...latest].filter(([nodeId]) => canWrite(nodeId));
  if (!candidates.length) return { status: 'default_node_missing' };
  const newest = Math.max(...candidates.map(([, start]) => start));
  const chosen = candidates.filter(([, start]) => start === newest);
  return chosen.length === 1
    ? { status: 'resolved', evaluationNodeId: chosen[0]![0] }
    : { status: 'default_node_ambiguous' };
}
