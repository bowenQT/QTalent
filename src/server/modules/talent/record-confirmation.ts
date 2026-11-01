import { createHash } from 'node:crypto';
import {
  RECORD_UNDO_WINDOW_MS,
  recordBatchDraftSetSchema,
  recordSaveReceiptSchema,
  type RecordBatchDraft,
  type RecordBatchDraftSet,
  type RecordInput,
  type RecordSaveInput,
  type RecordSaveResult,
  type RecordUndoInput,
  type RecordUndoResult,
} from '../../../contracts/record';
import type { MaterialSourceReference } from '../../../contracts/sources';
import type { ReviewQueueItem } from '../../../contracts/review-queue';
import {
  canConfirmOwnNodeScore,
  canReadNodeTalent,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import type { TalentKind } from '../../authz/talent';
import { canReadProject } from '../../authz';

type SaveReceipt = Extract<RecordSaveResult, { status: 'success' }>['result'];
type UndoReceipt = Extract<RecordUndoResult, { status: 'success' }>['result'];
export type ConfirmationCommand =
  | { action: 'save'; input: RecordSaveInput }
  | { action: 'undo'; input: RecordUndoInput };
export interface ConfirmationFact {
  id: string;
  eventId: string;
  personId: string;
  evaluationNodeId: string;
  dimensionId: string;
  evaluatorId: string;
  active: boolean;
  revision: number;
  value: number | null;
}
export interface ConfirmationSourceFact {
  reference: MaterialSourceReference;
  complete: boolean;
  /** Exact canonical text for this immutable fragment/version and location. */
  excerpt: string;
  subjects: { evaluationNodeId: string; personId: string }[];
  kind: TalentKind;
  requiredKinds: TalentKind[];
}
export interface ConfirmationRules {
  dimensionVersionId: string;
  anchorVersionId: string;
  anchors: {
    id: string;
    dimensionId: string;
    value: number;
    text: string;
    ruleVersion: string;
  }[];
}
export interface ConfirmationSaveFact {
  receipt: SaveReceipt;
  draft: RecordBatchDraft;
  originalInput: RecordInput;
  createdEventIds: string[];
  withdrawnAt: string | null;
}
export type ConfirmationOperation = {
  actorAccountId: string;
  operationId: string;
  fingerprint: string;
  draft: RecordBatchDraft;
} & (
  | { action: 'save'; receipt: SaveReceipt }
  | { action: 'undo'; receipt: UndoReceipt }
);
export interface ConfirmationState {
  draftSet: RecordBatchDraftSet;
  /** Canonical server selection for this retained draft version, never client input. */
  projectId: string | null;
  withdrawnDraftIds: string[];
  mappings: { draftId: string; personId: string; eventId: string }[];
  confirmations: ConfirmationFact[];
  reviews: {
    id: string;
    confirmationIds: string[];
    handled: boolean;
    withdrawn: boolean;
  }[];
  saves: ConfirmationSaveFact[];
  operations: ConfirmationOperation[];
}
export type PlannedConfirmation = ConfirmationFact & {
  active: true;
  previousId: string | null;
  previousRevision: number | null;
  dimensionVersionId: string;
  anchorVersionId: string;
  anchor: ConfirmationRules['anchors'][number] | null;
  references: MaterialSourceReference[];
  confirmedAt: string;
  reason: string;
};
export type ConfirmationGap = {
  id: string;
  kind: Exclude<ReviewQueueItem['kind'], 'recalibration'>;
  confirmationId: string;
  counterpartConfirmationId: string | null;
};
export type ConfirmationPlan =
  | {
      action: 'save';
      replayed: false;
      draft: RecordBatchDraft;
      expectedDraftRevision: number;
      input: RecordSaveInput;
      receipt: SaveReceipt;
      createdEvents: { personId: string; eventId: string }[];
      confirmations: PlannedConfirmation[];
      reviews: ConfirmationGap[];
    }
  | {
      action: 'undo';
      replayed: false;
      draft: RecordBatchDraft;
      expectedDraftRevision: number;
      receipt: UndoReceipt;
    }
  | {
      action: 'save' | 'undo';
      replayed: true;
      receipt: SaveReceipt | UndoReceipt;
    };
export class ConfirmationError extends Error {
  constructor(
    readonly status: 'forbidden' | 'conflict' | 'not_found' | 'unavailable',
    readonly reason: string,
  ) {
    super(reason);
  }
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function confirmationSemanticKey(value: unknown): string {
  if (Array.isArray(value))
    return '[' + value.map(confirmationSemanticKey).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(
          ([key, entry]) =>
            JSON.stringify(key) + ':' + confirmationSemanticKey(entry),
        )
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function confirmationFingerprint(command: ConfirmationCommand): string {
  const input =
    command.action === 'save'
      ? {
          ...command.input,
          personIds: [...command.input.personIds].sort(),
          decisions: [...command.input.decisions].sort(
            (a, b) =>
              compare(a.personId, b.personId) ||
              compare(a.dimensionId, b.dimensionId),
          ),
        }
      : command.input;
  return createHash('sha256')
    .update(confirmationSemanticKey({ action: command.action, input }))
    .digest('hex');
}
function previous(
  state: ConfirmationState,
  accountId: string,
  command: ConfirmationCommand,
) {
  return state.operations.find(
    (row) =>
      row.actorAccountId === accountId &&
      row.action === command.action &&
      row.operationId === command.input.operation_id,
  );
}
/** Replays authorize the exact retained draft/source snapshot, not a newer draft. */
export function confirmationAuthorizationDraft(
  state: ConfirmationState,
  accountId: string,
  command: ConfirmationCommand,
): RecordBatchDraft {
  const old = previous(state, accountId, command);
  if (old) return structuredClone(old.draft);
  if (command.action === 'undo') {
    const saved = state.saves.find(
      (row) => row.receipt.saveId === command.input.saveId,
    );
    if (!saved) throw new ConfirmationError('not_found', 'save_not_found');
    return structuredClone(saved.draft);
  }
  const set = recordBatchDraftSetSchema.safeParse(state.draftSet);
  if (!set.success)
    throw new ConfirmationError('unavailable', 'draft_state_invalid');
  const draft = set.data.drafts.find(
    (row) => row.draftId === command.input.draftId,
  );
  if (!draft) throw new ConfirmationError('not_found', 'draft_not_found');
  return draft;
}
export function requireConfirmationAuthority(
  context: EvaluationAuthzContext,
  draft: RecordBatchDraft,
  sources?: ConfirmationSourceFact[],
) {
  if (
    !draft.personIds.every((personId) =>
      canConfirmOwnNodeScore(context, {
        evaluationNodeId: draft.evaluationNodeId,
        personId,
        raterId: context.account.personId,
      }),
    )
  )
    throw new ConfirmationError(
      'forbidden',
      'current_node_confirmation_required',
    );
  if (sources === undefined) return;
  const key = (ref: MaterialSourceReference) => confirmationSemanticKey(ref);
  if (
    sources.length !== draft.sourceReferences.length ||
    new Set(sources.map((row) => key(row.reference))).size !== sources.length ||
    draft.sourceReferences.some(
      (ref) => !sources.some((row) => key(row.reference) === key(ref)),
    )
  )
    throw new ConfirmationError('unavailable', 'complete_sources_required');
  for (const source of sources) {
    if (
      !source.complete ||
      !source.excerpt.trim() ||
      !source.subjects.length ||
      !source.subjects.some(
        (subject) =>
          subject.evaluationNodeId === draft.evaluationNodeId &&
          draft.personIds.includes(subject.personId),
      )
    )
      throw new ConfirmationError('unavailable', 'complete_sources_required');
    for (const subject of source.subjects)
      for (const kind of new Set([source.kind, ...source.requiredKinds]))
        if (!canReadNodeTalent(context, { ...subject, kind }, 'source-read'))
          throw new ConfirmationError('forbidden', 'source_not_visible');
  }
  for (const score of draft.scores) {
    if (score.state !== 'suggested') continue;
    if (
      score.citations.some(
        (citation) =>
          !sources.some(
            (source) =>
              key(source.reference) === key(citation.reference) &&
              source.excerpt.includes(citation.quote),
          ),
      )
    )
      throw new ConfirmationError('conflict', 'quote_not_verbatim');
  }
}
export function planRecordConfirmation(input: {
  accountId: string;
  command: ConfirmationCommand;
  state: ConfirmationState;
  context: EvaluationAuthzContext;
  sources: ConfirmationSourceFact[];
  rules: ConfirmationRules | null;
  wallNow: string;
  newId(): string;
}): ConfirmationPlan {
  const { accountId, command, state, context, newId } = input;
  if (context.account.id !== accountId)
    throw new ConfirmationError('forbidden', 'account_changed');
  const draft = confirmationAuthorizationDraft(state, accountId, command);
  requireConfirmationAuthority(context, draft, input.sources);
  const projectId =
    command.action === 'save' ? command.input.projectId : state.projectId;
  if (projectId !== null) {
    const project = context.projects.find((row) => row.id === projectId);
    if (!project || !canReadProject(context, project))
      throw new ConfirmationError('forbidden', 'project_not_visible');
  }
  const old = previous(state, accountId, command);
  if (old) {
    if (old.fingerprint !== confirmationFingerprint(command))
      throw new ConfirmationError('conflict', 'operation_payload_changed');
    return {
      action: command.action,
      replayed: true,
      receipt: structuredClone(old.receipt),
    };
  }
  const wallTime = Date.parse(input.wallNow);
  if (!Number.isFinite(wallTime))
    throw new ConfirmationError('unavailable', 'invalid_server_clock');
  if (command.action === 'undo') {
    const saved = state.saves.find(
      (row) => row.receipt.saveId === command.input.saveId,
    )!;
    if (saved.receipt.savedBy !== accountId)
      throw new ConfirmationError('forbidden', 'save_owner_required');
    const elapsed = wallTime - Date.parse(saved.receipt.savedAt);
    if (
      !Number.isFinite(elapsed) ||
      saved.withdrawnAt !== null ||
      elapsed < 0 ||
      elapsed >= RECORD_UNDO_WINDOW_MS
    )
      throw new ConfirmationError('conflict', 'undo_window_closed');
    if (
      saved.receipt.confirmationIds.some(
        (id) => !state.confirmations.some((row) => row.id === id && row.active),
      ) ||
      state.confirmations.some(
        (row) =>
          row.active &&
          saved.createdEventIds.includes(row.eventId) &&
          !saved.receipt.confirmationIds.includes(row.id),
      ) ||
      state.reviews.some(
        (row) =>
          !row.withdrawn &&
          row.handled &&
          row.confirmationIds.some((id) =>
            saved.receipt.confirmationIds.includes(id),
          ),
      )
    )
      throw new ConfirmationError('conflict', 'later_confirmation_or_review');
    return {
      action: 'undo',
      replayed: false,
      draft,
      expectedDraftRevision:
        state.draftSet.drafts.find((row) => row.draftId === draft.draftId)
          ?.revision ?? draft.revision,
      receipt: structuredClone({
        saveId: saved.receipt.saveId,
        withdrawnEvents: saved.receipt.events.filter((row) =>
          saved.createdEventIds.includes(row.eventId),
        ),
        withdrawnConfirmationIds: saved.receipt.confirmationIds,
        withdrawnReviewItemIds: saved.receipt.reviewItemIds,
        originalInput: saved.originalInput,
      }),
    };
  }
  const request = command.input;
  if (request.projectId !== state.projectId)
    throw new ConfirmationError('conflict', 'project_selection_changed');
  if (state.withdrawnDraftIds.includes(draft.draftId))
    throw new ConfirmationError('conflict', 'draft_withdrawn');
  if (request.expected_revision !== draft.revision)
    throw new ConfirmationError('conflict', 'draft_revision_changed');
  if (
    state.draftSet.duplicateCandidates.some((candidate) =>
      candidate.draftIds.includes(draft.draftId),
    )
  )
    throw new ConfirmationError('conflict', 'duplicate_decision_required');
  if (
    request.personIds.length !== draft.personIds.length ||
    request.personIds.some((id) => !draft.personIds.includes(id))
  )
    throw new ConfirmationError('conflict', 'draft_subjects_changed');
  const rules = input.rules;
  if (
    !rules ||
    rules.dimensionVersionId !== draft.dimensionVersionId ||
    rules.anchorVersionId !== draft.anchorVersionId
  )
    throw new ConfirmationError('unavailable', 'frozen_rules_required');
  for (const score of draft.scores) {
    if (
      score.state === 'suggested' &&
      !rules.anchors.some(
        (anchor) =>
          anchor.id === score.anchor.id &&
          anchor.text === score.anchor.text &&
          anchor.dimensionId === score.dimensionId &&
          anchor.value === score.value &&
          anchor.ruleVersion === draft.anchorVersionId,
      )
    )
      throw new ConfirmationError('conflict', 'frozen_suggestion_invalid');
  }
  const mapped = state.mappings.filter((row) => row.draftId === draft.draftId);
  if (
    mapped.length &&
    (mapped.length !== draft.personIds.length ||
      new Set(mapped.map((row) => row.personId)).size !== mapped.length ||
      new Set(mapped.map((row) => row.eventId)).size !== mapped.length ||
      mapped.some((row) => !draft.personIds.includes(row.personId)))
  )
    throw new ConfirmationError('unavailable', 'event_mapping_invalid');
  const createdEvents = mapped.length
    ? []
    : draft.personIds.map((personId) => ({ personId, eventId: newId() }));
  const events = mapped.length
    ? mapped.map(({ personId, eventId }) => ({ personId, eventId }))
    : createdEvents;
  const confirmations: PlannedConfirmation[] = [];
  const reviews: ConfirmationGap[] = [];
  for (const decision of request.decisions) {
    const suggestion = draft.scores.find(
      (row) =>
        row.personId === decision.personId &&
        row.dimensionId === decision.dimensionId,
    );
    if (!suggestion)
      throw new ConfirmationError('conflict', 'draft_score_missing');
    const eventId = events.find(
      (row) => row.personId === decision.personId,
    )!.eventId;
    const peers = state.confirmations.filter(
      (row) =>
        row.eventId === eventId &&
        row.dimensionId === decision.dimensionId &&
        row.active,
    );
    if (
      peers.some(
        (row) =>
          row.personId !== decision.personId ||
          row.evaluationNodeId !== draft.evaluationNodeId,
      )
    )
      throw new ConfirmationError(
        'unavailable',
        'confirmation_identity_invalid',
      );
    const ownHistory = state.confirmations.filter(
      (row) =>
        row.eventId === eventId &&
        row.dimensionId === decision.dimensionId &&
        row.evaluatorId === context.account.personId,
    );
    if (ownHistory.some((row) => row.active))
      throw new ConfirmationError('conflict', 'confirmation_already_exists');
    const previous = ownHistory.reduce<ConfirmationFact | null>(
      (latest, row) =>
        !latest || row.revision > latest.revision ? row : latest,
      null,
    );
    // Only an accepted native undo permits another confirmation. Historical
    // deactivation or an HR correction must not become a new scoring path.
    if (
      previous &&
      !state.saves.some(
        (saved) =>
          saved.withdrawnAt !== null &&
          saved.draft.draftId === draft.draftId &&
          saved.receipt.savedBy === accountId &&
          saved.receipt.confirmationIds.includes(previous.id),
      )
    )
      throw new ConfirmationError('conflict', 'confirmation_already_exists');
    const value =
      decision.action === 'unknown'
        ? null
        : decision.action === 'edit'
          ? decision.value
          : suggestion.state === 'suggested'
            ? suggestion.value
            : null;
    if (decision.action === 'confirm' && value === null)
      throw new ConfirmationError('conflict', 'unknown_cannot_be_scored');
    const anchors =
      value === null
        ? []
        : rules.anchors.filter(
            (row) =>
              row.dimensionId === decision.dimensionId &&
              row.value === value &&
              row.ruleVersion === draft.anchorVersionId &&
              (decision.action !== 'confirm' ||
                (suggestion.state === 'suggested' &&
                  row.id === suggestion.anchor.id &&
                  row.text === suggestion.anchor.text)),
          );
    if (value !== null && anchors.length !== 1)
      throw new ConfirmationError('conflict', 'frozen_anchor_unresolved');
    const reason = decision.action === 'confirm' ? '' : decision.reason;
    const confirmation: PlannedConfirmation = {
      id: newId(),
      eventId,
      personId: decision.personId,
      evaluationNodeId: draft.evaluationNodeId,
      dimensionId: decision.dimensionId,
      evaluatorId: context.account.personId,
      active: true,
      revision: (previous?.revision ?? 0) + 1,
      previousId: previous?.id ?? null,
      previousRevision: previous?.revision ?? null,
      value,
      anchor: anchors[0] ?? null,
      // This describes the version transition, not a supplied scoring rationale.
      reason:
        previous && !reason.trim()
          ? '本人撤销后重新确认；本次未填写评分理由'
          : reason,
      references: structuredClone(draft.sourceReferences),
      dimensionVersionId: draft.dimensionVersionId,
      anchorVersionId: draft.anchorVersionId,
      confirmedAt: input.wallNow,
    };
    confirmations.push(confirmation);
    // BOW-844 reviewActiveItemSchema: absolute difference >=2; unknown is never zero.
    if (value !== null) {
      if (
        suggestion.state === 'suggested' &&
        Math.abs(value - suggestion.value) >= 2 &&
        !reason.trim()
      )
        reviews.push({
          id: newId(),
          kind: 'ai_gap',
          confirmationId: confirmation.id,
          counterpartConfirmationId: null,
        });
      for (const peer of peers)
        if (peer.value !== null && Math.abs(value - peer.value) >= 2)
          reviews.push({
            id: newId(),
            kind: 'rater_gap',
            confirmationId: confirmation.id,
            counterpartConfirmationId: peer.id,
          });
    }
  }
  return {
    action: 'save',
    replayed: false,
    draft,
    expectedDraftRevision: draft.revision,
    input: structuredClone(request),
    createdEvents,
    confirmations,
    reviews,
    receipt: recordSaveReceiptSchema.parse({
      saveId: newId(),
      events,
      revision: draft.revision + 1,
      confirmationIds: confirmations.map((row) => row.id),
      reviewItemIds: reviews.map((row) => row.id),
      savedBy: accountId,
      savedAt: input.wallNow,
      undoUntil: new Date(wallTime + RECORD_UNDO_WINDOW_MS).toISOString(),
    }),
  };
}
