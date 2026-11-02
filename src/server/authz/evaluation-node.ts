import { activeGrants, isCurrent } from './index';
import type { AuthzContext, Grant, Validity } from './index';
import type { TalentKind } from './talent';

export interface EvaluationNode {
  id: string;
  kind: 'program_cohort' | 'interview' | 'defense';
  cohortId: string | null;
}
export interface EvaluationNodeSubject {
  evaluationNodeId: string;
  personId: string;
}
export interface EvaluationRelation extends Validity {
  id: string;
  evaluationNodeId: string;
  evaluatorId: string;
  personId: string;
  kind: 'evaluator' | 'mentor' | 'assistant' | 'interviewer' | 'judge';
}
export interface EvaluationAuthzContext extends AuthzContext {
  evaluationNodes: EvaluationNode[];
  evaluationNodeSubjects: EvaluationNodeSubject[];
  evaluationRelations: EvaluationRelation[];
}

const purposes: readonly string[] = [
  'people-list',
  'person-preview',
  'person-profile',
  'workbench',
  'source-read',
  'model-input',
];
const evaluatorKinds: readonly TalentKind[] = [
  'person',
  'evaluation',
  'restricted-evaluation',
  'confirmed-score',
];
const directKinds: readonly TalentKind[] = [
  ...evaluatorKinds,
  'quadrant',
  'management-observation',
  'change',
  'performance',
];
const relationKinds: readonly EvaluationRelation['kind'][] = [
  'evaluator',
  'mentor',
  'assistant',
  'interviewer',
  'judge',
];

function nodeForSubject(
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
): EvaluationNode | undefined {
  if (
    ctx.account.isSystemAdmin ||
    !ctx.people.some((person) => person.id === personId && !person.noReview) ||
    !ctx.evaluationNodeSubjects.some(
      (subject) =>
        subject.evaluationNodeId === evaluationNodeId &&
        subject.personId === personId,
    )
  )
    return undefined;
  return ctx.evaluationNodes.find((node) => node.id === evaluationNodeId);
}

function currentNodeRelations(
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
): EvaluationRelation[] {
  return ctx.evaluationRelations.filter(
    (relation) =>
      relation.evaluationNodeId === evaluationNodeId &&
      relation.personId === personId &&
      relationKinds.includes(relation.kind) &&
      isCurrent(relation, ctx.now),
  );
}

function hrCohortAllowsSubject(
  ctx: EvaluationAuthzContext,
  cohortId: string | null,
  node: EvaluationNode,
  personId: string,
): boolean {
  return ctx.enrollments.some(
    (entry) =>
      entry.personId === personId &&
      entry.cohortId === cohortId &&
      isCurrent(entry, ctx.now) &&
      (entry.confirmed || node.cohortId === entry.cohortId),
  );
}
function hrGrantAllowsSubject(
  ctx: EvaluationAuthzContext,
  grant: Grant,
  node: EvaluationNode,
  personId: string,
): boolean {
  return (
    grant.role === 'hr' &&
    hrCohortAllowsSubject(ctx, grant.cohortId, node, personId)
  );
}

/** Whether the HR of `cohortId` currently has source access to this node subject.
 * Viewer-independent, so a figure computed under the HR rule (for example the
 * selection impact preview) is the same whoever recomputes it.
 */
export function cohortHrCanReadNodeSubject(
  ctx: EvaluationAuthzContext,
  cohortId: string,
  evaluationNodeId: string,
  personId: string,
): boolean {
  const node = nodeForSubject(ctx, evaluationNodeId, personId);
  return (
    node !== undefined && hrCohortAllowsSubject(ctx, cohortId, node, personId)
  );
}

/** Node membership is required even when a manager or HR can read the person.
 * AI inference must instead pass through a source-aware projection.
 */
export function canReadNodeTalent(
  ctx: EvaluationAuthzContext,
  resource: {
    evaluationNodeId: string;
    personId: string;
    kind: TalentKind;
  },
  purpose: string,
): boolean {
  const node = nodeForSubject(
    ctx,
    resource.evaluationNodeId,
    resource.personId,
  );
  if (
    node === undefined ||
    !purposes.includes(purpose) ||
    !directKinds.includes(resource.kind) ||
    (purpose === 'model-input' && resource.kind === 'performance')
  )
    return false;
  return (
    activeGrants(ctx).some(
      (grant) =>
        grant.role === 'manager' ||
        hrGrantAllowsSubject(ctx, grant, node, resource.personId),
    ) ||
    (evaluatorKinds.includes(resource.kind) &&
      currentNodeRelations(
        ctx,
        resource.evaluationNodeId,
        resource.personId,
      ).some((relation) => relation.evaluatorId === ctx.account.personId))
  );
}

export function canEvaluateNode(
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
): boolean {
  return (
    nodeForSubject(ctx, evaluationNodeId, personId) !== undefined &&
    currentNodeRelations(ctx, evaluationNodeId, personId).some(
      (relation) => relation.evaluatorId === ctx.account.personId,
    )
  );
}

export function canConfirmOwnNodeScore(
  ctx: EvaluationAuthzContext,
  resource: {
    evaluationNodeId: string;
    personId: string;
    raterId: string;
  },
): boolean {
  return (
    resource.raterId === ctx.account.personId &&
    canEvaluateNode(ctx, resource.evaluationNodeId, resource.personId)
  );
}

export function canManageNodeAssignments(
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
): boolean {
  const node = nodeForSubject(ctx, evaluationNodeId, personId);
  return (
    node !== undefined &&
    activeGrants(ctx).some((grant) =>
      hrGrantAllowsSubject(ctx, grant, node, personId),
    )
  );
}

/** Reassignment chooses an existing current relation; it never creates a person. */
export function eligibleNodeEvaluatorRelations(
  ctx: EvaluationAuthzContext,
  evaluationNodeId: string,
  personId: string,
): EvaluationRelation[] {
  if (!canManageNodeAssignments(ctx, evaluationNodeId, personId)) return [];
  return currentNodeRelations(ctx, evaluationNodeId, personId).filter(
    (relation) =>
      ctx.people.some((person) => person.id === relation.evaluatorId),
  );
}
