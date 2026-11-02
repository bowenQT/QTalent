import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { accountBindings, people } from '../../directory';
import { evaluationNodes } from '../../programs';
import { projects } from '../../staffing';
import { jobSnapshots } from '../../../jobs/schema';
import { wecomBindings } from '../../../auth/entry/schema';
import { arrangeInputs } from '../arrange/input-state/schema';
import type { WecomArchivedMedia } from './facts';

export const wecomMessages = pgTable(
  'records_wecom_messages',
  {
    key: text('key').primaryKey(),
    scope: text('scope').notNull(),
    botId: text('bot_id').notNull(),
    senderId: text('sender_id').notNull(),
    messageId: text('message_id').notNull(),
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    actorPersonId: text('actor_person_id')
      .notNull()
      .references(() => people.id),
    credentialId: text('credential_id')
      .notNull()
      .references(() => wecomBindings.id),
    credentialRevision: integer('credential_revision').notNull(),
    inputDigest: text('input_digest').notNull(),
    partCount: integer('part_count').notNull(),
    evaluationNodeId: text('evaluation_node_id').references(
      () => evaluationNodes.id,
    ),
    personIds: jsonb('person_ids').$type<string[]>(),
    projectId: text('project_id').references(() => projects.id),
    //873 collection FK must be added from its actual published schema. This is an
    // explicit reference checked by the native writer, not another collection.
    collectionId: text('collection_id'),
    archiveRefs: jsonb('archive_refs').$type<WecomArchivedMedia[]>().notNull(),
    inputId: text('input_id').references(() => arrangeInputs.id),
    batchId: text('batch_id'),
    jobId: text('job_id').references(() => jobSnapshots.jobId),
    revision: integer('revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('records_wecom_message_identity').on(
      t.scope,
      t.botId,
      t.senderId,
      t.messageId,
    ),
    check(
      'records_wecom_message_digests',
      sql`${t.key} ~ '^[a-f0-9]{64}$' and ${t.inputDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'records_wecom_message_revisions',
      sql`${t.revision} > 0 and ${t.credentialRevision} > 0 and ${t.partCount} between 1 and 20 and ${t.updatedAt} >= ${t.createdAt}`,
    ),
    check(
      'records_wecom_message_target',
      sql`(${t.evaluationNodeId} is null and ${t.personIds} is null and ${t.projectId} is null and ${t.collectionId} is null) or (${t.evaluationNodeId} is not null and ${t.personIds} is not null and jsonb_typeof(${t.personIds}) = 'array' and octet_length(${t.personIds}::text) <= 65536 and not jsonb_path_exists(${t.personIds}, '$[*] ? (@.type() != "string" || !(@ like_regex "^.{1,200}$"))'))`,
    ),
    // A processing batch need not have materialized record_draft_batches yet.
    // Native producer facts, not a FK to a future draft, establish this triple.
    check(
      'records_wecom_message_result',
      sql`(${t.inputId} is null and ${t.batchId} is null and ${t.jobId} is null) or (${t.inputId} is not null and ${t.batchId} is not null and ${t.jobId} is not null and ${t.evaluationNodeId} is not null)`,
    ),
    check(
      'records_wecom_archives',
      sql`jsonb_typeof(${t.archiveRefs}) = 'array' and jsonb_array_length(${t.archiveRefs}) <= 20 and octet_length(${t.archiveRefs}::text) <= 16384
    and not jsonb_path_exists(${t.archiveRefs}, '$[*] ? (@.type() != "object" || !exists(@.partIndex) || !exists(@.kind) || !exists(@.uploadId) || !exists(@.originalVersionId) || !exists(@.sha256))')
    and not jsonb_path_exists(${t.archiveRefs}, '$[*].keyvalue() ? (@.key != "partIndex" && @.key != "kind" && @.key != "uploadId" && @.key != "originalVersionId" && @.key != "sha256")')
    and not jsonb_path_exists(${t.archiveRefs}, '$[*] ? (@.partIndex.type() != "number" || @.partIndex < 0 || @.partIndex > 19 || @.partIndex.floor() != @.partIndex || (@.kind != "image" && @.kind != "file") || @.uploadId.type() != "string" || !(@.uploadId like_regex "^.{1,200}$") || @.originalVersionId.type() != "string" || !(@.originalVersionId like_regex "^.{1,200}$") || @.sha256.type() != "string" || !(@.sha256 like_regex "^[a-f0-9]{64}$"))')`,
    ),
  ],
);

export const wecomReceiptAttempts = pgTable(
  'records_wecom_receipt_attempts',
  {
    key: text('key').primaryKey(),
    messageKey: text('message_key')
      .notNull()
      .references(() => wecomMessages.key),
    kind: text('kind', { enum: ['group_ack', 'private_receipt'] }).notNull(),
    batchId: text('batch_id'),
    batchRevision: integer('batch_revision'),
    batchStatus: text('batch_status', {
      enum: ['processing', 'needs_review', 'awaiting_confirmation', 'failed'],
    }),
    fingerprint: text('fingerprint').notNull(),
    state: text('state', {
      enum: ['reserved', 'acknowledged', 'outcome_unknown'],
    }).notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => [
    unique('records_wecom_receipt_identity')
      .on(t.messageKey, t.kind, t.batchId, t.batchRevision, t.batchStatus)
      .nullsNotDistinct(),
    check(
      'records_wecom_receipt_digests',
      sql`${t.key} ~ '^[a-f0-9]{64}$' and ${t.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'records_wecom_receipt_shape',
      sql`(${t.kind} = 'group_ack' and ${t.batchId} is null and ${t.batchRevision} is null and ${t.batchStatus} is null) or (${t.kind} = 'private_receipt' and ${t.batchId} is not null and ${t.batchRevision} is not null and ${t.batchRevision} > 0 and ${t.batchStatus} is not null and ${t.batchStatus} in ('processing','needs_review','awaiting_confirmation','failed'))`,
    ),
    check(
      'records_wecom_receipt_state',
      sql`(${t.state} in ('reserved','outcome_unknown') and ${t.acknowledgedAt} is null) or (${t.state} = 'acknowledged' and ${t.acknowledgedAt} is not null and ${t.acknowledgedAt} >= ${t.attemptedAt})`,
    ),
  ],
);
