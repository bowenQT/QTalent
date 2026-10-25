import {
  pgTable,
  text,
  boolean,
  integer,
  date,
  index,
} from 'drizzle-orm/pg-core';
export const organizations = pgTable('directory_organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  shortName: text('short_name').notNull(),
});
export const people = pgTable('directory_people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organizations.id),
  photo: text('photo'),
  hue: integer('hue').notNull().default(220),
  noReview: boolean('no_review').notNull().default(false),
  demo: boolean('demo').notNull().default(true),
});
export const accountBindings = pgTable('directory_account_bindings', {
  accountId: text('account_id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => people.id),
  isSystemAdmin: boolean('is_system_admin').notNull().default(false),
});
export const grants = pgTable(
  'directory_grants',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    role: text('role', { enum: ['manager', 'hr', 'mentor'] }).notNull(),
    scope: text('scope', { enum: ['company', 'cohort'] }).notNull(),
    cohortId: text('cohort_id'),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    revokedAt: date('revoked_at'),
  },
  (t) => [index('directory_grants_account_idx').on(t.accountId)],
);
export const employments = pgTable(
  'directory_employments',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
  },
  (t) => [index('directory_employments_person_idx').on(t.personId)],
);
