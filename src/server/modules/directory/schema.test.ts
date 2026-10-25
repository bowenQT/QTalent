import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { people, accountBindings, grants, employments } from './schema';
it('indexes current authorization reads and retains explicit binding/revocation metadata', () => {
  expect(
    getTableConfig(grants).indexes.some(
      (i) => i.config.name === 'directory_grants_account_idx',
    ),
  ).toBe(true);
  expect(
    getTableConfig(grants).columns.some((c) => c.name === 'revoked_at'),
  ).toBe(true);
  expect(getTableConfig(accountBindings).foreignKeys).toHaveLength(1);
  expect(getTableConfig(people).foreignKeys).toHaveLength(1);
  expect(
    getTableConfig(employments).indexes.some(
      (i) => i.config.name === 'directory_employments_person_idx',
    ),
  ).toBe(true);
});
