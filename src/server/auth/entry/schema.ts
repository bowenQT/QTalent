import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { accountBindings } from '../../modules/directory';
import { session } from '../schema';

// The digest is issuance scope, not another account/person directory. Readers
// derive the current person exclusively from directory_account_bindings.
function bindingColumns() {
  return {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    accountBindingDigest: text('account_binding_digest').notNull(),
    revision: integer('revision').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  };
}
export const mcpCredentials = pgTable(
  'entry_mcp_credentials',
  {
    ...bindingColumns(),
    tokenDigest: text('token_digest').notNull().unique(),
  },
  (t) => [
    check('entry_mcp_revision', sql`${t.revision} > 0`),
    check(
      'entry_mcp_digests',
      sql`${t.tokenDigest} ~ '^[a-f0-9]{64}$' and ${t.accountBindingDigest} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
export const wecomBindings = pgTable(
  'entry_wecom_bindings',
  {
    ...bindingColumns(),
    scope: text('scope').notNull(),
    botId: text('bot_id').notNull(),
    senderId: text('sender_id').notNull(),
  },
  (t) => [
    unique('entry_wecom_sender').on(t.scope, t.botId, t.senderId),
    check('entry_wecom_revision', sql`${t.revision} > 0`),
    check(
      'entry_wecom_digest',
      sql`${t.accountBindingDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'entry_wecom_keys',
      sql`length(${t.scope}) between 1 and 200 and length(${t.botId}) between 1 and 200 and length(${t.senderId}) between 1 and 200 and ${t.scope} !~ '[[:space:][:cntrl:]]' and ${t.botId} !~ '[[:space:][:cntrl:]]' and ${t.senderId} !~ '[[:space:][:cntrl:]]'`,
    ),
  ],
);
export const agentApiBindings = pgTable(
  'entry_agent_api_bindings',
  {
    ...bindingColumns(),
    agentId: text('agent_id').notNull(),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
  },
  (t) => [
    unique('entry_agent_session').on(t.agentId, t.sessionId),
    check('entry_agent_revision', sql`${t.revision} > 0`),
    check(
      'entry_agent_digest',
      sql`${t.accountBindingDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'entry_agent_key',
      sql`length(${t.agentId}) between 1 and 200 and ${t.agentId} !~ '[[:space:][:cntrl:]]'`,
    ),
  ],
);
