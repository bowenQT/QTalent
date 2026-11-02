import { randomUUID, createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../../tests/fixtures/bow-845/native';
import {
  accountBindings,
  organizations,
  people,
} from '../../../modules/directory';
import { user, session } from '../../schema';
import { agentApiBindings } from '../schema';
import { entryAccountBindingDigest } from '../persistent';
import {
  entryToolInputSchemas,
  entryToolSuccessSchemas,
} from '../../../../contracts/entry-tools';
import {
  agentApiConversations,
  agentApiTurns,
  agentApiToolEvents,
} from './schema';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
const at = new Date('2026-11-01T12:00:00Z');
const expiresAt = new Date('2026-11-01T13:00:00Z');
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_915_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_915_TEST_MIGRATIONS_DIR,
    });
  await c.db.select().from(agentApiConversations).limit(1);
}, 30000);
afterAll(async () => {
  await c?.close();
});

// Real schema/transactions, synthetic identities only. This fixture is not an
// authentication or authorization implementation for the native store.
async function setup() {
  const id = randomUUID(),
    accountId = 'demo-account-' + id,
    personId = 'demo-person-' + id;
  await c.db
    .insert(organizations)
    .values({ id, name: '演示组织', shortName: '演示' });
  await c.db
    .insert(people)
    .values({ id: personId, name: '演示化名', organizationId: id });
  await c.db
    .insert(accountBindings)
    .values({ accountId, personId, isSystemAdmin: false });
  await c.db
    .insert(user)
    .values({ id: accountId, name: '演示', email: id + '@example.invalid' });
  const sessionId = 'demo-session-' + id;
  await c.db.insert(session).values({
    id: sessionId,
    userId: accountId,
    token: 'synthetic-session-' + id,
    expiresAt,
  });
  await c.db.insert(agentApiBindings).values({
    id,
    accountId,
    accountBindingDigest: entryAccountBindingDigest(accountId, personId, 1),
    revision: 1,
    expiresAt,
    agentId: 'demo-agent',
    sessionId,
  });
  const conversation = {
    id: 'conversation-' + id,
    bindingId: id,
    accountId,
    personId,
    credentialId: id,
    credentialRevision: 1,
    authorizationDigest: 'a'.repeat(64),
    providerSessionId: 'demo-provider-' + id,
    state: 'active' as const,
    cleanup: 'none' as const,
    createdAt: at,
    updatedAt: at,
  };
  await c.db.insert(agentApiConversations).values(conversation);
  return { id, accountId, personId, sessionId, conversation };
}
function turn(conversationId: string, ordinal = 1) {
  return {
    conversationId,
    operationId: randomUUID(),
    ordinal,
    inputDigest: 'b'.repeat(64),
    state: 'reserved' as const,
    createdAt: at,
    updatedAt: at,
  };
}
const payload = () =>
  entryToolSuccessSchemas.person_brief.parse({
    role: 'mentor',
    person: {
      id: 'demo-subject',
      name: '演示甲',
      demo: true,
      hue: 100,
      photo: null,
      teamId: 'demo-team',
      teamName: '演示团队',
      teamPath: '演示',
      jobTitle: '工程师',
      level: null,
      batch: null,
      tenureLabel: null,
    },
    projectLoad: { current: 0, ever: 0 },
    recentFacts: { status: 'empty' },
    capabilityLines: {
      status: 'insufficient_evidence',
      reason: '演示材料不足',
    },
  });
function tool(t: ReturnType<typeof turn>) {
  const eventId = randomUUID();
  return {
    conversationId: t.conversationId,
    operationId: t.operationId,
    eventId,
    businessOperationId: createHash('sha256')
      .update(t.conversationId + eventId)
      .digest('hex'),
    name: 'person_brief' as const,
    args: entryToolInputSchemas.person_brief.parse({ id: 'demo-subject' }),
    successPayload: payload(),
    state: 'sending' as const,
    createdAt: at,
    updatedAt: at,
  };
}

