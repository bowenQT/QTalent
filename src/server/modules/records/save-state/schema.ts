import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  unique,
  check,
} from 'drizzle-orm/pg-core';
import { events } from '../schema';
import type {
  RecordDraft,
  RecordSaveResult,
  RecordUndoResult,
} from '../../../../contracts/record';

export interface DraftEvidence {
  personId: string;
  dimensionId: string;
  fragmentId: string;
  originalVersionId: string;
  modelVersion: string;
  rationale: string;
  suggestedValue: number | null;
}
export const recordDrafts = pgTable(
  'records_drafts',
  {
    id: text('id').primaryKey(),
    creatorAccountId: text('creator_account_id').notNull(),
    revision: integer('revision').notNull(),
    ruleVersionId: text('rule_version_id').notNull(),
    draft: jsonb('draft').$type<Omit<RecordDraft, 'revision'>>().notNull(),
    sources: jsonb('sources')
      .$type<
        {
          fragmentId: string;
          originalVersionId: string;
          subjects: { personId: string; cohortId: string | null }[];
        }[]
      >()
      .notNull(),
    evidence: jsonb('evidence').$type<DraftEvidence[]>().notNull(),
  },
  (t) => [check('records_draft_revision', sql`${t.revision} > 0`)],
);

export const recordSaves = pgTable('records_saves', {
  id: text('id').primaryKey(),
  draftId: text('draft_id')
    .notNull()
    .references(() => recordDrafts.id),
  actorAccountId: text('actor_account_id').notNull(),
  actorPersonId: text('actor_person_id').notNull(),
  personIds: jsonb('person_ids').$type<string[]>().notNull(),
  projectId: text('project_id'),
  savedAt: timestamp('saved_at', { withTimezone: true }).notNull(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  confirmationIds: jsonb('confirmation_ids').$type<string[]>().notNull(),
  reviewIds: jsonb('review_ids').$type<string[]>().notNull(),
});

export const recordDraftEvents = pgTable(
  'records_draft_events',
  {
    eventId: text('event_id')
      .primaryKey()
      .references(() => events.id),
    draftId: text('draft_id')
      .notNull()
      .references(() => recordDrafts.id),
    personId: text('person_id').notNull(),
    createdSaveId: text('created_save_id')
      .notNull()
      .references(() => recordSaves.id),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [unique('records_draft_person_event').on(t.draftId, t.personId)],
);

export const recordOperations = pgTable(
  'records_operations',
  {
    id: text('id').primaryKey(),
    actorAccountId: text('actor_account_id').notNull(),
    action: text('action', { enum: ['save', 'undo'] }).notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    draftId: text('draft_id')
      .notNull()
      .references(() => recordDrafts.id),
    result: jsonb('result')
      .$type<RecordSaveResult | RecordUndoResult>()
      .notNull(),
  },
  (t) => [
    unique('records_operation_key').on(
      t.actorAccountId,
      t.action,
      t.operationId,
    ),
    check('records_operation_action', sql`${t.action} in ('save','undo')`),
  ],
);
