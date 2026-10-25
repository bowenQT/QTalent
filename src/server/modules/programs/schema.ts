import { pgTable, text, boolean, date, index } from 'drizzle-orm/pg-core';
export const cohorts = pgTable('programs_cohorts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});
export const enrollments = pgTable(
  'programs_enrollments',
  {
    id: text('id').primaryKey(),
    cohortId: text('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    personId: text('person_id').notNull(),
    confirmed: boolean('confirmed').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    revokedAt: date('revoked_at'),
  },
  (t) => [
    index('programs_enrollments_cohort_person_idx').on(t.cohortId, t.personId),
  ],
);
export const assignments = pgTable(
  'programs_assignments',
  {
    id: text('id').primaryKey(),
    cohortId: text('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    personId: text('person_id').notNull(),
    studentId: text('student_id').notNull(),
    kind: text('kind', { enum: ['mentor', 'assistant'] }).notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    revokedAt: date('revoked_at'),
  },
  (t) => [index('programs_assignments_person_idx').on(t.personId, t.cohortId)],
);
