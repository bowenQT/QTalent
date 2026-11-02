import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
  check,
  foreignKey,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { accountBindings, people } from '../../directory';
import { evaluationNodes } from '../../programs';
import type { InterviewReviewResult } from '../attachments/interview-review/types';
import type { MaterialReviewItem } from '../../../../contracts/material-review';
import { auditEvents } from '../../../platform/audit/schema';
import {
  originals,
  originalVersions,
  fragments,
  materialParses,
} from '../schema';

/**
 * One interview PDF import awaiting HR row by row (BOW-906). The batch, its rows and
 * HR's stored confirmation live here; filing a historical evaluation does not (no
 * profile projection yet), so a row is never "imported" by these tables.
 */
export const interviewImportBatches = pgTable(
  'records_interview_import_batches',
  {
    id: text('id').primaryKey(),
    evaluationNodeId: text('evaluation_node_id')
      .notNull()
      .references(() => evaluationNodes.id),
    fileName: text('file_name').notNull(),
    pageCount: integer('page_count').notNull(),
    uploadedByPersonId: text('uploaded_by_person_id').references(
      () => people.id,
    ),
    uploadedAt: timestamp('uploaded_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    demo: boolean('demo').notNull(),
  },
  (t) => [
    check(
      'records_interview_import_batch',
      sql`${t.id} ~ '[^[:space:]]' and ${t.fileName} ~ '[^[:space:]]' and ${t.pageCount} > 0`,
    ),
  ],
);

/**
 * The recruitment records a batch is checked against. Only demo records exist (there is
 * no recruiting source yet); a missing position code or interview time stays null and is
 * never derived from the PDF, the file name or HR's confirmation.
 */
export const interviewImportCandidates = pgTable(
  'records_interview_import_candidates',
  {
    batchId: text('batch_id')
      .notNull()
      .references(() => interviewImportBatches.id),
    candidateId: text('candidate_id').notNull(),
    name: text('name').notNull(),
    personId: text('person_id').references(() => people.id),
    positionCode: text('position_code'),
    interviewTime: text('interview_time'),
    status: text('status', {
      enum: ['hired', 'rejected', 'offer_pending', 'offer_declined'],
    }).notNull(),
    demo: boolean('demo').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.candidateId] }),
    check(
      'records_interview_import_candidate',
      sql`${t.candidateId} ~ '[^[:space:]]' and ${t.name} ~ '[^[:space:]]' and ${t.status} in ('hired','rejected','offer_pending','offer_declined') and (${t.positionCode} is null or ${t.positionCode} ~ '[^[:space:]]') and (${t.interviewTime} is null or ${t.interviewTime} ~ '[^[:space:]]')`,
    ),
  ],
);

/**
 * One parsed review of the PDF. `revision` is the row's compare-and-set version: every
 * HR change advances it, and a confirmation only counts for the revision it was made on.
 * `decision` is the 906 plan stored for `decisionRevision`, a compact projection that the
 * parsed review and the fragment can rebuild in full.
 */
