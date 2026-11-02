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
      sql`${t.rowId} ~ '[^[:space:]]' and ${t.ordinal} > 0 and ${t.reviewIndex} >= 0 and ${t.revision} > 0 and jsonb_typeof(${t.parsed}) = 'object'`,
    ),
    // A confirmation is whole or absent, and never ahead of the row.
    check(
      'records_interview_import_row_confirmation',
      sql`(${t.confirmedCandidateId} is null and ${t.confirmedForRevision} is null and ${t.confirmedByAccountId} is null and ${t.confirmedAt} is null) or (${t.confirmedCandidateId} is not null and ${t.confirmedForRevision} is not null and ${t.confirmedByAccountId} is not null and ${t.confirmedAt} is not null and ${t.confirmedForRevision} <= ${t.revision})`,
    ),
    check(
      'records_interview_import_row_decision',
      sql`(${t.decision} is null and ${t.decisionRevision} is null) or (jsonb_typeof(${t.decision}) = 'object' and ${t.decision} ? 'status' and ${t.decisionRevision} is not null and ${t.decisionRevision} <= ${t.revision})`,
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