it('keeps the three ledger writes in the caller transaction and rolls them back together', async () => {
  const f = await setup(),
    t = turn(f.conversation.id),
    receipt = tool(t);
  const failure = new Error('synthetic outer rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await tx
        .update(agentApiConversations)
        .set({ cleanup: 'reserved' })
        .where(eq(agentApiConversations.id, f.conversation.id));
      await tx.insert(agentApiTurns).values(t);
      await tx.insert(agentApiToolEvents).values(receipt);
      expect(
        await tx
          .select()
          .from(agentApiToolEvents)
          .where(eq(agentApiToolEvents.eventId, receipt.eventId)),
      ).toHaveLength(1);
      expect(
        await c.db
          .select()
          .from(agentApiToolEvents)
          .where(eq(agentApiToolEvents.eventId, receipt.eventId)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(
    await c.db
      .select()
      .from(agentApiTurns)
      .where(eq(agentApiTurns.conversationId, f.conversation.id)),
  ).toEqual([]);
  expect(
    await c.db
      .select()
      .from(agentApiConversations)
      .where(eq(agentApiConversations.id, f.conversation.id)),
  ).toEqual([f.conversation]);
});

it('serializes competing incomplete turns through the real database unique index', async () => {
  const f = await setup();
  const attempts = await Promise.allSettled([
    c.db.insert(agentApiTurns).values(turn(f.conversation.id, 1)),
    c.db.insert(agentApiTurns).values(turn(f.conversation.id, 2)),
  ]);
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = attempts.find((r) => r.status === 'rejected');
  expect(rejected).toMatchObject({
    status: 'rejected',
    reason: {
      cause: { code: '23505', constraint: 'agentapi_turn_incomplete' },
    },
  });
  expect(
    await c.db
      .select()
      .from(agentApiTurns)
      .where(eq(agentApiTurns.conversationId, f.conversation.id)),
  ).toHaveLength(1);
});

it.each(['reserved', 'submitted', 'outcome_unknown', 'failed'] as const)(
  'does not free an incomplete %s turn for blind retransmission',
  async (state) => {
    const f = await setup();
    await c.db
      .insert(agentApiTurns)
      .values({ ...turn(f.conversation.id), state });
    await expect(
      c.db.insert(agentApiTurns).values(turn(f.conversation.id, 2)),
    ).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'agentapi_turn_incomplete' },
    });
  },
);

it('allows the next turn only after completion, retaining immutable ordinal and provider event uniqueness', async () => {
  const f = await setup(),
    t = turn(f.conversation.id);
  await c.db.insert(agentApiTurns).values({
    ...t,
    state: 'complete',
    answer: '演示建议',
    userEventId: 'user-event',
  });
  await c.db.insert(agentApiTurns).values(turn(f.conversation.id, 2));
  await expect(
    c.db
      .insert(agentApiTurns)
      .values({ ...turn(f.conversation.id, 1), state: 'complete' }),
  ).rejects.toMatchObject({
    cause: { code: '23505', constraint: 'agentapi_turn_ordinal' },
  });
  await expect(
    c.db.insert(agentApiTurns).values({
      ...turn(f.conversation.id, 3),
      state: 'complete',
      userEventId: 'user-event',
    }),
  ).rejects.toMatchObject({
    cause: { code: '23505', constraint: 'agentapi_turn_user_event' },
  });
});

it('permits real auth-session deletion while preserving issuance and outcome-unknown history', async () => {
  const f = await setup(),
    t = turn(f.conversation.id);
  await c.db.insert(agentApiTurns).values({ ...t, state: 'outcome_unknown' });
  await c.db
    .insert(agentApiToolEvents)
    .values({ ...tool(t), state: 'outcome_unknown' });
  await c.db.delete(session).where(eq(session.id, f.sessionId));
  expect(
    await c.db
      .select()
      .from(agentApiBindings)
      .where(eq(agentApiBindings.id, f.id)),
  ).toEqual([]);
  expect(
    await c.db
      .select()
      .from(agentApiConversations)
      .where(eq(agentApiConversations.id, f.conversation.id)),
  ).toEqual([{ ...f.conversation, bindingId: null }]);
  expect(
    await c.db
      .select()
      .from(agentApiToolEvents)
      .where(eq(agentApiToolEvents.conversationId, f.conversation.id)),
  ).toMatchObject([{ state: 'outcome_unknown' }]);
});

