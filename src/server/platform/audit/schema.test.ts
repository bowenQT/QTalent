import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { auditEvents } from './schema';
it('audit records have required attribution and an actor/time lookup index', () => {
  const config = getTableConfig(auditEvents);
  expect(config.columns.every((c) => c.notNull)).toBe(true);
  expect(
    config.indexes.some((i) => i.config.name === 'audit_actor_at_idx'),
  ).toBe(true);
});
