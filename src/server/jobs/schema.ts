import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import type { JobErrorCode, JobStatus } from '../../contracts/jobs';
import type { JobRecord } from './state';
export const jobSnapshots = pgTable(
  'job_snapshots',
  {
    jobId: text('job_id').primaryKey(),
    kind: text('kind').notNull(),
    resourceId: text('resource_id').notNull(),
    inputVersion: text('input_version').notNull(),
    status: text('status').$type<JobStatus>().notNull(),
    attempt: integer('attempt').notNull(),
    revision: integer('revision').notNull(),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    result: jsonb('result').$type<unknown>(),
    errorCode: text('error_code').$type<JobErrorCode>(),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (t) => [
    check('job_attempt_positive', sql`${t.attempt} > 0`),
    check('job_revision_positive', sql`${t.revision} > 0`),
    check(
      'job_status_valid',
      sql`${t.status} in ('queued', 'running', 'partial', 'awaiting_manual', 'failed', 'completed', 'cancelled')`,
    ),
    check(
      'job_error_valid',
      sql`${t.errorCode} is null or ${t.errorCode} in ('processing_failed', 'input_changed', 'dependency_unavailable')`,
    ),
    check(
      'job_cancelled_fenced',
      sql`${t.status} <> 'cancelled' or ${t.cancelRequestedAt} is not null`,
    ),
  ],
);
export const jobOperations = pgTable(
  'job_operations',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobSnapshots.jobId),
    accountId: text('account_id').notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    record: jsonb('record').$type<JobRecord>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.accountId, t.operationId] })],
);
