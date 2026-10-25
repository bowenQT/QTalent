import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceId: text('resource_id').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_actor_at_idx').on(t.actorId, t.at)],
);
