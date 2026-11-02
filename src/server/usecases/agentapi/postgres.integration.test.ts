import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Transaction } from '../../db/client';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  businessAt,
  wallAt,
} from '../../../../tests/fixtures/bow-845/native';
import {
  agentApiConversations,
  agentApiTurns,
  agentApiToolEvents,
} from '../../auth/entry/agentapi/schema';
import { agentApiBindings } from '../../auth/entry/schema';
import { user, session } from '../../auth/schema';
import { createEntryIdentityService } from '../../auth/entry/identity';
import {
  createAgentApiEntryAuthenticator,
  entryAccountBindingDigest,
} from '../../auth/entry/persistent';
import { grants, rebindDirectoryAccount } from '../../modules/directory';
import { auditEvents } from '../../platform/audit/schema';
import { loadEntryAuthorizationContext } from '../entry/context';
import { recordEntryAudit } from '../entry/audit';
import { createStaffingDemandRuntime } from '../staffing-demand-runtime';
import { createRecordBatchArrangeRequests } from '../record-batch-arrange-requests';
import { entryToolSuccessSchemas } from '../../../contracts/entry-tools';
import {
  AgentApiError,
  type AgentApiClient,
} from '../../integrations/agentapi/client';
import type { NativeEvent } from '../../integrations/agentapi/protocol';
import {
  createAgentConversationService,
  type ConversationLedger,
  type ToolRow,
} from './service';
import { sessionAuthority } from './session-policy';
import {
  createAgentConversationStore,
  createAgentConversationPostgresPorts,
} from './postgres';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_915_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_915_TEST_MIGRATIONS_DIR,
    });
  await c.db.select().from(agentApiConversations).limit(1);
  await seedNativeRules(c.db);
}, 30000);
afterAll(async () => {
  await c?.close();
});
const at = () => new Date(wallAt);
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup() {
  const facts = await seedNativeCase(c.db),
    id = randomUUID(),
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
    // Issued under the fixture binding's first generation, as Better Auth stamps it.
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
    agentId: 'demo-agent',
    sessionId,
  });
  const identities = createEntryIdentityService(
    {
      agentapi: createAgentApiEntryAuthenticator(
        c.db,
        async () => ({
          accountId: facts.account,
          agentId: 'demo-agent',
          sessionId,
        }),
        at,
      ),
    },
    at,
  );
  const identity = await identities.authenticate('agentapi', {
    synthetic: true,
  });
  const authority = sessionAuthority(
    await identities.current(identity),
    await loadEntryAuthorizationContext(c.db, facts.account, businessAt),
  );
  const conversationId = 'conversation-' + id;
  await c.db.insert(agentApiConversations).values({
    id: conversationId,
    bindingId: id,
    ...authority,
    providerSessionId: 'ses_' + id.replaceAll('-', ''),
    state: 'active',
    cleanup: 'none',
  });
  const store = createAgentConversationStore(c.db);
  const domains = {
    // Real factories. Queue calls are explicitly unavailable in this read-only
    // production slice; no worker, provider or pg-boss connection is started.
    demands: createStaffingDemandRuntime({
      db: c.db,
      boss: async () => {
        throw new Error('queue not configured in this fixture');
      },
      now: () => businessAt,
    }).service,
    records: createRecordBatchArrangeRequests({
      db: c.db,
      now: at,
      businessNow: () => businessAt,
      enqueue: async () => {
        throw new Error('queue not configured in this fixture');
      },
    }),
  };
  const ports = createAgentConversationPostgresPorts({
    db: c.db,
    identities,
    domains,
    now: () => businessAt,
  });
  const events: NativeEvent[] = [
    { id: 'evt-user', type: 'user.message' },
    {
      id: 'evt-tool',
      type: 'agent.custom_tool_use',
      name: 'person_brief',
      input: { id: facts.target },
    },
    {
      id: 'evt-idle',
      type: 'session.status_idle',
      stop_reason: { type: 'requires_action', event_ids: ['evt-tool'] },
    },
  ];
  const provider: Pick<AgentApiClient, 'send' | 'events' | 'archive'> = {
    send: vi.fn(async (_id, event) =>
      event.type === 'user.message' ? 'evt-user' : 'evt-result',
    ),
    events: vi.fn(async () => events),
    archive: vi.fn(async () => undefined),
  };
  const service = createAgentConversationService(ports, provider);
  const mutate = (fn: (ledger: ConversationLedger) => void) =>
    store.transaction(conversationId, async (tx, ledger) => {
      fn(ledger!);
      await store.save(tx, ledger!);
    });
  return {
    ...facts,
    id,
    conversationId,
    sessionId,
    identity,
    identities,
    store,
    ports,
    service,
    provider,
    events,
    mutate,
    submit: () =>
      service.submit(identity, conversationId, 'op-one', '读取演示档案'),
    advance: () => service.advance(identity, conversationId, 'op-one'),
  };
}
function reserved(operationId = 'op-one') {
  return {
    operationId,
    inputDigest: 'b'.repeat(64),
    state: 'reserved' as const,
    userEventId: null,
    answer: null,
    polls: 0,
  };
}
function sampleTool(conversationId: string, name = '演示'): ToolRow {
  const payload = entryToolSuccessSchemas.person_brief.parse({
    role: 'mentor',
    person: {
      id: 'demo-target',
      name,
      demo: true,
      hue: 100,
      photo: null,
      teamId: 'demo-team',
      teamName: '演示',
      teamPath: '演示',
      jobTitle: '演示',
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
  return {
    eventId: 'evt-tool',
    operationId: 'op-one',
    businessOperationId: createHash('sha256')
      .update(JSON.stringify([conversationId, 'evt-tool']))
      .digest('hex'),
    args: { id: 'demo-target' },
    success: { name: 'person_brief', payload },
    state: 'sending',
    resultEventId: null,
  };
}
async function submitted(f: Awaited<ReturnType<typeof setup>>) {
  await f.mutate((l) => {
    l.turns.push(reserved());
  });
  await f.mutate((l) => {
    l.turns[0]!.state = 'submitted';
    l.turns[0]!.userEventId = 'evt-user';
  });
}
it('persists native reservations and serializes concurrent duplicate submissions with one POST', async () => {
  const f = await setup();
  await Promise.all([f.submit(), f.submit()]);
  expect(f.provider.send).toHaveBeenCalledTimes(1);
  const rows = await c.db
    .select()
    .from(agentApiTurns)
    .where(eq(agentApiTurns.conversationId, f.conversationId));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    state: 'submitted',
    userEventId: 'evt-user',
    ordinal: 1,
  });
  await expect(
    f.service.submit(f.identity, f.conversationId, 'op-one', '异内容'),
  ).rejects.toMatchObject({ kind: 'conflict' });
});
it('runs real person source projection, audit and tool receipt atomically; replay executes once', async () => {
  const f = await setup();
  await f.submit();
  await Promise.all([f.advance(), f.advance()]);
  expect(f.provider.send).toHaveBeenCalledTimes(2);
  const tools = await c.db
    .select()
    .from(agentApiToolEvents)
    .where(eq(agentApiToolEvents.conversationId, f.conversationId));
  expect(tools).toHaveLength(1);
  expect(tools[0]).toMatchObject({ name: 'person_brief', state: 'sent' });
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, f.account)),
  ).toHaveLength(1);
  f.events.push(
    {
      id: 'evt-answer',
      type: 'agent.message',
      content: [{ type: 'text', text: '演示建议' }],
    },
    {
      id: 'evt-end',
      type: 'session.status_idle',
      stop_reason: { type: 'end_turn' },
    },
  );
  await expect(f.advance()).resolves.toMatchObject({
    status: 'complete',
    nature: 'ai_suggestion',
  });
  await expect(f.submit()).resolves.toMatchObject({ status: 'complete' });
});
it('unknown provider POST remains durable across fresh native service instances', async () => {
  const f = await setup();
  vi.mocked(f.provider.send).mockRejectedValue(
    new AgentApiError('timeout', true),
  );
  await expect(f.submit()).resolves.toMatchObject({
    status: 'outcome_unknown',
  });
  const fresh = createAgentConversationService(f.ports, f.provider);
  await expect(
    fresh.submit(f.identity, f.conversationId, 'op-one', '读取演示档案'),
  ).rejects.toMatchObject({ kind: 'unavailable' });
  expect(f.provider.send).toHaveBeenCalledTimes(1);
});
it('rolls back real entry audit and ledger writes with an enclosing transaction', async () => {
  const f = await setup();
  await submitted(f);
  await expect(
    c.db.transaction(async (tx) =>
      f.store.inTransaction(tx, f.conversationId, async (locked, ledger) => {
        // The real audit writer is deliberately in the same outer tx as save.
        await recordEntryAudit(locked, {
          actorId: f.account,
          channel: 'agentapi',
          action: 'entry.tool.person_brief',
          resourceId: f.target,
          revision: null,
        });
        ledger!.turns[0]!.polls++;
        await f.store.save(locked, ledger!);
        expect(
          (
            await c.db
              .select()
              .from(agentApiTurns)
              .where(eq(agentApiTurns.conversationId, f.conversationId))
          )[0]!.polls,
        ).toBe(0);
        throw new Error('synthetic rollback');
      }),
    ),
  ).rejects.toThrow('synthetic rollback');
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, f.account)),
  ).toHaveLength(0);
  expect(
    (
      await c.db
        .select()
        .from(agentApiTurns)
        .where(eq(agentApiTurns.conversationId, f.conversationId))
    )[0]!.polls,
  ).toBe(0);
});
it.each(['credential', 'permission'] as const)(
  'lock waiter reloads %s after the lock is released',
  async (kind) => {
    const f = await setup(),
      held = gate(),
      release = gate();
    let blockerPid = 0;
    const blocker = c.db.transaction(async (tx) => {
      blockerPid = Number(
        (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]!.pid,
      );
      await tx
        .select()
        .from(agentApiConversations)
        .where(eq(agentApiConversations.id, f.conversationId))
        .for('update');
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const attempted = f.submit();
    // Attach rejection handler before releasing to avoid an unhandled promise.
    const rejected = expect(attempted).rejects.toThrow();
    try {
      await vi.waitFor(
        async () => {
          const rows = await c.db.execute(
            sql`select count(*) as n from pg_stat_activity where ${blockerPid} = any(pg_blocking_pids(pid))`,
          );
          expect(Number(rows.rows[0]!.n)).toBeGreaterThan(0);
        },
        { timeout: 2000, interval: 10 },
      );
    } catch (error) {
      release.resolve();
      await blocker;
      await attempted.catch(() => undefined);
      throw error;
    }
    if (kind === 'credential')
      await c.db
        .update(agentApiBindings)
        .set({ revision: 2 })
        .where(eq(agentApiBindings.id, f.id));
    else await c.db.delete(grants).where(eq(grants.accountId, f.account));
    release.resolve();
    await blocker;
    await rejected;
    expect(f.provider.send).not.toHaveBeenCalled();
  },
);
it('native owner, current directory reassignment and auth-session deletion cannot reuse a capability', async () => {
  const f = await setup(),
    other = await setup();
  await expect(
    f.service.submit(other.identity, f.conversationId, 'op-one', '读取'),
  ).rejects.toThrow();
  await rebindDirectoryAccount(c.db, {
    accountId: f.account,
    personId: f.other,
  });
  await expect(f.submit()).rejects.toThrow();
  const g = await setup();
  await c.db.delete(session).where(eq(session.id, g.sessionId));
  await expect(g.submit()).rejects.toThrow();
  const [row] = await c.db
    .select()
    .from(agentApiConversations)
    .where(eq(agentApiConversations.id, g.conversationId));
  expect(row!.bindingId).toBeNull();
  expect(g.provider.send).not.toHaveBeenCalled();
});
it('source/derived fact changes invalidate an old real person result before another provider request', async () => {
  const f = await setup();
  await f.submit();
  await f.advance();
  // A real directory fact change alters the authorized brief even without a role change.
  const { people } = await import('../../modules/directory');
  await c.db
    .update(people)
    .set({ name: '演示更名' })
    .where(eq(people.id, f.target));
  await expect(f.advance()).rejects.toMatchObject({
    kind: 'permission_changed',
  });
  expect(f.provider.events).toHaveBeenCalledTimes(1);
});
it('refuses absent material/demand historical readers instead of executing new domain writes', async () => {
  for (const name of ['submit_material_batch', 'draft_requirement'] as const) {
    const f = await setup();
    await f.submit();
    const args =
      name === 'submit_material_batch'
        ? f.input
        : { operationId: 'demo', projectId: 'demo', inputText: '演示需求' };
    f.events[1] = {
      id: 'evt-tool',
      type: 'agent.custom_tool_use',
      name,
      input: args,
    };
    await expect(f.advance()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(
      await c.db
        .select()
        .from(agentApiToolEvents)
        .where(eq(agentApiToolEvents.conversationId, f.conversationId)),
    ).toHaveLength(0);
    expect(
      await c.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, f.account)),
    ).toHaveLength(0);
  }
});
it.each([
  'authority',
  'provider',
  'input',
  'turn-delete',
  'tool-args',
  'tool-result',
  'tool-operation',
  'tool-delete',
  'state-rewind',
] as const)('native writer rejects immutable mutation: %s', async (kind) => {
  const f = await setup();
  await submitted(f);
  await f.mutate((l) => {
    l.tools.push(sampleTool(f.conversationId));
  });
  if (kind === 'state-rewind')
    await f.mutate((l) => {
      l.tools[0]!.state = 'sent';
      l.tools[0]!.resultEventId = 'evt-result';
    });
  await expect(
    f.mutate((l) => {
      if (kind === 'authority') l.conversation.authority.credentialRevision++;
      if (kind === 'provider') l.conversation.providerSessionId = 'ses_other';
      if (kind === 'input') l.turns[0]!.inputDigest = 'c'.repeat(64);
      if (kind === 'turn-delete') l.turns = [];
      if (kind === 'tool-args') l.tools[0]!.args = { id: 'other' };
      if (kind === 'tool-result') {
        const t = l.tools[0]!;
        if (t.success.name === 'person_brief')
          t.success.payload.person.name = 'changed';
      }
      if (kind === 'tool-operation') l.tools[0]!.operationId = 'other';
      if (kind === 'tool-delete') l.tools = [];
      if (kind === 'state-rewind') {
        l.tools[0]!.state = 'sending';
        l.tools[0]!.resultEventId = null;
      }
    }),
  ).rejects.toThrow();
  expect(
    await c.db
      .select()
      .from(agentApiToolEvents)
      .where(eq(agentApiToolEvents.conversationId, f.conversationId)),
  ).toHaveLength(1);
});
it('native writer accepts exactly 64KiB compact wire, rejects one more byte and strict DTO violations', async () => {
  const f = await setup();
  await submitted(f);
  const base = sampleTool(f.conversationId, 'x');
  const size = Buffer.byteLength(
    JSON.stringify({ status: 'success', payload: base.success.payload }),
  );
  const tool = sampleTool(f.conversationId, 'x'.repeat(65537 - size));
  expect(
    Buffer.byteLength(
      JSON.stringify({ status: 'success', payload: tool.success.payload }),
    ),
  ).toBe(65536);
  await f.mutate((l) => {
    l.tools.push(tool);
  });
  const result = await c.db.execute(
    sql`select octet_length(success_payload::text) as bytes from agentapi_tool_events where conversation_id=${f.conversationId}`,
  );
  expect(Number(result.rows[0]!.bytes)).toBeGreaterThan(65000);
  const g = await setup();
  await submitted(g);
  await expect(
    g.mutate((l) => {
      l.tools.push(sampleTool(g.conversationId, 'x'.repeat(65538 - size)));
    }),
  ).rejects.toThrow();
  await expect(
    g.mutate((l) => {
      const t = sampleTool(g.conversationId);
      t.success.payload = {
        arbitrary: true,
      } as unknown as typeof t.success.payload;
      l.tools.push(t);
    }),
  ).rejects.toThrow();
});
it('creates no fake bound session and rejects corruption at the persisted read boundary', async () => {
  const f = await setup();
  await c.db
    .update(agentApiConversations)
    .set({ state: 'creating', providerSessionId: null })
    .where(eq(agentApiConversations.id, f.conversationId));
  await expect(f.submit()).rejects.toThrow();
  expect(f.provider.send).not.toHaveBeenCalled();
  const g = await setup();
  await submitted(g);
  await c.db
    .update(agentApiTurns)
    .set({ state: 'complete', answer: null })
    .where(eq(agentApiTurns.conversationId, g.conversationId));
  await expect(g.submit()).rejects.toThrow();
});
it('save cannot use a different transaction or delete history; unknown cleanup is not retried', async () => {
  const f = await setup();
  await f.store.transaction(f.conversationId, async (_tx, ledger) => {
    await expect(
      c.db.transaction((tx) => f.store.save(tx, ledger!)),
    ).rejects.toThrow();
  });
  vi.mocked(f.provider.archive).mockRejectedValue(
    new AgentApiError('timeout', true),
  );
  await expect(
    f.service.cancel(f.identity, f.conversationId),
  ).resolves.toMatchObject({ status: 'cancelled', cleanup: 'unknown' });
  await f.service.cancel(f.identity, f.conversationId);
  expect(f.provider.archive).toHaveBeenCalledTimes(1);
});
async function lockWaiters() {
  const { rows } = await c.db.execute<{ waiting: number }>(
    sql`select count(*)::int as waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return rows[0]!.waiting;
}
it('a logout racing a locked conversation waits behind it instead of deadlocking the same-transaction 903 re-read', async () => {
  const f = await setup();
  const locked = gate(),
    release = gate();
  // A: conversation transaction that re-reads 903 after the logout is queued.
  const conversation = f.ports.transaction(f.conversationId, async (tx) => {
    locked.resolve();
    await release.promise;
    return f.ports.current(tx, f.identity);
  });
  await locked.promise;
  // B: real logout. The session delete cascades to the AgentAPI binding and
  // nulls this conversation's binding, so it must queue behind A's locks.
  // Drizzle builders are lazy; start the statement now on its own connection.
  const logout = (async () =>
    c.db.delete(session).where(eq(session.id, f.sessionId)))();
  await expect.poll(lockWaiters, { timeout: 5000 }).toBeGreaterThan(0);
  release.resolve();
  const [current, out] = await Promise.allSettled([conversation, logout]);
  // Neither side is chosen as a deadlock victim: A finished before logout
  // committed, and logout then completes with its cascade.
  expect(current).toMatchObject({ status: 'fulfilled' });
  expect(out).toMatchObject({ status: 'fulfilled' });
  const [row] = await c.db
    .select()
    .from(agentApiConversations)
    .where(eq(agentApiConversations.id, f.conversationId));
  expect(row!.bindingId).toBeNull();
  await expect(
    f.ports.transaction(f.conversationId, (tx) =>
      f.ports.current(tx, f.identity),
    ),
  ).rejects.toThrow();
}, 15000);
// Behavioural only: the conversation row lock alone would also serialize this
// order, so this case does not prove the pre-lock; the next one does.
it('a conversation started after an uncommitted logout waits for it and then fails closed', async () => {
  const f = await setup();
  const deleted = gate(),
    commit = gate();
  const logout = c.db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.id, f.sessionId));
    deleted.resolve();
    await commit.promise;
  });
  await deleted.promise;
  const conversation = f.ports.transaction(f.conversationId, (tx) =>
    f.ports.current(tx, f.identity),
  );
  await expect.poll(lockWaiters, { timeout: 5000 }).toBeGreaterThan(0);
  commit.resolve();
  await logout;
  await expect(conversation).rejects.toThrow();
  expect(f.provider.send).not.toHaveBeenCalled();
}, 15000);

async function backendPid(tx: Transaction) {
  const { rows } = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid`,
  );
  return rows[0]!.pid;
}
async function blockers(pid: number) {
  const { rows } = await c.db.execute<{ pids: number[] }>(
    sql`select pg_blocking_pids(${pid}::integer) as pids`,
  );
  return rows[0]!.pids;
}
it('a conversation queued on its row lock already holds the credential chain, so logout waits on it rather than on the row holder', async () => {
  const f = await setup();
  const held = gate(),
    release = gate();
  let holder = 0;
  // A third party holds the conversation row, so the turn below is parked
  // between its credential pre-lock and the conversation lock.
  const blocker = c.db.transaction(async (tx) => {
    holder = await backendPid(tx);
    await tx
      .select({ id: agentApiConversations.id })
      .from(agentApiConversations)
      .where(eq(agentApiConversations.id, f.conversationId))
      .for('update');
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const conversation = f.ports.transaction(f.conversationId, (tx) =>
    f.ports.current(tx, f.identity),
  );
  await expect
    .poll(
      async () => {
        const { rows } = await c.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity where ${holder}::integer = any(pg_blocking_pids(pid))`,
        );
        return rows[0]!.n;
      },
      { timeout: 5000 },
    )
    .toBe(1);
  const started = gate();
  let logoutPid = 0;
  const logout = c.db.transaction(async (tx) => {
    logoutPid = await backendPid(tx);
    started.resolve();
    await tx.delete(session).where(eq(session.id, f.sessionId));
  });
  await started.promise;
  await expect
    .poll(() => blockers(logoutPid), { timeout: 5000 })
    .not.toHaveLength(0);
  // Without the pre-lock the logout would delete the session and wait only on
  // the row holder (its cascade nulls the binding), then deadlock with the turn.
  expect(await blockers(logoutPid)).not.toContain(holder);
  release.resolve();
  await blocker;
  const [current, out] = await Promise.allSettled([conversation, logout]);
  expect(current).toMatchObject({ status: 'fulfilled' });
  expect(out).toMatchObject({ status: 'fulfilled' });
  const [row] = await c.db
    .select({ bindingId: agentApiConversations.bindingId })
    .from(agentApiConversations)
    .where(eq(agentApiConversations.id, f.conversationId));
  expect(row!.bindingId).toBeNull();
}, 15000);
it('two conversations on the same Web session re-read 903 concurrently without serializing or deadlocking', async () => {
  const f = await setup();
  const [first] = await c.db
    .select()
    .from(agentApiConversations)
    .where(eq(agentApiConversations.id, f.conversationId));
  const secondId = f.conversationId + '-second';
  await c.db.insert(agentApiConversations).values({
    ...first!,
    id: secondId,
    providerSessionId: first!.providerSessionId + '_second',
  });
  let arrived = 0;
  const both = gate();
  // Each turn has taken its pre-lock and conversation lock before either
  // re-reads; exclusive credential locks here would deadlock one of them.
  const turn = (id: string) =>
    f.ports.transaction(id, async (tx) => {
      if (++arrived === 2) both.resolve();
      await both.promise;
      return f.ports.current(tx, f.identity);
    });
  const results = await Promise.allSettled([
    turn(f.conversationId),
    turn(secondId),
  ]);
  expect(results).toMatchObject([
    { status: 'fulfilled' },
    { status: 'fulfilled' },
  ]);
}, 15000);
