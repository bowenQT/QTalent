import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { StaffingDemand } from '../../../../contracts/staffing';
import type { MaasMetadata } from '../../../integrations/maas';
import { projects } from '../schema';

export const demandRoots = pgTable(
  'staffing_demands',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    initiatorAccountId: text('initiator_account_id').notNull(),
    initiatorPersonId: text('initiator_person_id').notNull(),
    inputText: text('input_text').notNull(),
    createdAt: text('created_at').notNull(),
    currentRevision: integer('current_revision').notNull().default(0),
    promptVersion: text('prompt_version').notNull(),
    retryable: boolean('retryable').notNull().default(false),
    failureKind: text('failure_kind'),
  },
  (t) => [
    check(
      'staffing_demand_revision_nonnegative',
      sql`${t.currentRevision} >= 0`,
    ),
  ],
);
export const demandVersions = pgTable(
  'staffing_demand_versions',
  {
    demandId: text('demand_id')
      .notNull()
      .references(() => demandRoots.id),
    revision: integer('revision').notNull(),
    demand: jsonb('demand').$type<StaffingDemand>().notNull(),
    promptVersion: text('prompt_version').notNull(),
    modelMetadata: jsonb('model_metadata').$type<MaasMetadata>().notNull(),
    actorAccountId: text('actor_account_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.demandId, t.revision] }),
    check('staffing_demand_version_positive', sql`${t.revision} > 0`),
  ],
);
export const demandOperations = pgTable(
  'staffing_demand_operations',
  {
    accountId: text('account_id').notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    demandId: text('demand_id')
      .notNull()
      .references(() => demandRoots.id),
    revision: integer('revision'),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.operationId] })],
);
