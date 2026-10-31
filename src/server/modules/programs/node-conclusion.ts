import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  materialSourceReferenceSchema,
  type MaterialSourceReference,
} from '../../../contracts/sources';
import {
  canManageNodeAssignments,
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import { activeGrants } from '../../authz';
import type { TalentKind } from '../../authz/talent';

const id = z.string().trim().min(1).max(200);
const identitySchema = z.strictObject({ evaluationNodeId: id, personId: id });
export type NodeConclusionIdentity = z.infer<typeof identitySchema>;
export function nodeConclusionReferenceKey(reference: MaterialSourceReference) {
  const parsed = materialSourceReferenceSchema.parse(reference);
  return JSON.stringify([
    parsed.fragmentId,
    parsed.originalVersionId,
    parsed.location,
  ]);
}
const referencesSchema = z
  .array(materialSourceReferenceSchema)
  .min(1)
  .max(100)
  .refine(
    (references) =>
      references.every(
        (reference) =>
          materialSourceReferenceSchema.safeParse(reference).success,
      ) &&
      new Set(references.map(nodeConclusionReferenceKey)).size ===
        references.length,
    '依据引用不能重复',
  );
export const confirmNodeConclusionInputSchema = identitySchema.extend({
  operationId: id,
  expectedVersion: z.number().int().nonnegative(),
  expectedScoreRevision: id,
  conclusion: z.string().trim().min(1).max(10000),
  basisReferences: referencesSchema,
});
export type ConfirmNodeConclusionInput = z.infer<
  typeof confirmNodeConclusionInputSchema
>;
export const readNodeConclusionInputSchema = identitySchema.extend({
  version: z.number().int().positive().optional(),
});
export type ReadNodeConclusionInput = z.infer<
  typeof readNodeConclusionInputSchema
>;
const confirmationSchema = z.strictObject({
  confirmationId: id,
  evaluatorId: id,
  version: z.number().int().positive(),
  confirmedAt: z.iso.datetime(),
});
const readyScoresSchema = identitySchema.extend({
  status: z.literal('ready'),
  revision: id,
  confirmations: z
    .array(confirmationSchema)
    .min(1)
    .refine(
      (rows) =>
        new Set(rows.map((row) => row.confirmationId)).size === rows.length,
    ),
});
export const nodeScoreAuthoritySchema = z.discriminatedUnion('status', [
  readyScoresSchema,
  identitySchema.extend({ status: z.enum(['pending', 'unavailable']) }),
]);
export type NodeScoreAuthority = z.infer<typeof nodeScoreAuthoritySchema>;
export interface ResolvedNodeConclusionSource {
  reference: MaterialSourceReference;
  /** Complete canonical source subjects, including shared fragments. */
  subjects: NodeConclusionIdentity[];
  kind: TalentKind;
  requiredKinds: TalentKind[];
}
export const nodeConclusionVersionSchema = identitySchema.extend({
  id,
  conclusionType: z.literal('defense'),
  origin: z.literal('human_conclusion'),
  version: z.number().int().positive(),
  conclusion: z.string().trim().min(1).max(10000),
  confirmedBy: z.strictObject({ id, name: z.string().trim().min(1).max(200) }),
  confirmedAt: z.iso.datetime(),
  basis: z.strictObject({
    scoreConfirmationRevision: id,
    confirmations: readyScoresSchema.shape.confirmations,
    references: referencesSchema,
  }),
});
export type NodeConclusionVersion = z.infer<typeof nodeConclusionVersionSchema>;
export interface NodeConclusionOperation {
  fingerprint: string;
  conclusion: NodeConclusionVersion;
}
export class NodeConclusionError extends Error {
  constructor(
    readonly code: 'forbidden' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
export function nodeConclusionFingerprint(input: ConfirmNodeConclusionInput) {
  const parsed = confirmNodeConclusionInputSchema.parse(input);
  return createHash('sha256')
    .update(
      JSON.stringify({
        ...parsed,
        basisReferences: [...parsed.basisReferences].sort((a, b) =>
          nodeConclusionReferenceKey(a) < nodeConclusionReferenceKey(b)
            ? -1
            : nodeConclusionReferenceKey(a) > nodeConclusionReferenceKey(b)
              ? 1
              : 0,
        ),
      }),
    )
    .digest('hex');
}
function defenseNode(
  context: EvaluationAuthzContext,
  identity: NodeConclusionIdentity,
) {
  return context.evaluationNodes.some(
    (node) => node.id === identity.evaluationNodeId && node.kind === 'defense',
  );
}
export function canConfirmNodeConclusion(
  context: EvaluationAuthzContext,
  identity: NodeConclusionIdentity,
): boolean {
  return (
    defenseNode(context, identity) &&
    canManageNodeAssignments(
      context,
      identity.evaluationNodeId,
      identity.personId,
    )
  );
}
export function canReadNodeConclusion(
  context: EvaluationAuthzContext,
  identity: NodeConclusionIdentity,
): boolean {
  return (
    defenseNode(context, identity) &&
    activeGrants(context).some(
      (grant) => grant.role === 'hr' || grant.role === 'manager',
    ) &&
    canReadNodeTalent(context, { ...identity, kind: 'evaluation' }, 'workbench')
  );
}
export function requireNodeConclusionSources(
  context: EvaluationAuthzContext,
  identity: NodeConclusionIdentity,
  references: MaterialSourceReference[],
  resolved: ResolvedNodeConclusionSource[] | null,
): MaterialSourceReference[] {
  const parsed = referencesSchema.safeParse(references);
  if (!parsed.success)
    throw new NodeConclusionError('conflict', '依据引用无效');
  if (resolved === null)
    throw new NodeConclusionError('forbidden', '依据不存在或不可见');
  if (resolved.length !== parsed.data.length)
    throw new NodeConclusionError('conflict', '依据引用已变化');
  const keys = resolved.map((source) => {
    const reference = materialSourceReferenceSchema.safeParse(source.reference);
    if (!reference.success)
      throw new NodeConclusionError('conflict', '依据定位无效');
    return nodeConclusionReferenceKey(reference.data);
  });
  if (new Set(keys).size !== keys.length)
    throw new NodeConclusionError('conflict', '依据解析不能重复');
  for (const reference of parsed.data) {
    const source =
      resolved[keys.indexOf(nodeConclusionReferenceKey(reference))];
    if (!source) throw new NodeConclusionError('conflict', '依据引用已变化');
    if (
      !source.subjects.some(
        (subject) =>
          subject.evaluationNodeId === identity.evaluationNodeId &&
          subject.personId === identity.personId,
      )
    )
      throw new NodeConclusionError('conflict', '依据不属于此节点与人员');
    if (
      !source.subjects.every((subject) =>
        [source.kind, ...source.requiredKinds].every((kind) =>
          canReadNodeTalent(context, { ...subject, kind }, 'source-read'),
        ),
      )
    )
      throw new NodeConclusionError('forbidden', '依据不存在或不可见');
  }
  return parsed.data;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function immutableNodeConclusion(
  record: NodeConclusionVersion,
): NodeConclusionVersion {
  return freeze(nodeConclusionVersionSchema.parse(record));
}
export function planNodeConclusion(input: {
  command: ConfirmNodeConclusionInput;
  current: NodeConclusionVersion | null;
  context: EvaluationAuthzContext;
  actor: { id: string; name: string };
  now: string;
  newId: string;
  scores: NodeScoreAuthority | null;
  sources: ResolvedNodeConclusionSource[] | null;
}): NodeConclusionVersion {
  const command = confirmNodeConclusionInputSchema.parse(input.command);
  if (!canConfirmNodeConclusion(input.context, command))
    throw new NodeConclusionError('forbidden', '仅范围内HR可确认节点结论');
  if (
    input.actor.id !== input.context.account.personId ||
    !input.actor.name.trim()
  )
    throw new NodeConclusionError('forbidden', '署名与当前身份不一致');
  const current =
    input.current === null
      ? null
      : nodeConclusionVersionSchema.parse(input.current);
  if (
    current !== null &&
    (current.evaluationNodeId !== command.evaluationNodeId ||
      current.personId !== command.personId)
  )
    throw new NodeConclusionError('conflict', '结论节点或人员身份不一致');
  if ((current?.version ?? 0) !== command.expectedVersion)
    throw new NodeConclusionError('conflict', '结论版本已变化');
  const scores = nodeScoreAuthoritySchema.safeParse(input.scores);
  if (!scores.success || scores.data.status !== 'ready')
    throw new NodeConclusionError('conflict', '权威评分确认尚未就绪');
  if (
    scores.data.evaluationNodeId !== command.evaluationNodeId ||
    scores.data.personId !== command.personId
  )
    throw new NodeConclusionError('conflict', '评分确认不属于此节点与人员');
  if (scores.data.revision !== command.expectedScoreRevision)
    throw new NodeConclusionError('conflict', '评分确认版本已变化');
  const references = requireNodeConclusionSources(
    input.context,
    command,
    command.basisReferences,
    input.sources,
  );
  return immutableNodeConclusion({
    id: current?.id ?? input.newId,
    evaluationNodeId: command.evaluationNodeId,
    personId: command.personId,
    conclusionType: 'defense',
    origin: 'human_conclusion',
    version: command.expectedVersion + 1,
    conclusion: command.conclusion,
    confirmedBy: { ...input.actor },
    confirmedAt: input.now,
    basis: {
      scoreConfirmationRevision: scores.data.revision,
      confirmations: scores.data.confirmations,
      references,
    },
  });
}
