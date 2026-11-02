import { createHash } from 'node:crypto';
import { activeGrants } from '../../authz';
import {
  canManageNodeAssignments,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import type { people, employments } from '../../modules/directory/schema';
import type {
  InterviewReviewResult,
  ParsedInterviewReview,
  PdfRegion,
  Selection,
} from '../../modules/records/attachments/interview-review/types';
import {
  INTERVIEW_DIMENSION_OPTIONS,
  INTERVIEW_TEMPLATES,
} from '../../modules/records/attachments/interview-review/templates';
import {
  materialSourceSchema,
  type MaterialSource,
} from '../../../contracts/sources';
import {
  materialReviewItemSchema,
  materialReviewCommandSchema,
  type MaterialReviewItem,
  type MaterialReviewCommand,
} from '../../../contracts/material-review';

import {
  readInterviewRowSnapshot,
  committedInterviewResolution,
  sameInterviewReview,
  type InterviewRowSnapshot,
  type CommittedInterviewResolution,
} from './review-state';

/** Trusted server snapshot, not a transport request or a persisted authorization. */
export interface InterviewImportFacts {
  context: EvaluationAuthzContext;
  batchId: string;
  rowId: string;
  evaluationNodeId: string;
  originalVersionId: string;
  materialId: string | null;
  parsed: InterviewReviewResult;
  reviewIndex: number;
  /** Name comes from 900 identity.candidateName; positionCode requires an authoritative recruitment record. Never infer it from the PDF or filename. */
  observedIdentity: { name: string | null; positionCode: string | null } | null;
  candidates: {
    candidateId: string;
    personId: string | null;
    name: string;
    /** Null when the recruitment record does not carry it; never inferred. */
    positionCode: string | null;
    interviewTime: string | null;
    status: 'hired' | 'rejected' | 'offer_pending' | 'offer_declined';
  }[];
  /** A stored HR preview confirmation, not a client-selected directory id. */
  confirmedCandidateId: string | null;
  /** Actual stored preview confirmation bound to the current row revision. */
  confirmedForRowRevision: number | null;
  confirmedInterviewerId: string | null;
  directory: Pick<typeof people.$inferSelect, 'id' | 'name'>[];
  employments: Pick<
    typeof employments.$inferSelect,
    'personId' | 'validFrom' | 'validTo'
  >[];
  /** Separately resolved canonical fragment; never calculated from PDF box coordinates here. */
  source: unknown;
  existing: (InterviewImportIdentity & { evaluationId: string })[];
  /** Loaded under the row/source locks. Null is unavailable, never unimported. */
  rowSnapshot: InterviewRowSnapshot | null;
  pendingCandidate: MaterialReviewItem | null;
  candidateResolution: MaterialReviewCommand | null;
  resolvedCandidate: CommittedInterviewResolution | null;
  resolvedInterviewer: CommittedInterviewResolution | null;
  pendingInterviewer: MaterialReviewItem | null;
  resolution: MaterialReviewCommand | null;
  /** HR's entries for items the parser could not read, stored on the row for one row
   * revision. They never replace the parsed review; absent means none were made. */
  manualInput?: {
    forRowRevision: number;
    values: Readonly<Record<string, string>>;
  } | null;
}
export interface InterviewImportIdentity {
  candidateId: string;
  interviewTime: string;
  interviewerId: string;
  template: string;
}
type NotReadyReason =
  | 'candidate_identity_missing'
  | 'candidate_match_unconfirmed'
  | 'candidate_directory_missing'
  | 'employment_unverified'
  | 'parser_rejected'
  | 'parser_manual_input'
  | 'pdf_source_unverified'
  | 'material_identity_missing'
  | 'resume_conflict'
  | 'interviewer_directory_missing'
  | 'row_snapshot_unavailable'
  | 'resolution_snapshot_unavailable'
  | 'remaining_review_blockers'
  | 'candidate_confirmation_stale'
  | 'interviewer_confirmation_stale'
  | 'review_revision_unavailable'
  | 'manual_input_stale';
export type InterviewImportPlan =
  | { status: 'forbidden' }
  | { status: 'not_ready'; reason: NotReadyReason }
  | { status: 'skipped'; reason: 'not_hired' | 'original_only' }
  | { status: 'conflict'; reason: 'interview_row_imported' }
  | {
      status: 'needs_review';
      item: MaterialReviewItem;
      hasHiddenContent: boolean;
      resume: null;
    }
  | {
      status: 'duplicate';
      evaluationId: string;
      batchId: string;
      rowId: string;
      resume: null;
    }
  | {
      status: 'planned';
      batchId: string;
      rowId: string;
      personId: string;
      evaluationNodeId: string;
      identity: InterviewImportIdentity;
      duplicateKey: string;
      originalReview: ParsedInterviewReview;
      /** HR's entries for the unread items, apart from the parsed review. */
      manualEntries: {
        item: string;
        value: string;
        source: PdfRegion;
        enteredBy: 'hr';
      }[];
      source: MaterialSource;
      signatures: {
        interviewerId: string;
        importerPersonId: string;
        importerAccountId: string;
        plannedAt: string;
        interviewerConfirmedInSystem: false;
      };
      resume: {
        batchId: string;
        rowId: string;
        originalVersionId: string;
      } | null;
    };
const notReady = (reason: NotReadyReason): InterviewImportPlan => ({
  status: 'not_ready',
  reason,
});
const identityParts = (value: InterviewImportIdentity) => [
  value.candidateId,
  value.interviewTime,
  value.interviewerId,
  value.template,
];
const identityKey = (value: InterviewImportIdentity) =>
  JSON.stringify(identityParts(value));

/** Pure row decision. No PDF execution, IO, model call, queue or profile write.
 * The future adapter must reload this snapshot after its transaction locks and
 * enforce the PDF execution boundary before invoking the parser. A planned
 * value is not a DB receipt, a human score confirmation, or a source-read grant.
 */
export function planInterviewImport(
  facts: InterviewImportFacts,
): InterviewImportPlan {
  const { context } = facts;
  if (!activeGrants(context).some((grant) => grant.role === 'hr'))
    return { status: 'forbidden' };
  const checkedSource = materialSourceSchema.safeParse(facts.source);
  if (
    !checkedSource.success ||
    checkedSource.data.sourceCategory !== 'historical_evaluation' ||
    checkedSource.data.originalVersionId !== facts.originalVersionId ||
    checkedSource.data.location.kind !== 'pdf'
  )
    return notReady('pdf_source_unverified');
  if (!facts.materialId?.trim()) return notReady('material_identity_missing');
  const pdfLocation = checkedSource.data.location;
  const source = checkedSource.data;
  const scope = { ...facts, source };
  const checkedRow = readInterviewRowSnapshot(scope, facts.rowSnapshot);
  if (checkedRow.status === 'forbidden') return { status: 'forbidden' };
  if (checkedRow.status === 'unavailable')
    return notReady('row_snapshot_unavailable');
  if (checkedRow.status !== 'available') return notReady('resume_conflict');
  const row = checkedRow.row;
  if (row.import.state === 'imported') {
    if (
      !canManageNodeAssignments(
        context,
        facts.evaluationNodeId,
        row.import.personId,
      )
    )
      return { status: 'forbidden' };
    if (facts.resolution !== null || facts.candidateResolution !== null)
      return { status: 'conflict', reason: 'interview_row_imported' };
    return {
      status: 'duplicate',
      evaluationId: row.import.evaluationId,
      batchId: facts.batchId,
      rowId: facts.rowId,
      resume: null,
    };
  }
  if (facts.parsed.status === 'rejected') return notReady('parser_rejected');
  const review = facts.parsed.reviews[facts.reviewIndex];
  if (
    !Number.isInteger(facts.reviewIndex) ||
    !review ||
    !review.metadata.interviewTime?.value.trim()
  )
    return notReady('parser_manual_input');
  const interviewTime = review.metadata.interviewTime.value;
  if (
    source.location.kind !== 'pdf' ||
    source.location.page !== review.templateSource.page ||
    source.demo !== review.demo
  )
    return notReady('pdf_source_unverified');
  if (
    (facts.resolvedCandidate !== null &&
      (facts.pendingCandidate === null ||
        facts.candidateResolution === null)) ||
    (facts.resolvedInterviewer !== null &&
      (facts.pendingInterviewer === null || facts.resolution === null))
  )
    return notReady('resume_conflict');
  function hold(item: MaterialReviewItem, hidden = false): InterviewImportPlan {
    if (
      item.kind !== 'unknown_interviewer' &&
      item.kind !== 'unknown_interview_candidate'
    )
      return notReady('resume_conflict');
    const candidates = item.candidates.filter(
      (c) =>
        facts.directory.some((p) => p.id === c.personId) &&
        (item.kind === 'unknown_interviewer' ||
          canManageNodeAssignments(
            context,
            facts.evaluationNodeId,
            c.personId,
          )),
    );
    return {
      status: 'needs_review',
      item: {
        ...item,
        candidates: candidates.map((c) => ({
          personId: c.personId,
          displayName: facts.directory.find((p) => p.id === c.personId)!.name,
        })),
      },
      resume: null,
      hasHiddenContent:
        row.hasHiddenContent! ||
        hidden ||
        candidates.length !== item.candidates.length,
    };
  }
  const observed = facts.observedIdentity;
  const observedName = observed?.name?.trim() ? observed.name : null;
  // Match recruitment facts before narrowing by an HR-selected identity. A
  // selected ID must not make an ambiguous name/job/time triple look unique.
  const identityMatches = facts.candidates.filter(
    (candidate) =>
      observedName !== null &&
      !!observed?.positionCode?.trim() &&
      candidate.name === observedName &&
      candidate.positionCode === observed.positionCode &&
      candidate.interviewTime === interviewTime,
  );
  const uniqueCandidate =
    identityMatches.length === 1 ? identityMatches[0] : null;
  if (
    uniqueCandidate &&
    uniqueCandidate.status !== 'hired' &&
    facts.candidateResolution === null &&
    facts.resolution === null
  ) {
    // A fresh row decision can supersede an unresolved identity suggestion;
    // submitted review commands still use the committed-receipt checks below.
    for (const [pending, kind, name] of [
      [facts.pendingCandidate, 'unknown_interview_candidate', observedName],
      [
        facts.pendingInterviewer,
        'unknown_interviewer',
        review.metadata.interviewer?.value ?? null,
      ],
    ] as const) {
      if (pending === null) continue;
      const checked = materialReviewItemSchema.safeParse(pending);
      if (
        !checked.success ||
        checked.data.kind !== kind ||
        !sameInterviewReview(scope, checked.data, kind, name)
      )
        return notReady('resume_conflict');
    }
    if (
      uniqueCandidate.personId !== null &&
      !canManageNodeAssignments(
        context,
        facts.evaluationNodeId,
        uniqueCandidate.personId,
      )
    )
      return { status: 'forbidden' };
    // No profile, resume job, person creation or original deletion is proposed.
    // The next invocation reloads current facts; this is not a permanent tombstone.
    return { status: 'skipped', reason: 'not_hired' };
  }
  if (
    Object.values(review.metadata).some(
      (field) => field === null || !field.value.trim(),
    )
  )
    return notReady('parser_manual_input');
  // HR may fill the items the parser could not read, for this row revision only. Every
  // unread item needs an entry from its own options; nothing else may be entered.
  const unread = unreadInterviewItems(review);
  const manual = facts.manualInput ?? null;
  const entered = manual ? Object.keys(manual.values) : [];
  if (unread.length || entered.length) {
    if (manual && manual.forRowRevision !== row.revision)
      return notReady('manual_input_stale');
    if (
      entered.length !== unread.length ||
      unread.some(
        ({ item, options }) => !options.includes(manual?.values[item] ?? ''),
      )
    )
      return notReady('parser_manual_input');
  }
  const manualEntries = unread.map(({ item, source }) => ({
    item,
    value: manual!.values[item],
    source,
    enteredBy: 'hr' as const,
  }));
  if (
    row.import.state === 'withdrawn' &&
    facts.confirmedForRowRevision !== row.revision
  )
    return notReady('candidate_confirmation_stale');
  let candidateResumed = false;
  let selectedPersonId: string | null = null;
  function candidatePending(): InterviewImportPlan {
    if (row.import.state === 'withdrawn')
      return notReady('review_revision_unavailable');
    const matching = identityMatches;
    const visible = matching.filter(
      (c) =>
        c.personId !== null &&
        facts.directory.some((p) => p.id === c.personId) &&
        canManageNodeAssignments(context, facts.evaluationNodeId, c.personId),
    );
    const candidates = [
      ...new Map(
        visible.map((c) => [
          c.personId!,
          { personId: c.personId!, displayName: c.name },
        ]),
      ).values(),
    ];
    const item = materialReviewItemSchema.parse({
      itemId:
        'interview-candidate:' +
        createHash('sha256')
          .update(
            JSON.stringify([
              facts.batchId,
              facts.rowId,
              facts.originalVersionId,
            ]),
          )
          .digest('hex'),
      batchId: facts.batchId,
      evaluationNodeId: facts.evaluationNodeId,
      materialId: facts.materialId,
      originalVersionId: facts.originalVersionId,
      revision: 1,
      state: 'pending',
      source: {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      },
      kind: 'unknown_interview_candidate',
      importRowId: facts.rowId,
      observedName,
      candidates,
    });
    return hold(
      item,
      matching.some(
        (c) =>
          c.personId !== null &&
          !canManageNodeAssignments(
            context,
            facts.evaluationNodeId,
            c.personId,
          ),
      ),
    );
  }
  if (facts.pendingCandidate !== null || facts.candidateResolution !== null) {
    const parsedItem = materialReviewItemSchema.safeParse(
      facts.pendingCandidate,
    );
    if (
      !parsedItem.success ||
      parsedItem.data.kind !== 'unknown_interview_candidate' ||
      !sameInterviewReview(
        scope,
        parsedItem.data,
        'unknown_interview_candidate',
        observedName,
      )
    )
      return notReady('resume_conflict');
    const item = parsedItem.data;
    const held = hold(item);
    if (facts.candidateResolution === null) return held;
    const command = materialReviewCommandSchema.safeParse(
      facts.candidateResolution,
    );
    if (
      !command.success ||
      command.data.kind !== item.kind ||
      command.data.batchId !== item.batchId ||
      command.data.itemId !== item.itemId ||
      command.data.expectedRevision !== item.revision
    )
      return notReady('resume_conflict');
    if (command.data.resolution.action === 'defer') return held;
    if (facts.resolvedCandidate === null)
      return notReady('resolution_snapshot_unavailable');
    const committed = committedInterviewResolution(
      scope,
      item,
      command.data,
      facts.resolvedCandidate,
      row.revision,
    );
    if (!committed || committed.item.kind !== 'unknown_interview_candidate')
      return notReady('resume_conflict');
    if (committed.item.resolution.action === 'keep_original_only')
      return { status: 'skipped', reason: 'original_only' };
    selectedPersonId = committed.item.resolution.personId;
    if (
      !canManageNodeAssignments(
        context,
        facts.evaluationNodeId,
        selectedPersonId,
      )
    )
      return { status: 'forbidden' };
    candidateResumed = committed.receipt.resume !== null;
  }
  if (!observedName) {
    return selectedPersonId === null
      ? candidatePending()
      : notReady('candidate_identity_missing');
  }
  const positionCode = observed?.positionCode?.trim()
    ? observed.positionCode
    : null;
  // Owner ruling 6560666796 (1): a row whose position code is unavailable waits
  // for HR to say who it is. The current-revision HR confirmation then names the
  // recruitment record directly; the position code stays unknown, never inferred
  // or filled in, and the automatic skip above still needs all three fields.
  if (
    positionCode === null &&
    facts.confirmedCandidateId !== null &&
    facts.confirmedForRowRevision !== row.revision
  )
    return notReady('candidate_confirmation_stale');
  // Automatic pre-confirmation skipping requires uniqueness above. A current
  // HR confirmation instead disambiguates the exact recruitment record below.
  const matches = (
    positionCode === null ? facts.candidates : identityMatches
  ).filter(
    (candidate) =>
      facts.confirmedForRowRevision === row.revision &&
      candidate.candidateId === facts.confirmedCandidateId &&
      candidate.name === observedName &&
      (positionCode === null ||
        (candidate.positionCode === positionCode &&
          candidate.interviewTime === interviewTime)) &&
      (selectedPersonId === null || candidate.personId === selectedPersonId),
  );
  if (matches.length !== 1)
    return selectedPersonId === null
      ? candidatePending()
      : notReady('candidate_match_unconfirmed');
  const candidate = matches[0];
  const personId = candidate.personId;
  if (
    personId &&
    !canManageNodeAssignments(context, facts.evaluationNodeId, personId)
  )
    return { status: 'forbidden' };
  if (candidate.status !== 'hired')
    return { status: 'skipped', reason: 'not_hired' };
  if (
    !personId ||
    !facts.directory.some(
      (person) => person.id === personId && person.name === candidate.name,
    )
  )
    return candidatePending();
  if (
    !facts.employments.some(
      (entry) =>
        entry.personId === personId &&
        Date.parse(entry.validFrom) <= Date.parse(context.now),
    )
  )
    return notReady('employment_unverified');
  const observedInterviewer = review.metadata.interviewer!.value;
  let interviewerId: string | undefined;
  let resumed = candidateResumed;
  if (facts.pendingInterviewer !== null || facts.resolution !== null) {
    const checkedItem = materialReviewItemSchema.safeParse(
      facts.pendingInterviewer,
    );
    if (!checkedItem.success || checkedItem.data.kind !== 'unknown_interviewer')
      return notReady('resume_conflict');
    const item = checkedItem.data;
    if (
      item.batchId !== facts.batchId ||
      item.importRowId !== facts.rowId ||
      item.evaluationNodeId !== facts.evaluationNodeId ||
      item.originalVersionId !== facts.originalVersionId ||
      item.materialId !== facts.materialId ||
      item.observedName !== observedInterviewer ||
      item.source.fragmentId !== source.fragmentId ||
      item.source.location.kind !== 'pdf' ||
      item.source.location.page !== pdfLocation.page ||
      item.source.location.textRange.start !== pdfLocation.textRange.start ||
      item.source.location.textRange.end !== pdfLocation.textRange.end
    )
      return notReady('resume_conflict');
    if (facts.resolution === null) return hold(item);
    const checkedCommand = materialReviewCommandSchema.safeParse(
      facts.resolution,
    );
    if (
      !checkedCommand.success ||
      checkedCommand.data.kind !== 'unknown_interviewer'
    )
      return notReady('resume_conflict');
    const command = checkedCommand.data;
    if (
      command.batchId !== facts.batchId ||
      command.itemId !== item.itemId ||
      command.expectedRevision !== item.revision
    )
      return notReady('resume_conflict');
    if (command.resolution.action === 'defer') return hold(item);
    if (facts.resolvedInterviewer === null)
      return notReady('resolution_snapshot_unavailable');
    const committed = committedInterviewResolution(
      scope,
      item,
      command,
      facts.resolvedInterviewer,
      row.revision,
    );
    if (!committed || committed.item.kind !== 'unknown_interviewer')
      return notReady('resume_conflict');
    const selectedId = committed.item.resolution.personId;
    const selected = facts.directory.filter(
      (person) => person.id === selectedId,
    );
    if (selected.length !== 1) return notReady('interviewer_directory_missing');
    interviewerId = selected[0].id;
    resumed = resumed || committed.receipt.resume !== null;
  } else if (row.import.state === 'withdrawn') {
    const selected = facts.directory.filter(
      (person) => person.id === facts.confirmedInterviewerId,
    );
    if (selected.length !== 1)
      return notReady('interviewer_confirmation_stale');
    interviewerId = selected[0].id;
  } else {
    const matches = facts.directory.filter(
      (person) => person.name === observedInterviewer,
    );
    if (matches.length === 1) interviewerId = matches[0].id;
  }
  if (interviewerId === undefined) {
    if (row.import.state === 'withdrawn')
      return notReady('review_revision_unavailable');
    // A deterministic proposed item permits idempotent creation; persistence and
    // revision CAS still belong to the future transaction adapter.
    const itemId =
      'interview-import:' +
      createHash('sha256')
        .update(
          JSON.stringify([facts.batchId, facts.rowId, facts.originalVersionId]),
        )
        .digest('hex');
    const item = materialReviewItemSchema.parse({
      itemId,
      batchId: facts.batchId,
      evaluationNodeId: facts.evaluationNodeId,
      materialId: facts.materialId,
      originalVersionId: facts.originalVersionId,
      revision: 1,
      state: 'pending',
      source: {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      },
      kind: 'unknown_interviewer',
      importRowId: facts.rowId,
      observedName: observedInterviewer,
      candidates: [],
    });
    return hold(item);
  }
  if (row.blockingReviewItemIds!.length)
    return notReady('remaining_review_blockers');
  const identity = {
    candidateId: candidate.candidateId,
    interviewTime,
    interviewerId,
    template: review.template,
  };
  const duplicate = facts.existing.find(
    (existing) => identityKey(existing) === identityKey(identity),
  );
  if (duplicate)
    return {
      status: 'duplicate',
      evaluationId: duplicate.evaluationId,
      batchId: facts.batchId,
      rowId: facts.rowId,
      resume: null,
    };
  return {
    status: 'planned',
    batchId: facts.batchId,
    rowId: facts.rowId,
    personId,
    evaluationNodeId: facts.evaluationNodeId,
    identity,
    duplicateKey: createHash('sha256')
      .update(identityKey(identity))
      .digest('hex'),
    originalReview: structuredClone(review),
    manualEntries,
    source,
    signatures: {
      interviewerId,
      importerPersonId: context.account.personId,
      importerAccountId: context.account.id,
      plannedAt: context.now,
      interviewerConfirmedInSystem: false,
    },
    resume: resumed
      ? {
          batchId: facts.batchId,
          rowId: facts.rowId,
          originalVersionId: facts.originalVersionId,
        }
      : null,
  };
}

/** The items of a review the parser could not read, with the options HR picks from.
 * Item names are the dimension names and the template's rating and level labels. */
export function unreadInterviewItems(review: ParsedInterviewReview) {
  const template = INTERVIEW_TEMPLATES.find((t) => t.name === review.template);
  const items: {
    item: string;
    selection: Selection;
    options: readonly string[];
  }[] = [
    ...review.dimensions.map((d) => ({
      item: d.name,
      selection: d.selection,
      options: INTERVIEW_DIMENSION_OPTIONS,
    })),
    {
      item: template?.rating.label ?? '面试评级',
      selection: review.interviewRating,
      options: template?.rating.options ?? [],
    },
    {
      item: template?.level.label ?? '建议职级',
      selection: review.suggestedLevel,
      options: template?.level.options ?? [],
    },
  ];
  return items.flatMap(({ item, selection, options }) =>
    selection.status === 'unrecognized'
      ? [{ item, options, source: selection.source }]
      : [],
  );
}
