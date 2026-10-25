import {
  pgTable,
  text,
  date,
  integer,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
export const projects = pgTable(
  'staffing_projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    status: text('status', {
      enum: ['筹备中', '进行中', '已结束', '已归档'],
    }).notNull(),
    goal: text('goal').notNull(),
    organizationId: text('organization_id').notNull(),
    cohortId: text('cohort_id'),
    isTopic: boolean('is_topic').notNull().default(false),
    ownerId: text('owner_id'),
    creatorId: text('creator_id').notNull(),
    from: date('starts_on').notNull(),
    to: date('ends_on').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('staffing_projects_cohort_idx').on(t.cohortId)],
);
export const members = pgTable(
  'staffing_members',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    personId: text('person_id').notNull(),
    role: text('role').notNull(),
    mode: text('mode').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    by: text('by').notNull(),
  },
  (t) => [
    index('staffing_members_person_idx').on(t.personId),
    uniqueIndex('staffing_members_unique_idx').on(
      t.projectId,
      t.personId,
      t.validFrom,
    ),
  ],
);
export const memberLogs = pgTable('staffing_member_logs', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  at: date('at').notNull(),
  text: text('text').notNull(),
  by: text('by').notNull(),
});
export const createRequests = pgTable(
  'staffing_create_requests',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    requestId: text('request_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
  },
  (t) => [
    uniqueIndex('staffing_request_account_key_idx').on(
      t.accountId,
      t.requestId,
    ),
  ],
);
