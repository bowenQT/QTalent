import { sql } from 'drizzle-orm';
import type { EntryAuditMetadata } from './metadata';
import {
  pgTable,
  text,
  timestamp,
  index,
  jsonb,
  check,
} from 'drizzle-orm/pg-core';
export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').$type<EntryAuditMetadata>(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_actor_at_idx').on(t.actorId, t.at),
    check(
      'audit_entry_metadata',
      sql`${t.metadata} is null or (
      jsonb_typeof(${t.metadata}) = 'object'
      and (${t.metadata} - 'channel' - 'revision') = '{}'::jsonb
      and coalesce((${t.metadata}->'channel') in ('"web"'::jsonb,'"wecom"'::jsonb,'"mcp"'::jsonb,'"agentapi"'::jsonb), false)
      and coalesce((${t.metadata}->'revision') = 'null'::jsonb or
        (jsonb_typeof(${t.metadata}->'revision') = 'number' and (${t.metadata}->>'revision') ~ '^[1-9][0-9]*$' and (${t.metadata}->>'revision')::numeric <= 9007199254740991), false)
      and octet_length(${t.metadata}::text) <= 256
    )`,
    ),
  ],
);
