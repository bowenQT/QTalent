import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  businessAt,
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { agentApiConversations } from '../auth/entry/agentapi/schema';
import { agentApiBindings } from '../auth/entry/schema';
import { session, user } from '../auth/schema';
import { createEntryIdentityService } from '../auth/entry/identity';
import {
  createAgentApiEntryAuthenticator,
  entryAccountBindingDigest,
} from '../auth/entry/persistent';
import { grants } from '../modules/directory';
import { loadEntryAuthorizationContext } from './entry/context';
import { sessionAuthority } from './agentapi/session-policy';
import { createRecordBatchArrangeRequests } from './record-batch-arrange-requests';
import { createStaffingDemandRuntime } from './staffing-demand-runtime';
import { composeAgentConversation } from './agentapi-runtime';

vi.mock('server-only', () => ({}));
let c: Awaited<ReturnType<typeof nativeDatabase>>;
let small: Pool;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_915_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_915_TEST_MIGRATIONS_DIR,
    });
  await seedNativeRules(c.db);
  // Two connections and a short borrow timeout: a transaction that borrows a
  // second pool connection would surface as a timeout, not a slow pass.
  small = new Pool({
    connectionString: c.testUrl,
    max: 2,
    connectionTimeoutMillis: 1500,
  });
}, 30000);
afterAll(async () => {
  await small?.end();
  await c?.close();
});
const at = () => new Date(wallAt);

it('concurrent AgentAPI turns on a two-connection pool finish without waiting on a second connection', async () => {
  const db = drizzle(small);
  const facts = await seedNativeCase(c.db);
  const id = randomUUID(),
    sessionId = 'session-' + id;
  await c.db
    .update(grants)
    .set({ role: 'manager', scope: 'company', cohortId: null })
    .where(eq(grants.accountId, facts.account));
  await c.db.insert(user).values({
    id: facts.account,
    name: '演示',
    email: id + '@example.invalid',
  });
  await c.db.insert(session).values({
    id: sessionId,
    userId: facts.account,
    token: 'synthetic-' + id,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    bindingGeneration: 1,
  });
  await c.db.insert(agentApiBindings).values({
    id,
    accountId: facts.account,
    accountBindingDigest: entryAccountBindingDigest(
      facts.account,
      facts.evaluator,
      1,
    ),
    revision: 1,
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    agentId: 'agt_demo',
    sessionId,
  });
  // Stands in for the Web entry check: it reads the pool like Better Auth and
  // the directory join do, so calling it inside a transaction would need a
  // second connection.
  const webReads = vi.fn(async () => {
    await small.query('select 1');
    return {
      credentialId: sessionId,
      accountId: facts.account,
      personId: facts.evaluator,
      revision: 1,
      expiresAt: '2026-12-01T00:00:00.000Z',
      revokedAt: null,
    };
  });
  const web = createEntryIdentityService(
    { web: { verify: webReads, current: webReads } },
    at,
  );
  const provider = {
    send: vi.fn(async () => 'evt-user'),
    events: vi.fn(async () => []),
    archive: vi.fn(async () => undefined),
  };
  const ids = Array.from({ length: 4 }, (_, i) => `conversation-${id}-${i}`);
  const issuer = createEntryIdentityService(
    {
      agentapi: createAgentApiEntryAuthenticator(
        c.db,
        async () => ({
          accountId: facts.account,
          sessionId,
          agentId: 'agt_demo',
        }),
        at,
      ),
    },
    at,
  );
  const authority = sessionAuthority(
    await issuer.current(await issuer.authenticate('agentapi', true)),
    await loadEntryAuthorizationContext(c.db, facts.account, businessAt),
  );
  for (const [i, conversationId] of ids.entries())
    await c.db.insert(agentApiConversations).values({
      id: conversationId,
      bindingId: id,
      ...authority,
      providerSessionId: 'ses_' + id.replaceAll('-', '') + i,
      state: 'active',
      cleanup: 'none',
    });
  const turn = async (conversationId: string) => {
    const owner = await web.authenticate('web', true);
    const { identity, service } = await composeAgentConversation({
      db,
      web,
      owner,
      agentId: 'agt_demo',
      provider,
      businessNow: () => businessAt,
      wallNow: at,
      domains: {
        demands: createStaffingDemandRuntime({
          db,
          boss: async () => {
            throw new Error('queue not configured in this fixture');
          },
          now: () => businessAt,
        }).service,
        records: createRecordBatchArrangeRequests({
          db,
          now: at,
          businessNow: () => businessAt,
          enqueue: async () => {
            throw new Error('queue not configured in this fixture');
          },
        }),
      },
    });
    return service.submit(identity, conversationId, 'op-one', '演示输入');
  };
  const results = await Promise.allSettled(ids.map(turn));
  expect(results).toEqual(
    ids.map(() => ({ status: 'fulfilled', value: { status: 'waiting' } })),
  );
  expect(provider.send).toHaveBeenCalledTimes(4);
  const { rows } = await c.db.execute<{ n: number }>(
    sql`select count(*)::int as n from agentapi_turns where conversation_id like ${'conversation-' + id + '-%'}`,
  );
  expect(rows[0]!.n).toBe(4);
}, 30000);
