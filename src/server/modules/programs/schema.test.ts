import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { enrollments, assignments } from './schema';
it('indexes scope resolution and separates confirmed enrollment from teaching relationships', () => {
  const enrollment = getTableConfig(enrollments),
    assignment = getTableConfig(assignments);
  expect(
    enrollment.indexes.some(
      (i) => i.config.name === 'programs_enrollments_cohort_person_idx',
    ),
  ).toBe(true);
  expect(
    enrollment.columns.some((c) => c.name === 'confirmed' && c.notNull),
  ).toBe(true);
  expect(
    assignment.indexes.some(
      (i) => i.config.name === 'programs_assignments_person_idx',
    ),
  ).toBe(true);
  expect(
    assignment.columns.some((c) => c.name === 'student_id' && c.notNull),
  ).toBe(true);
});
