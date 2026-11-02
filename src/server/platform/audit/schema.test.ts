import { expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { auditEvents } from './schema';
it('audit records have required attribution and an actor/time lookup index', () => {
  const config = getTableConfig(auditEvents);
  expect(
    config.columns
      .filter((c) => ['id', 'actor_id', 'action', 'at'].includes(c.name))
      .every((c) => c.notNull),
  ).toBe(true);
  expect(
    config.columns
      .filter((c) => !c.notNull)
      .map((c) => c.name)
      .sort(),
  ).toEqual(['metadata', 'resource_id']);
  expect(
    config.indexes.some((i) => i.config.name === 'audit_actor_at_idx'),
  ).toBe(true);
});
