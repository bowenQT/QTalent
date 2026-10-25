import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { account, session, user, verification } from './schema';
it('enforces unique auth identity and token columns with session lookup indexes', () => {
  expect(
    getTableConfig(user).columns.find((c) => c.name === 'email')?.isUnique,
  ).toBe(true);
  expect(
    getTableConfig(session).columns.find((c) => c.name === 'token')?.isUnique,
  ).toBe(true);
  expect(
    getTableConfig(session).indexes.some(
      (i) => i.config.name === 'auth_session_user_idx',
    ),
  ).toBe(true);
  expect(
    getTableConfig(account).indexes.some(
      (i) => i.config.name === 'auth_account_user_idx',
    ),
  ).toBe(true);
  expect(
    getTableConfig(verification).indexes.some(
      (i) => i.config.name === 'auth_verification_identifier_idx',
    ),
  ).toBe(true);
});