export const interviewImportRows = pgTable(
  'records_interview_import_rows',
  {
    batchId: text('batch_id')
      .notNull()
      .references(() => interviewImportBatches.id),
    rowId: text('row_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    materialId: text('material_id')
      .notNull()
      .references(() => originals.id),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => originalVersions.id),
    parseVersionId: text('parse_version_id').notNull(),
    fragmentId: text('fragment_id').notNull(),
    reviewIndex: integer('review_index').notNull(),
    parsed: jsonb('parsed').$type<InterviewReviewResult>().notNull(),
    revision: integer('revision').notNull().default(1),
    confirmedCandidateId: text('confirmed_candidate_id'),
    confirmedForRevision: integer('confirmed_for_revision'),
    confirmedByAccountId: text('confirmed_by_account_id').references(
      () => accountBindings.accountId,
    ),
    confirmedAt: timestamp('confirmed_at', {
      withTimezone: true,
      mode: 'string',
    }),
    /** HR's entries for unread items by item name; never written into `parsed`. */
    filled: jsonb('filled')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    decision: jsonb('decision').$type<InterviewImportDecision>(),
    decisionRevision: integer('decision_revision'),
  },
  (t) => [
    primaryKey({ columns: [t.batchId, t.rowId] }),
    unique('records_interview_import_row_ordinal').on(t.batchId, t.ordinal),
    foreignKey({
      name: 'records_interview_import_row_parse',
      columns: [t.parseVersionId, t.originalVersionId],
      foreignColumns: [materialParses.id, materialParses.originalVersionId],
    }),
    foreignKey({
      name: 'records_interview_import_row_fragment',
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
    foreignKey({
      name: 'records_interview_import_row_candidate',
      columns: [t.batchId, t.confirmedCandidateId],
      foreignColumns: [
        interviewImportCandidates.batchId,
        interviewImportCandidates.candidateId,
      ],
    }),
    check(
      'records_interview_import_row',
      sql`${t.rowId} ~ '[^[:space:]]' and ${t.ordinal} > 0 and ${t.reviewIndex} >= 0 and ${t.revision} > 0 and jsonb_typeof(${t.parsed}) = 'object' and jsonb_typeof(${t.filled}) = 'object'`,
    ),
    // A confirmation is whole or absent, and never ahead of the row.
    check(
      'records_interview_import_row_confirmation',
      sql`(${t.confirmedCandidateId} is null and ${t.confirmedForRevision} is null and ${t.confirmedByAccountId} is null and ${t.confirmedAt} is null) or (${t.confirmedCandidateId} is not null and ${t.confirmedForRevision} is not null and ${t.confirmedByAccountId} is not null and ${t.confirmedAt} is not null and ${t.confirmedForRevision} <= ${t.revision})`,
    ),
    check(
      'records_interview_import_row_decision',
      sql`coalesce((${t.decision} is null and ${t.decisionRevision} is null) or (jsonb_typeof(${t.decision}) = 'object' and ${t.decision} ? 'status' and ${t.decisionRevision} is not null and ${t.decisionRevision} <= ${t.revision}), false)`,
    ),
  ],
);

/** What HR's change replaced and produced on one row: the confirmation, decision and
 * HR's entries for unread items, as stored before and after it. */
export type InterviewImportRowState = {
  confirmation: {
    candidateId: string;
    forRevision: number;
    byAccountId: string;
    at: string;
  } | null;
  decision: InterviewImportDecision | null;
  filled: Record<string, string>;
};

/**
 * Every HR change to a row, appended in the same transaction that changes the row and
 * never updated: the row holds only the latest state. Each operation moves the row one
 * revision and is linked to its audit event.
 */
export const interviewImportOperations = pgTable(
  'records_interview_import_operations',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    rowId: text('row_id').notNull(),
    action: text('action', {
      enum: ['confirm', 'revert', 'fill', 'send_to_review'],
    }).notNull(),
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull(),
    fromRevision: integer('from_revision').notNull(),
    toRevision: integer('to_revision').notNull(),
    before: jsonb('before').$type<InterviewImportRowState>().notNull(),
    after: jsonb('after').$type<InterviewImportRowState>().notNull(),
    auditId: text('audit_id')
      .notNull()
      .references(() => auditEvents.id),
  },
  (t) => [
    unique('records_interview_import_operation_revision').on(
      t.batchId,
      t.rowId,
      t.toRevision,
    ),
    unique('records_interview_import_operation_audit').on(t.auditId),
    foreignKey({
      name: 'records_interview_import_operation_row',
      columns: [t.batchId, t.rowId],
      foreignColumns: [interviewImportRows.batchId, interviewImportRows.rowId],
    }),
    check(
      'records_interview_import_operation',
      sql`coalesce(${t.id} ~ '[^[:space:]]' and ${t.action} in ('confirm','revert','fill','send_to_review') and ${t.fromRevision} > 0 and ${t.toRevision} = ${t.fromRevision} + 1 and jsonb_typeof(${t.before}) = 'object' and jsonb_typeof(${t.after}) = 'object', false)`,
    ),
  ],
);

/**
 * A question an import row waits on in 待核对 (BOW-906 PR-B). The question keeps the
 * shared MaterialReviewItem contract, so readers map it like a media review item; it
 * hangs on the import row because an interview PDF has no upload or intake chain. One
 * item per row and kind makes sending a row to review idempotent.
 */
export const interviewImportReviewItems = pgTable(
  'records_interview_import_review_items',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    rowId: text('row_id').notNull(),
    kind: text('kind', {
      enum: ['unknown_interview_candidate', 'unknown_interviewer'],
    }).notNull(),
    revision: integer('revision').notNull(),
    state: text('state', {
      enum: ['pending', 'deferred', 'resolved'],
    }).notNull(),
    question: jsonb('question').$type<MaterialReviewItem>().notNull(),
    createdByAccountId: text('created_by_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    auditId: text('audit_id')
      .notNull()
      .references(() => auditEvents.id),
  },
  (t) => [
    foreignKey({
      name: 'records_interview_import_review_item_row',
      columns: [t.batchId, t.rowId],
      foreignColumns: [interviewImportRows.batchId, interviewImportRows.rowId],
    }),
    unique('records_interview_import_review_item_kind').on(
      t.batchId,
      t.rowId,
      t.kind,
    ),
    check(
      'records_interview_import_review_item',
      sql`${t.kind} in ('unknown_interview_candidate','unknown_interviewer') and ${t.state} in ('pending','deferred','resolved') and ${t.revision} > 0 and jsonb_typeof(${t.question}) = 'object' and (${t.question}->'itemId') is not distinct from to_jsonb(${t.id}) and (${t.question}->'kind') is not distinct from to_jsonb(${t.kind}) and (${t.question}->'batchId') is not distinct from to_jsonb(${t.batchId}) and (${t.question}->'importRowId') is not distinct from to_jsonb(${t.rowId})`,
    ),
  ],
);

/** What the 906 plan decided for one row revision; never a filing receipt. */
export type InterviewImportDecision = {
  status:
    | 'forbidden'
    | 'not_ready'
    | 'skipped'
    | 'conflict'
    | 'needs_review'
    | 'duplicate'
    | 'planned';
  reason?: string;
  personId?: string;
  candidateId?: string;
  interviewerId?: string;
  duplicateKey?: string;
  reviewItemKind?: string;
  decidedAt: string;
  decidedByAccountId: string;
};
