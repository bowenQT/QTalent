import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  primaryKey,
  check,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { accountBindings } from '../../directory';
import { jobSnapshots } from '../../../jobs/schema';
import { demandVersions } from '../demand/schema';
import type { MatchRun, StoredMatchOperation } from './types';

/** Migration generation is serialized by the parent after jobs and demand. */
export const matchRuns = pgTable(
  'staffing_match_runs',
  {
    id: text('id')
      .primaryKey()
      .references(() => jobSnapshots.jobId),
    demandId: text('demand_id').notNull(),
    demandRevision: integer('demand_revision').notNull(),
    initiatorAccountId: text('initiator_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    payload: jsonb('payload').$type<MatchRun>().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.demandId, table.demandRevision],
      foreignColumns: [demandVersions.demandId, demandVersions.revision],
    }),
    index('staffing_match_demand_idx').on(table.demandId, table.demandRevision),
    check(
      'staffing_match_identity',
      sql`coalesce(${table.payload}->>'id' = ${table.id} and ${table.payload}->>'initiatorAccountId' = ${table.initiatorAccountId} and ${table.payload}->'demand'->>'id' = ${table.demandId} and (${table.payload}->'demand'->>'revision')::integer = ${table.demandRevision} and ${table.demandRevision} > 0 and ${table.payload}->'demand'->>'status' = 'confirmed' and ${table.payload}->>'schemaVersion' = '1', false)`,
    ),
  ],
);
export const matchOperations = pgTable(
  'staffing_match_operations',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    operationId: text('operation_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => matchRuns.id),
    payload: jsonb('payload').$type<StoredMatchOperation>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.operationId] }),
    check(
      'staffing_match_operation_identity',
      sql`coalesce(${table.payload}->>'runId' = ${table.runId}, false)`,
    ),
  ],
);
