import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  unique,
  check,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { originals, originalVersions, fragments } from '../schema';
import type { UploadIntent, UploadCompletion, UploadCollection } from './types';

/** Attachment identity/count container, not an event draft or save ledger. */
export const uploadCollections = pgTable(
  'records_upload_collections',
  {
    id: text('id').primaryKey(),
    creatorAccountId: text('creator_account_id').notNull(),
    operationId: text('operation_id').notNull(),
    target: jsonb('target').$type<UploadCollection['target']>().notNull(),
    targetFingerprint: text('target_fingerprint').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    revision: integer('revision').notNull(),
  },
  (t) => [
    unique('records_upload_collection_operation').on(
      t.creatorAccountId,
      t.operationId,
    ),
    check(
      'records_upload_collection_fingerprint',
      sql`${t.targetFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check('records_upload_collection_revision', sql`${t.revision} > 0`),
    check(
      'records_upload_collection_window',
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      'records_upload_collection_target',
      sql`coalesce(jsonb_typeof(${t.target}) = 'object' and ${t.target}->>'kind' in ('people','event'), false)`,
    ),
  ],
);
/** Schema only; parent generates migration after 852 -> 846, never in parallel. */
export const uploadIntents = pgTable(
  'records_upload_intents',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    quotaScope: text('quota_scope').notNull(),
    recordCollectionId: text('record_collection_id')
      .notNull()
      .references(() => uploadCollections.id),
    request: jsonb('request').$type<UploadIntent['request']>().notNull(),
    declaredBytes: bigint('declared_bytes', { mode: 'number' }).notNull(),
    objectKey: text('object_key').notNull().unique(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    revision: integer('revision').notNull(),
    completionOperationId: text('completion_operation_id'),
    completionFingerprint: text('completion_fingerprint'),
    completed: jsonb('completed').$type<UploadCompletion>(),
    releasedAt: bigint('released_at', { mode: 'number' }),
    releaseOperationId: text('release_operation_id'),
    releaseFingerprint: text('release_fingerprint'),
  },
  (t) => [
    unique('records_upload_operation').on(t.accountId, t.operationId),
    index('records_upload_quota').on(t.quotaScope, t.expiresAt),
    check(
      'records_upload_size',
      sql`coalesce(${t.declaredBytes} > 0 and ${t.declaredBytes} <= 2147483648 and (${t.request}->>'declaredBytes')::bigint = ${t.declaredBytes}, false)`,
    ),
    check('records_upload_revision', sql`${t.revision} > 0`),
    check(
      'records_upload_release',
      sql`(${t.releasedAt} is null and ${t.releaseOperationId} is null and ${t.releaseFingerprint} is null) or (${t.releasedAt} is not null and ${t.releaseOperationId} is not null and ${t.releaseFingerprint} is not null and ${t.releaseFingerprint} ~ '^[a-f0-9]{64}$')`,
    ),
    check(
      'records_upload_collection_scope',
      sql`coalesce(${t.quotaScope} = ${t.recordCollectionId} and ${t.request}->>'recordCollectionId' = ${t.recordCollectionId}, false)`,
    ),
    check(
      'records_upload_fingerprint',
      sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'records_upload_completion',
      sql`(${t.completed} is null and ${t.completionOperationId} is null and ${t.completionFingerprint} is null) or (${t.completed} is not null and ${t.completionOperationId} is not null and ${t.completionFingerprint} is not null and ${t.completionFingerprint} ~ '^[a-f0-9]{64}$')`,
    ),
  ],
);
export const uploadObjects = pgTable(
  'records_upload_objects',
  {
    originalVersionId: text('original_version_id')
      .primaryKey()
      .references(() => originalVersions.id),
    uploadId: text('upload_id')
      .notNull()
      .unique()
      .references(() => uploadIntents.id),
    objectKey: text('object_key').notNull().unique(),
    byteLength: bigint('byte_length', { mode: 'number' }).notNull(),
    mediaType: text('media_type').notNull(),
    sha256: text('sha256').notNull(),
    etag: text('etag').notNull(),
  },
  (t) => [
    check(
      'records_upload_object_size',
      sql`${t.byteLength} > 0 and ${t.byteLength} <= 2147483648`,
    ),
    check('records_upload_object_digest', sql`${t.sha256} ~ '^[a-f0-9]{64}$'`),
  ],
);
export const uploadReadTickets = pgTable(
  'records_upload_read_tickets',
  {
    digest: text('digest').primaryKey(),
    accountId: text('account_id').notNull(),
    fragmentId: text('fragment_id'),
    originalId: text('original_id')
      .notNull()
      .references(() => originals.id),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => uploadObjects.originalVersionId),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    requestedRange:
      jsonb('requested_range').$type<
        import('./types').ReadTicket['requestedRange']
      >(),
  },
  (t) => [
    check('records_upload_ticket_digest', sql`${t.digest} ~ '^[a-f0-9]{64}$'`),
    index('records_upload_ticket_expiry').on(t.expiresAt),
    foreignKey({
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
  ],
);
