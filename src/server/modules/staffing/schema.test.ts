import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { createRequests, members, projects } from './schema';
it('enforces account-scoped request uniqueness and one member join per start date', () => {
  const request = getTableConfig(createRequests);
  expect(
    request.indexes.find(
      (i) => i.config.name === 'staffing_request_account_key_idx',
    )?.config.unique,
  ).toBe(true);
  expect(
    request.columns
      .filter((c) =>
        ['account_id', 'request_id', 'fingerprint', 'project_id'].includes(
          c.name,
        ),
      )
      .every((c) => c.notNull),
  ).toBe(true);
  expect(
    getTableConfig(members).indexes.find(
      (i) => i.config.name === 'staffing_members_unique_idx',
    )?.config.unique,
  ).toBe(true);
  expect(
    getTableConfig(projects).indexes.some(
      (i) => i.config.name === 'staffing_projects_cohort_idx',
    ),
  ).toBe(true);
});
