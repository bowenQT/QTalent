import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  date,
  jsonb,
  timestamp,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { accountBindings, people } from '../../directory';
import { events } from '../schema';
import type {
  RecordInput,
  RecordBatchDraft,
  RecordBatchDraftSet,
  RecordSaveInput,
  RecordSaveResult,
  RecordUndoResult,
} from '../../../../contracts/record';

type SaveReceipt = Extract<RecordSaveResult, { status: 'success' }>['result'];
type UndoReceipt = Extract<RecordUndoResult, { status: 'success' }>['result'];

/** Trusted producer facts have no synthetic production defaults. No full draft set is duplicated here. */
export const recordDraftBatches = pgTable(
  'records_draft_batches',
  {
    batchId: text('batch_id').primaryKey(),
    revision: integer('revision').notNull(),
    duplicateCandidates: jsonb('duplicate_candidates')
      .$type<RecordBatchDraftSet['duplicateCandidates']>()
      .notNull(),
    originalInput: jsonb('original_input').$type<RecordInput>().notNull(),
    occurredOn: date('occurred_on').notNull(),
    modelVersion: text('model_version').notNull(),
    createdByAccountId: text('created_by_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check('records_draft_batch_revision_positive', sql`${t.revision} > 0`),
    check(
      'records_draft_batch_model_required',
      sql`length(trim(${t.modelVersion})) > 0`,
    ),
  ],
);

/** Stable globally unique draft rows provide native row locks and revision fences. */
export const recordDrafts = pgTable(
  'records_drafts',
  {
    draftId: text('draft_id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => recordDraftBatches.batchId),
    revision: integer('revision').notNull(),
    draft: jsonb('draft').$type<RecordBatchDraft>().notNull(),
  },
  (t) => [
    check('records_draft_revision_positive', sql`${t.revision} > 0`),
    check(
      'records_draft_snapshot_identity',
      sql`jsonb_typeof(${t.draft}) = 'object' and (${t.draft}->'batchId') is not distinct from to_jsonb(${t.batchId}) and (${t.draft}->'draftId') is not distinct from to_jsonb(${t.draftId}) and (${t.draft}->'revision') is not distinct from to_jsonb(${t.revision})`,
    ),
  ],
);

/** A later evaluator reuses the same per-person event; mappings are server facts. */
export const recordDraftEvents = pgTable(
  'records_draft_events',
  {
    batchId: text('batch_id')
      .notNull()
      .references(() => recordDraftBatches.batchId),
    draftId: text('draft_id')
      .notNull()
      .references(() => recordDrafts.draftId),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    eventId: text('event_id')
      .notNull()
      .unique()
      .references(() => events.id),
  },
  (t) => [primaryKey({ columns: [t.batchId, t.draftId, t.personId] })],
);

/** A save retains its original actor and exact draft for current-authorized replay/undo. */
export const recordSaves = pgTable('records_saves', {
  saveId: text('save_id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => recordDraftBatches.batchId),
  draftId: text('draft_id')
    .notNull()
    .references(() => recordDrafts.draftId),
  actorAccountId: text('actor_account_id')
    .notNull()
    .references(() => accountBindings.accountId),
  actorPersonId: text('actor_person_id')
    .notNull()
    .references(() => people.id),
  draftSnapshot: jsonb('draft_snapshot').$type<RecordBatchDraft>().notNull(),
  input: jsonb('input').$type<RecordSaveInput>().notNull(),
  originalInput: jsonb('original_input').$type<RecordInput>().notNull(),
  receipt: jsonb('receipt').$type<SaveReceipt>().notNull(),
  createdEventIds: jsonb('created_event_ids').$type<string[]>().notNull(),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
});

/** Effects, audit and the exact accepted receipt commit atomically with this ledger. */
export const recordOperations = pgTable(
  'records_operations',
  {
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    action: text('action', { enum: ['save', 'undo'] }).notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    saveId: text('save_id')
      .notNull()
      .references(() => recordSaves.saveId),
    draftSnapshot: jsonb('draft_snapshot').$type<RecordBatchDraft>().notNull(),
    receipt: jsonb('receipt').$type<SaveReceipt | UndoReceipt>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorAccountId, t.action, t.operationId] }),
    check('records_operation_action', sql`${t.action} in ('save','undo')`),
    check(
      'records_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
