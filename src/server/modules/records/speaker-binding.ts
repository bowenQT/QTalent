import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  materialReviewCommandSchema,
  materialReviewItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../contracts/material-review';
import {
  resumeRecordingProcessingSchema,
  speakerItemSchema,
} from '../../../contracts/media';
import { sourceReferenceSchema } from '../../../contracts/sources';
import { activeGrants } from '../../authz';
import {
  canEvaluateNode,
  canManageNodeAssignments,
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import type { TalentKind } from '../../authz/talent';
import type {
  RecordingTranscript,
  RecordingBindings,
  RecordingContext,
  RecordingWork,
  ResumeRecording,
} from './recordings/types';

export const speakerBindingCommandSchema =
  materialReviewCommandSchema.options[0];
export type SpeakerBindingCommand = z.infer<typeof speakerBindingCommandSchema>;
export type SpeakerBindingReceipt = Extract<
  z.infer<typeof materialReviewResolutionReceiptSchema>,
  { kind: 'speaker' }
>;
export interface SpeakerBindingSnapshot {
  batchId: string;
  materialId: string;
  evaluationNodeId: string;
  membershipRevision: number;
  members: { personId: string; evaluationNodeId: string }[];
  sourceScopeComplete: boolean;
  sourceSubjects: { personId: string; evaluationNodeId: string }[];
  sourceKind: TalentKind;
  requiredKinds: TalentKind[];
  inventoryComplete: boolean;
  transcript: RecordingTranscript;
  bindings: RecordingBindings;
  context: RecordingContext;
  itemRevisions: Record<string, number>;
  /** All other currently disclosable remaining items in this batch, including
   * speaker items from other recordings; exclude only this transcript. */
  otherReviewItemIds: string[] | null;
  /** Server-resolved blockers of THIS material/affected target, a subset of the
   * other remaining items in the batch. null is unknown; never infer [] from item IDs. */
  otherBlockingReviewItemIds: string[] | null;
  derived: {
    bindingRevision: number;
    draftIds: string[];
    confirmedResultIds: string[];
  } | null;
}
export interface SpeakerBindingAuthority {
  context: EvaluationAuthzContext;
  actor: { id: string; name: string };
  directory: { id: string; displayName: string }[];
  /** Current 846 processing-WRITE fact for this actor, not read authorization. */
  processing: {
    accountId: string;
    recordCollectionId: string;
    membershipRevision: number;
    allowed: boolean;
  };
}
export interface SpeakerBindingPlan {
  changed: boolean;
  bindingChanged: boolean;
  expectedBindingRevision: number;
  expectedItemRevision: number;
  membershipRevision: number;
  bindings: RecordingBindings;
  itemRevisions: Record<string, number>;
  decisions: {
    fragmentId: string;
    itemId: string;
    state: RecordingBindings['resolutions'][number]['state'];
    personId: string | null;
    actorId: string;
    actorName: string;
    at: string;
    itemRevision: number;
    bindingRevision: number;
  }[];
  invalidatedDraftIds: string[];
  resume: {
    grant: ResumeRecording;
    work: RecordingWork;
    operationKey: string;
  } | null;
  receipt: SpeakerBindingReceipt;
}
export class SpeakerBindingError extends Error {
  constructor(
    readonly code: 'forbidden' | 'not_found' | 'conflict',
    message: string,
  ) {
    super(message);
  }
}
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
const nonblank = (value: string) =>
  typeof value === 'string' && value.trim().length > 0;
const uniqueIds = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every(nonblank) &&
  new Set(value).size === value.length;
function conflict(message: string): never {
  throw new SpeakerBindingError('conflict', message);
}
export function assertSpeakerSnapshot(s: SpeakerBindingSnapshot) {
  const t = s.transcript,
    c = s.context;
  if (
    !nonblank(s.batchId) ||
    !nonblank(s.materialId) ||
    !nonblank(s.evaluationNodeId) ||
    !positive(s.membershipRevision) ||
    !positive(s.bindings.revision) ||
    t.recordingId !== c.recordingId ||
    t.originalVersionId !== c.originalVersionId ||
    s.bindings.revision !== c.bindingRevision ||
    !positive(c.attempt) ||
    !nonblank(c.jobId) ||
    !nonblank(c.recordingId) ||
    !nonblank(c.originalVersionId) ||
    !nonblank(c.recordCollectionId) ||
    !nonblank(t.id) ||
    !nonblank(t.providerTaskId) ||
    !positive(t.durationMs) ||
    !t.fragments.length
  )
    conflict('录音或绑定版本事实不完整');
  const ids = new Set<string>(),
    items = new Set<string>(),
    sentences = new Set<string>();
  for (const f of t.fragments) {
    const source = sourceReferenceSchema.safeParse(f.source);
    if (
      !source.success ||
      source.data.originalVersionId !== t.originalVersionId ||
      source.data.location.kind !== 'recording' ||
      source.data.location.endMs > t.durationMs ||
      !nonblank(f.quote) ||
      !nonblank(f.reviewItemId) ||
      !nonblank(f.providerSentenceId) ||
      (f.providerSpeakerId !== null && !nonblank(f.providerSpeakerId)) ||
      ids.has(f.source.fragmentId) ||
      items.has(f.reviewItemId) ||
      sentences.has(f.providerSentenceId) ||
      !positive(s.itemRevisions[f.reviewItemId]!)
    )
      conflict('离线说话人清单或出处无效');
    ids.add(f.source.fragmentId);
    items.add(f.reviewItemId);
    sentences.add(f.providerSentenceId);
  }
  if (
    s.bindings.resolutions.length !== ids.size ||
    new Set(s.bindings.resolutions.map((v) => v.fragmentId)).size !==
      ids.size ||
    s.bindings.resolutions.some(
      (v) =>
        !ids.has(v.fragmentId) ||
        !['pending', 'deferred', 'bound', 'irrelevant'].includes(v.state) ||
        (v.state === 'bound' && !nonblank(v.personId)),
    ) ||
    Object.keys(s.itemRevisions).length !== items.size
  )
    conflict('绑定不能遗漏或重复离线语段');
  if (
    s.otherReviewItemIds !== null &&
    (!uniqueIds(s.otherReviewItemIds) ||
      s.otherReviewItemIds.some((v) => items.has(v)))
  )
    conflict('其他待核对集合无效');
  if (
    s.otherBlockingReviewItemIds !== null &&
    (!uniqueIds(s.otherBlockingReviewItemIds) ||
      s.otherBlockingReviewItemIds.some(
        (v) =>
          items.has(v) ||
          (s.otherReviewItemIds !== null && !s.otherReviewItemIds.includes(v)),
      ))
  )
    conflict('本材料阻塞项必须是其他剩余项的唯一子集');
}
function resolverFor(
  a: SpeakerBindingAuthority,
  nodeId: string,
  personId: string,
) {
  return (
    canEvaluateNode(a.context, nodeId, personId) ||
    canManageNodeAssignments(a.context, nodeId, personId) ||
    (activeGrants(a.context).some((g) => g.role === 'manager') &&
      canReadNodeTalent(
        a.context,
        { evaluationNodeId: nodeId, personId, kind: 'evaluation' },
        'workbench',
      ))
  );
}
export function requireSpeakerAccess(
  s: SpeakerBindingSnapshot,
  a: SpeakerBindingAuthority,
  accountId: string,
  write: boolean,
) {
  assertSpeakerSnapshot(s);
  if (
    a.context.account.id !== accountId ||
    a.context.account.personId !== a.actor.id ||
    !nonblank(a.actor.name) ||
    s.sourceScopeComplete !== true ||
    !s.sourceSubjects.length ||
    !s.members.length ||
    s.members.some(
      (m) =>
        m.evaluationNodeId !== s.evaluationNodeId ||
        !s.sourceSubjects.some(
          (v) =>
            v.personId === m.personId &&
            v.evaluationNodeId === m.evaluationNodeId,
        ),
    ) ||
    !s.sourceSubjects.every((subject) =>
      [s.sourceKind, ...s.requiredKinds].every((kind) =>
        canReadNodeTalent(a.context, { ...subject, kind }, 'source-read'),
      ),
    ) ||
    !s.members.every((m) => resolverFor(a, m.evaluationNodeId, m.personId))
  )
    throw new SpeakerBindingError(
      'forbidden',
      '材料不存在或不在当前可处理范围',
    );
  if (
    write &&
    (a.processing.allowed !== true ||
      a.processing.accountId !== accountId ||
      a.processing.recordCollectionId !== s.context.recordCollectionId ||
      a.processing.membershipRevision !== s.membershipRevision ||
      s.context.cancelRequested)
  )
    throw new SpeakerBindingError('forbidden', '当前材料写许可已失效');
}
export function speakerCandidates(
  s: SpeakerBindingSnapshot,
  a: SpeakerBindingAuthority,
) {
  return a.directory
    .filter(
      (p) =>
        nonblank(p.id) &&
        nonblank(p.displayName) &&
        s.members.some(
          (m) =>
            m.personId === p.id &&
            resolverFor(a, m.evaluationNodeId, m.personId),
        ) &&
        canReadNodeTalent(
          a.context,
          {
            evaluationNodeId: s.evaluationNodeId,
            personId: p.id,
            kind: 'person',
          },
          'person-preview',
        ),
    )
    .filter((p, i, all) => all.findIndex((v) => v.id === p.id) === i)
    .map((p) => ({ personId: p.id, displayName: p.displayName }));
}
/** Invalidity is keyed by fragment AND person, not just by the person. An
 * already-stale person cannot silently acquire another fragment during repair.
 */
export function boundCandidateGaps(
  bindings: RecordingBindings,
  candidates: { personId: string }[],
): { fragmentId: string; personId: string }[] {
  const visible = new Set(candidates.map((p) => p.personId));
  return bindings.resolutions.flatMap((r) =>
    r.state === 'bound' && !visible.has(r.personId)
      ? [{ fragmentId: r.fragmentId, personId: r.personId }]
      : [],
  );
}
/** Repair may retain existing stale pairs, never introduce new ones. Capture
 * allowed pairs BEFORE awaits; validate fresh candidates again after writes.
 * true means every bound person is currently valid, which resume requires.
 */
export function requireBindingCandidateFence(
  bindings: RecordingBindings,
  candidates: { personId: string }[],
  allowed: ReturnType<typeof boundCandidateGaps>,
): boolean {
  const gaps = boundCandidateGaps(bindings, candidates);
  if (
    gaps.some(
      (gap) =>
        !allowed.some(
          (old) =>
            old.fragmentId === gap.fragmentId && old.personId === gap.personId,
        ),
    )
  )
    throw new SpeakerBindingError(
      'forbidden',
      '原绑定人员已不在当前可见候选范围',
    );
  return gaps.length === 0;
}
/** Reads and actual resume still require an entirely valid ledger. */
export function requireBoundCandidates(
  bindings: RecordingBindings,
  candidates: { personId: string }[],
) {
  requireBindingCandidateFence(bindings, candidates, []);
}
export function projectSpeakerBindings(
  s: SpeakerBindingSnapshot,
  a: SpeakerBindingAuthority,
  accountId: string,
) {
  requireSpeakerAccess(s, a, accountId, false);
  const candidates = speakerCandidates(s, a);
  requireBoundCandidates(s.bindings, candidates);
  return {
    recordingId: s.transcript.recordingId,
    transcriptVersionId: s.transcript.id,
    bindingRevision: s.bindings.revision,
    inventoryComplete: s.inventoryComplete,
    items: s.transcript.fragments.map((f) => {
      const resolution = s.bindings.resolutions.find(
        (v) => v.fragmentId === f.source.fragmentId,
      )!;
      const item = speakerItemSchema.parse({
        kind: 'speaker',
        itemId: f.reviewItemId,
        recordingId: s.transcript.recordingId,
        transcriptVersionId: s.transcript.id,
        source: f.source,
        quote: f.quote,
        speakerId: f.providerSpeakerId ?? f.source.fragmentId,
        bindingRevision: s.bindings.revision,
        candidates,
        state: resolution.state,
        ...(resolution.state === 'bound'
          ? { personId: resolution.personId }
          : {}),
      });
      const review =
        resolution.state === 'pending' || resolution.state === 'deferred'
          ? materialReviewItemSchema.parse({
              kind: 'speaker',
              batchId: s.batchId,
              materialId: s.materialId,
              evaluationNodeId: s.evaluationNodeId,
              originalVersionId: s.transcript.originalVersionId,
              revision: s.itemRevisions[f.reviewItemId],
              itemId: f.reviewItemId,
              recordingId: s.transcript.recordingId,
              transcriptVersionId: s.transcript.id,
              speakerId: item.speakerId,
              source: f.source,
              quote: f.quote,
              candidates,
              state: resolution.state,
            })
          : null;
      return {
        item,
        review,
        itemRevision: s.itemRevisions[f.reviewItemId]!,
        providerSpeakerId: f.providerSpeakerId,
      };
    }),
  };
}
export function speakerBindingFingerprint(input: SpeakerBindingCommand) {
  const value = speakerBindingCommandSchema.parse(input);
  return createHash('sha256')
    .update(
      JSON.stringify([
        value.batchId,
        value.itemId,
        value.expectedRevision,
        value.resolution,
      ]),
    )
    .digest('hex');
}
/** The vendor speaker ID identifies a transcript group, never an employee. */
export function planSpeakerBinding(input: {
  snapshot: SpeakerBindingSnapshot;
  authority: SpeakerBindingAuthority;
  accountId: string;
  command: SpeakerBindingCommand;
  now: string;
}): SpeakerBindingPlan {
  const { snapshot: s, authority: a, accountId, now } = input;
  const command = speakerBindingCommandSchema.parse(input.command);
  requireSpeakerAccess(s, a, accountId, true);
  z.iso.datetime().parse(now);
  if (
    s.inventoryComplete !== true ||
    s.otherReviewItemIds === null ||
    s.otherBlockingReviewItemIds === null
  )
    conflict('完整语段或本材料待核对阻塞事实尚未就绪');
  const selected = s.transcript.fragments.find(
    (f) => f.reviewItemId === command.itemId,
  );
  if (s.batchId !== command.batchId || !selected)
    throw new SpeakerBindingError('not_found', '待核对条目不存在或不可见');
  if (s.itemRevisions[command.itemId] !== command.expectedRevision)
    conflict('条目版本已变化，请刷新后重试');
  const resolution = command.resolution;
  if (
    resolution.action === 'bind' &&
    !speakerCandidates(s, a).some((p) => p.personId === resolution.personId)
  )
    throw new SpeakerBindingError('forbidden', '绑定人员不在当前候选范围');
  const group = s.transcript.fragments.filter((f) =>
    selected.providerSpeakerId === null
      ? f.source.fragmentId === selected.source.fragmentId
      : f.providerSpeakerId === selected.providerSpeakerId,
  );
  const groupIds = new Set(group.map((f) => f.source.fragmentId));
  const current = s.bindings.resolutions.filter((r) =>
    groupIds.has(r.fragmentId),
  );
  if (
    resolution.action === 'defer' &&
    current.some((r) => r.state === 'bound' || r.state === 'irrelevant')
  )
    conflict('已确认绑定需先显式撤销，不能改为稍后');
  const candidates = speakerCandidates(s, a);
  const desired = (
    fragmentId: string,
  ): RecordingBindings['resolutions'][number] => {
    switch (resolution.action) {
      case 'bind':
        return { fragmentId, state: 'bound', personId: resolution.personId };
      case 'mark_irrelevant':
        return { fragmentId, state: 'irrelevant' };
      case 'unbind':
        return { fragmentId, state: 'pending', candidates };
      case 'defer':
        return { fragmentId, state: 'deferred', candidates };
    }
  };
  const identity = (r: RecordingBindings['resolutions'][number]) =>
    r.state === 'bound'
      ? JSON.stringify(['bound', r.personId])
      : r.state === 'irrelevant'
        ? 'irrelevant'
        : 'unresolved';
  const changedIds = new Set(
    current
      .filter((r) => {
        const next = desired(r.fragmentId);
        return r.state !== next.state || identity(r) !== identity(next);
      })
      .map((r) => r.fragmentId),
  );
  const changed = changedIds.size > 0;
  const bindingChanged = current.some(
    (r) => identity(r) !== identity(desired(r.fragmentId)),
  );
  let invalidatedDraftIds: string[] = [];
  if (bindingChanged) {
    const derived = s.derived;
    if (
      derived === null ||
      derived.bindingRevision !== s.bindings.revision ||
      ![derived.draftIds, derived.confirmedResultIds].every(
        (ids) => new Set(ids).size === ids.length && ids.every(nonblank),
      ) ||
      derived.draftIds.some((id) => derived.confirmedResultIds.includes(id))
    )
      conflict('当前绑定版本的草稿与确认事实尚未就绪');
    if (derived.confirmedResultIds.length)
      conflict('已确认结果需要846显式修订，不能静默重绑');
    invalidatedDraftIds = [...derived.draftIds];
  }
  const revision = s.bindings.revision + (bindingChanged ? 1 : 0);
  if (!positive(revision)) conflict('绑定修订号超出范围');
  const bindings: RecordingBindings = {
    revision,
    resolutions: s.bindings.resolutions.map((r) =>
      changedIds.has(r.fragmentId) ? desired(r.fragmentId) : structuredClone(r),
    ),
  };
  const allBindingsValid = requireBindingCandidateFence(
    bindings,
    candidates,
    boundCandidateGaps(s.bindings, candidates),
  );
  const itemRevisions = { ...s.itemRevisions };
  if (changed)
    for (const f of group) {
      const next = itemRevisions[f.reviewItemId]! + 1;
      if (!positive(next)) conflict('条目修订号超出范围');
      itemRevisions[f.reviewItemId] = next;
    }
  const decisions = group
    .filter((f) => changedIds.has(f.source.fragmentId))
    .map((f) => {
      const r = desired(f.source.fragmentId);
      return {
        fragmentId: f.source.fragmentId,
        itemId: f.reviewItemId,
        state: r.state,
        personId: r.state === 'bound' ? r.personId : null,
        actorId: a.actor.id,
        actorName: a.actor.name,
        at: now,
        itemRevision: itemRevisions[f.reviewItemId]!,
        bindingRevision: revision,
      };
    });
  const pendingSpeakerItemIds = s.transcript.fragments
    .filter((f) =>
      bindings.resolutions.some(
        (r) =>
          r.fragmentId === f.source.fragmentId &&
          (r.state === 'pending' || r.state === 'deferred'),
      ),
    )
    .map((f) => f.reviewItemId);
  const remainingReviewItemIds = [
    ...pendingSpeakerItemIds,
    ...s.otherReviewItemIds,
  ];
  const blockingReviewItemIds = [
    ...pendingSpeakerItemIds,
    ...s.otherBlockingReviewItemIds,
  ];
  let resume: SpeakerBindingPlan['resume'] = null;
  if (
    bindingChanged &&
    allBindingsValid &&
    (resolution.action === 'bind' || resolution.action === 'mark_irrelevant') &&
    blockingReviewItemIds.length === 0 &&
    s.context.canProcess === true &&
    s.context.cancelRequested === false
  ) {
    const grant = resumeRecordingProcessingSchema.parse({
      recordingId: s.transcript.recordingId,
      transcriptVersionId: s.transcript.id,
      bindingRevision: revision,
      operationId: command.operationId,
    });
    resume = {
      grant,
      work: {
        ...grant,
        action: 'resume',
        jobId: s.context.jobId,
        attempt: s.context.attempt,
      },
      operationKey:
        'speaker-resume:' +
        createHash('sha256')
          .update(
            JSON.stringify([
              s.transcript.recordingId,
              s.transcript.originalVersionId,
              s.transcript.id,
              revision,
            ]),
          )
          .digest('hex'),
    };
  }
  const receipt = materialReviewResolutionReceiptSchema.options[0].parse({
    kind: 'speaker',
    batchId: s.batchId,
    materialId: s.materialId,
    itemId: command.itemId,
    revision: itemRevisions[command.itemId],
    resolution,
    remainingReviewItemIds,
    blockingReviewItemIds,
    invalidatedDraftIds: [],
    resume: null,
  });
  // Validate the full frozen union too: options[0] alone omits its refinements.
  materialReviewResolutionReceiptSchema.parse(receipt);
  return {
    changed,
    bindingChanged,
    expectedBindingRevision: s.bindings.revision,
    expectedItemRevision: command.expectedRevision,
    membershipRevision: s.membershipRevision,
    bindings,
    itemRevisions,
    decisions,
    invalidatedDraftIds,
    resume,
    receipt,
  };
}