it('rejects a tool receipt attached to another conversation turn and duplicate business operation IDs', async () => {
  const a = await setup(),
    b = await setup(),
    ta = turn(a.conversation.id),
    tb = turn(b.conversation.id);
  await c.db.insert(agentApiTurns).values([ta, tb]);
  const row = tool(ta);
  await expect(
    c.db
      .insert(agentApiToolEvents)
      .values({ ...row, conversationId: b.conversation.id }),
  ).rejects.toMatchObject({
    cause: { code: '23503', constraint: 'agentapi_tool_turn' },
  });
  await c.db.insert(agentApiToolEvents).values(row);
  await expect(
    c.db
      .insert(agentApiToolEvents)
      .values({ ...tool(tb), businessOperationId: row.businessOperationId }),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
});

it.each([
  null,
  {},
  { role: 'mentor' },
  {
    role: 'mentor',
    person: { id: 'another-person' },
    projectLoad: {},
    recentFacts: {},
    capabilityLines: {},
  },
])(
  'SQL NULL or incomplete/mismatched JSON cannot pass the necessary identity checks: %j',
  async (invalid) => {
    const f = await setup(),
      t = turn(f.conversation.id);
    await c.db.insert(agentApiTurns).values(t);
    const row = tool(t);
    await expect(
      c.db.execute(
        sql`insert into ${agentApiToolEvents} (conversation_id,event_id,operation_id,business_operation_id,name,args,success_payload,state) values (${row.conversationId},${row.eventId},${row.operationId},${row.businessOperationId},${row.name},${JSON.stringify(row.args)}::jsonb,${JSON.stringify(invalid)}::jsonb,'sending')`,
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'agentapi_tool_shape' },
    });
  },
);

it('stores a valid exactly-64KiB compact result even when JSONB text is larger', async () => {
  const f = await setup(),
    t = turn(f.conversation.id);
  await c.db.insert(agentApiTurns).values(t);
  const result = payload();
  result.person.name = 'x';
  const length = Buffer.byteLength(
    JSON.stringify({ status: 'success', payload: result }),
  );
  result.person.name += 'x'.repeat(65536 - length);
  const parsed = entryToolSuccessSchemas.person_brief.parse(result);
  expect(
    Buffer.byteLength(JSON.stringify({ status: 'success', payload: parsed })),
  ).toBe(65536);
  const row = { ...tool(t), successPayload: parsed };
  await c.db.insert(agentApiToolEvents).values(row);
  const size = await c.db.execute<{ bytes: number }>(
    sql`select octet_length(success_payload::text) as bytes from ${agentApiToolEvents} where event_id=${row.eventId}`,
  );
  expect(size.rows[0].bytes).toBeGreaterThan(65536);
  expect(
    (
      await c.db
        .select()
        .from(agentApiToolEvents)
        .where(eq(agentApiToolEvents.eventId, row.eventId))
    )[0].successPayload,
  ).toEqual(parsed);
  // The writer/service must check the original compact wire, never the PG
  // representation. This is a structure test, not a native-writer substitute.
  parsed.person.name += 'x';
  expect(
    Buffer.byteLength(JSON.stringify({ status: 'success', payload: parsed })),
  ).toBe(65537);
});

it.each([
  { polls: 121 },
  { polls: -1 },
  { state: 'reserved' as const, answer: 'must not be disclosed' },
  { state: 'complete' as const, answer: 'x'.repeat(65537) },
])('rejects invalid turn state facts %#', async (change) => {
  const f = await setup();
  await expect(
    c.db
      .insert(agentApiTurns)
      .values({ ...turn(f.conversation.id), ...change }),
  ).rejects.toMatchObject({ cause: { code: '23514' } });
});

it('keeps historical auth rows unchanged when generated structures are applied after formal migrations', async () => {
  const legacy = await nativeDatabase();
  try {
    await legacy.db.insert(user).values({
      id: 'demo-legacy-agent-user',
      name: '演示旧用户',
      email: 'legacy-agent@example.invalid',
    });
    const before = await legacy.db.select().from(user);
    if (process.env.BOW_915_TEST_MIGRATIONS_DIR)
      await migrate(legacy.db, {
        migrationsFolder: process.env.BOW_915_TEST_MIGRATIONS_DIR,
      });
    expect(await legacy.db.select().from(user)).toEqual(before);
    expect(await legacy.db.select().from(agentApiConversations)).toEqual([]);
  } finally {
    await legacy.close();
  }
});
