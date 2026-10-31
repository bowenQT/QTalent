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
} from '../../modules/records/attachments/interview-review/types';
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
  /** The frozen parser does NOT supply these two observed fields. Missing means not ready. */
  observedIdentity: { name: string | null; positionCode: string | null } | null;
  candidates: {
    candidateId: string;
    personId: string | null;
    name: string;
    positionCode: string;
    interviewTime: string;
    status: 'hired' | 'rejected' | 'offer_pending' | 'offer_declined';
  }[];
  /** A stored HR preview confirmation, not a client-selected directory id. */
  confirmedCandidateId: string | null;
  directory: Pick<typeof people.$inferSelect, 'id' | 'name'>[];
  employments: Pick<
    typeof employments.$inferSelect,
    'personId' | 'validFrom' | 'validTo'
  >[];
  /** Separately resolved canonical fragment; never calculated from PDF box coordinates here. */
  source: unknown;
  existing: (InterviewImportIdentity & { evaluationId: string })[];
  pendingInterviewer: MaterialReviewItem | null;
  resolution: MaterialReviewCommand | null;
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
  | 'interviewer_directory_missing';
export type InterviewImportPlan =
  | { status: 'forbidden' }
  | { status: 'not_ready'; reason: NotReadyReason }
  | { status: 'skipped'; reason: 'not_hired' }
  | { status: 'needs_review'; item: MaterialReviewItem; resume: null }
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
  if (facts.parsed.status === 'rejected') return notReady('parser_rejected');
  const review = facts.parsed.reviews[facts.reviewIndex];
  if (
    !Number.isInteger(facts.reviewIndex) ||
    !review ||
    Object.values(review.metadata).some(
      (field) => field === null || !field.value.trim(),
    ) ||
    [
      ...review.dimensions.map((row) => row.selection),
      review.interviewRating,
      review.suggestedLevel,
    ].some((selection) => selection.status === 'unrecognized')
  )
    return notReady('parser_manual_input');
  // Metadata completeness above narrows the semantic state, not the external type.
  const interviewTime = review.metadata.interviewTime!.value;
  const observed = facts.observedIdentity;
  if (!observed?.name?.trim() || !observed.positionCode?.trim())
    return notReady('candidate_identity_missing');
  const matches = facts.candidates.filter(
    (candidate) =>
      candidate.candidateId === facts.confirmedCandidateId &&
      candidate.name === observed.name &&
      candidate.positionCode === observed.positionCode &&
      candidate.interviewTime === interviewTime,
  );
  if (matches.length !== 1) return notReady('candidate_match_unconfirmed');
  const candidate = matches[0];
  // A rejected application stays excluded even if this person already exists.
  if (candidate.status !== 'hired')
    return { status: 'skipped', reason: 'not_hired' };
  const personId = candidate.personId;
  if (
    !personId ||
    !facts.directory.some(
      (person) => person.id === personId && person.name === candidate.name,
    )
  )
    return notReady('candidate_directory_missing');
  if (
    !context.evaluationNodes.some(
      (node) => node.id === facts.evaluationNodeId && node.kind === 'interview',
    ) ||
    !canManageNodeAssignments(context, facts.evaluationNodeId, personId)
  )
    return { status: 'forbidden' };
  // An application flag / passing interview is not employment. Do not invent a
  // new former-employee exclusion: current access is independently checked above.
  if (
    !facts.employments.some(
      (entry) =>
        entry.personId === personId &&
        Date.parse(entry.validFrom) <= Date.parse(context.now),
    )
  )
    return notReady('employment_unverified');
  const checkedSource = materialSourceSchema.safeParse(facts.source);
  if (
    !checkedSource.success ||
    checkedSource.data.sourceCategory !== 'historical_evaluation' ||
    checkedSource.data.originalVersionId !== facts.originalVersionId ||
    checkedSource.data.location.kind !== 'pdf' ||
    checkedSource.data.location.page !== review.templateSource.page ||
    checkedSource.data.demo !== review.demo
  )
    return notReady('pdf_source_unverified');
  if (!facts.materialId?.trim()) return notReady('material_identity_missing');
  const pdfLocation = checkedSource.data.location;
  const source = checkedSource.data;
  const observedInterviewer = review.metadata.interviewer!.value;
  let interviewerId: string | undefined;
  let resumed = false;
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
    if (facts.resolution === null)
      return { status: 'needs_review', item, resume: null };
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
    if (command.resolution.action === 'defer')
      return { status: 'needs_review', item, resume: null };
    const selectedId = command.resolution.personId;
    const selected = facts.directory.filter(
      (person) => person.id === selectedId,
    );
    if (selected.length !== 1) return notReady('interviewer_directory_missing');
    interviewerId = selected[0].id;
    resumed = true;
  } else {
    const matches = facts.directory.filter(
      (person) => person.name === observedInterviewer,
    );
    if (matches.length === 1) interviewerId = matches[0].id;
  }
  if (interviewerId === undefined) {
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
    return { status: 'needs_review', item, resume: null };
  }
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
