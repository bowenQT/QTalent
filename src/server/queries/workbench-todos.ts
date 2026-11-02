import 'server-only';
import { activeRoles } from '../authz';
import { canManageNodeAssignments } from '../authz/evaluation-node';
import type { ReassignmentAuthzContext } from '../authz/reassignment-handlers';
import type { Database } from '../db/client';
import {
  assignedEvaluationHandlerIsCurrent,
  canWorkOnEvaluationItem,
  readEvaluationWorkItems,
  type EvaluationWorkItem,
} from '../modules/programs';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { ForbiddenError } from '../usecases/project-context';

export type WorkbenchWorkItem = Pick<
  EvaluationWorkItem,
  'id' | 'evaluationNodeId' | 'personId' | 'kind' | 'resourceId' | 'revision'
> & { action: 'handle' | 'reassign' };

/** Internal source projection, not the public shell/workbench contract. A known
 * registered-work count does not prove all upstream producers are connected. */
export type WorkbenchTodoSources =
  | { status: 'not_applicable' }
  | {
      status: 'not_connected';
      registeredWork: {
        status: 'ready';
        count: number;
        items: WorkbenchWorkItem[];
      };
      scoreReviews: { status: 'not_connected' };
      speakerInventory: { status: 'not_connected' };
      nodeCoverage: { status: 'not_connected' };
    };

/** Server-owned snapshot only. Do not accept this input from an action/request.
 * Reuse the same node/assignment authority as the actual handler/reassignment.
 * No material contents, scores or source links are read or disclosed here. */
export function workbenchTodosFromFacts(
  context: ReassignmentAuthzContext,
  work: readonly EvaluationWorkItem[],
): WorkbenchTodoSources {
  const roles = activeRoles(context);
  if (context.account.isSystemAdmin || roles.length === 0)
    throw new ForbiddenError();
  if (roles.includes('manager')) return { status: 'not_applicable' };

  const byIdentity = new Map<
    string,
    { item: WorkbenchWorkItem; fingerprint: string }
  >();
  for (const row of work) {
    if (row.state !== 'pending' && row.state !== 'processing') continue;
    let action: WorkbenchWorkItem['action'];
    if (canWorkOnEvaluationItem(context, row)) action = 'handle';
    else if (
      canManageNodeAssignments(context, row.evaluationNodeId, row.personId) &&
      !assignedEvaluationHandlerIsCurrent(context, row)
    )
      action = 'reassign';
    else continue;

    // Same identity as programs_work_resource_identity. A person can have
    // multiple genuine tasks; neither personId nor resourceId alone is a key.
    const identity = JSON.stringify([
      row.evaluationNodeId,
      row.personId,
      row.kind,
      row.resourceId,
    ]);
    const fingerprint = JSON.stringify([
      row.id,
      row.revision,
      row.state,
      row.assignedRelationId,
      row.assignedEvaluatorId,
      action,
    ]);
    const prior = byIdentity.get(identity);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new Error('待办来源身份或版本不一致');
      continue;
    }
    byIdentity.set(identity, {
      fingerprint,
      item: {
        id: row.id,
        evaluationNodeId: row.evaluationNodeId,
        personId: row.personId,
        kind: row.kind,
        resourceId: row.resourceId,
        revision: row.revision,
        action,
      },
    });
  }
  const items = [...byIdentity.values()]
    .map(({ item }) => item)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    status: 'not_connected',
    registeredWork: { status: 'ready', count: items.length, items },
    scoreReviews: { status: 'not_connected' },
    speakerInventory: { status: 'not_connected' },
    nodeCoverage: { status: 'not_connected' },
  };
}

/** Every call reloads current account binding, grants, relations and work rows
 * in one committed snapshot. No cached role, client count, or missing-table
 * fallback. Completion/reassignment becomes visible on the next read. */
export async function readWorkbenchTodoSources(
  db: Database,
  accountId: string,
  now: string,
): Promise<WorkbenchTodoSources> {
  return db.transaction(
    async (tx) => {
      const { context } = await loadEvaluationContext(tx, accountId, now);
      const roles = activeRoles(context);
      if (roles.length === 0) throw new ForbiddenError();
      if (roles.includes('manager')) return { status: 'not_applicable' };
      return workbenchTodosFromFacts(
        context,
        await readEvaluationWorkItems(tx),
      );
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
}
