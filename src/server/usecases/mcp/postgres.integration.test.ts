import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  businessAt,
  wallAt,
} from '../../../../tests/fixtures/bow-845/native';
import { accountBindings, grants } from '../../modules/directory';
import { projects } from '../../modules/staffing';
import {
  arrangeInputs,
  events,
  eventSources,
  statements,
} from '../../modules/records';
import { recordEntryAudit } from '../entry/audit';
import {
  createMcpEntryAuthenticator,
  entryAccountBindingDigest,
  mcpTokenDigest,
} from '../../auth/entry/persistent';
import { mcpCredentials } from '../../auth/entry/schema';
import { auditEvents } from '../../platform/audit/schema';
import { createEntryIdentityService } from '../../auth/entry/identity';
import type { EntryAudit } from '../entry/context';
import type { Transaction } from '../../db/client';
import { recordArrangeQueue } from '../../jobs/record-arrange';
import { staffingDemandQueue } from '../staffing-demand-runtime';
import {
  createMcpPostgresTools,
  createMcpPostgresHttp,
  type McpPostgresOptions,
} from './postgres';

let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  connection = await nativeDatabase();
  if (process.env.BOW_903_TEST_MIGRATIONS_DIR)
    await migrate(connection.db, {
      migrationsFolder: process.env.BOW_903_TEST_MIGRATIONS_DIR,
    });
  await seedNativeRules(connection.db);
  boss = new PgBoss({ connectionString: connection.testUrl });
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  await boss.createQueue(staffingDemandQueue);
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await connection?.close();
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup() {
  const facts = await seedNativeCase(connection.db);
  // Native fixture adds a current manager grant; it does not infer this role
  // from the token or client input. Existing evaluator relation is retained.
  await connection.db
    .update(grants)
    .set({ role: 'manager', scope: 'company', cohortId: null })
    .where(eq(grants.accountId, facts.account));
  const projectId = facts.prefix + '-project';
  await connection.db.insert(projects).values({
    id: projectId,
    name: '演示项目',
    type: '业务项目',
    status: '筹备中',
    goal: '演示',
    organizationId: facts.prefix,
    cohortId: facts.cohort,
    creatorId: facts.evaluator,
    from: '2026-01-01',
    to: '2026-12-31',
  });
  const control: {
    refreshes: number;
    refresh?: (n: number) => Promise<void>;
    audit?: (tx: Transaction, event: EntryAudit) => Promise<void>;
  } = { refreshes: 0 };
  const proof = 'synthetic-mcp-proof-' + randomUUID();
  const credentialId = facts.prefix + '-credential';
  await connection.db.insert(mcpCredentials).values(
    [proof, proof + '-second'].map((token, index) => ({
      id: credentialId + index,
      accountId: facts.account,
      accountBindingDigest: entryAccountBindingDigest(
        facts.account,
        facts.evaluator,
      ),
      tokenDigest: mcpTokenDigest(token),
      revision: 1,
      expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      revokedAt: null,
    })),
  );
  const reader = createMcpEntryAuthenticator(
    connection.db,
    () => new Date(wallAt),
  );
  // Schedule adversarial changes around the real reader, never substitute facts.
  const identities = createEntryIdentityService(
    {
      mcp: {
        verify: reader.verify,
        current: async (id) => {
          await control.refresh?.(++control.refreshes);
          return reader.current(id);
        },
      },
    },
    () => new Date(wallAt),
  );
  const options: McpPostgresOptions = {
    db: connection.db,
    boss,
    identities,
    businessNow: () => businessAt,
    now: () => new Date(wallAt),
    audit: async (tx, event) => {
      await recordEntryAudit(tx, event);
      await control.audit?.(tx, event);
    },
  };
  const tools = createMcpPostgresTools(options);
  const identity = await tools.authenticate(proof);
  control.refreshes = 0;
  const http = createMcpPostgresHttp({
    ...options,
    endpoint: 'https://mcp.example.test/mcp',
  });
  const send = (name: string, args: unknown, token = proof) =>
    http(
      new Request('https://mcp.example.test/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      }),
    );
  return {
    ...facts,
    control,
    tools,
    identity,
    options,
    send,
    proof,
    credentialId,
    demand: {
      operationId: randomUUID(),
      projectId,
      inputText: '演示：需要工程负责人',
    },
  };
}
async function counts() {
  const result = await connection.db.execute<{
    name: string;
    count: number;
  }>(sql`
    select 'intake' as name, count(*)::int as count from records_arrange_inputs
    union all select 'original', count(*)::int from records_originals
    union all select 'version', count(*)::int from records_original_versions
    union all select 'fragment', count(*)::int from records_fragments
    union all select 'jobs', count(*)::int from job_snapshots
    union all select 'queue', count(*)::int from pgboss.job
    union all select 'audit', count(*)::int from audit_events
    union all select 'demand', count(*)::int from staffing_demands
  `);
  return Object.fromEntries(result.rows.map((r) => [r.name, r.count]));
}
const outcome = (
  result: Awaited<
    ReturnType<ReturnType<typeof createMcpPostgresTools>['call']>
  >,
) => result.structuredContent;

it('runs all three real handlers through the HTTP composition and persists producer queues and native entry audits', async () => {
  const f = await setup();
  const before = await counts();
  for (const [name, args] of [
    ['record_moment', f.input],
    ['draft_requirement', f.demand],
    ['person_brief', { id: f.target }],
  ] as const) {
    const response = await f.send(name, args);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.structuredContent.status).toBe('success');
    expect(body.result.isError).toBe(false);
    expect(JSON.stringify(body)).not.toContain(f.proof);
  }
  const after = await counts();
  expect(after.queue - before.queue).toBe(2);
  expect(after.jobs - before.jobs).toBe(2);
  expect(after.intake - before.intake).toBe(1);
  const audits = await connection.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorId, f.account));
  const entry = audits.filter((row) => row.action.startsWith('entry.tool.'));
  expect(entry).toHaveLength(3);
  expect(entry.map((row) => row.metadata?.channel)).toEqual([
    'mcp',
    'mcp',
    'mcp',
  ]);
});

it.each(['record_moment', 'draft_requirement'] as const)(
  'serializes concurrent %s replays without duplicate jobs and rejects changed inputs',
  async (name) => {
    const f = await setup();
    const args = name === 'record_moment' ? f.input : f.demand;
    const before = await counts();
    const results = await Promise.all([
      f.tools.call(f.identity, name, args),
      f.tools.call(f.identity, name, args),
    ]);
    expect(outcome(results[0])).toMatchObject({ status: 'success' });
    expect(outcome(results[1])).toEqual(outcome(results[0]));
    expect((await counts()).queue - before.queue).toBe(1);
    const changed =
      name === 'record_moment'
        ? { ...f.input, text: f.text + '演示变更' }
        : { ...f.demand, inputText: '演示：不同请求' };
    expect(outcome(await f.tools.call(f.identity, name, changed))).toEqual({
      status: 'conflict',
    });
    expect((await counts()).queue - before.queue).toBe(1);
  },
);

it.each(['record_moment', 'draft_requirement'] as const)(
  'rolls back every %s business/queue/audit row when final auditing fails',
  async (name) => {
    const f = await setup();
    const before = await counts();
    f.control.audit = async () => {
      throw new Error('synthetic-private-audit-error');
    };
    const args = name === 'record_moment' ? f.input : f.demand;
    const result = await f.tools.call(f.identity, name, args);
    expect(outcome(result)).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
    expect(await counts()).toEqual(before);
    f.control.audit = undefined;
    expect(outcome(await f.tools.call(f.identity, name, args))).toMatchObject({
      status: 'success',
    });
  },
);

it('rejects the native text byte limit and an unwritable target node without any effects', async () => {
  const f = await setup();
  const before = await counts();
  expect(
    outcome(
      await f.tools.call(f.identity, 'record_moment', {
        ...f.input,
        text: '演示：' + 'a'.repeat(240000),
      }),
    ),
  ).toEqual({ status: 'validation_error' });
  expect(
    outcome(
      await f.tools.call(f.identity, 'record_moment', {
        ...f.input,
        evaluationNodeId: 'missing-node',
      }),
    ),
  ).toEqual({ status: 'forbidden' });
  expect(await counts()).toEqual(before);
});

it('maps encoded budget overflow only after the whole native transaction rolled back', async () => {
  const f = await setup();
  const before = await counts();
  const result = await f.tools.call(f.identity, 'record_moment', {
    ...f.input,
    text: '演示：' + '"'.repeat(100000),
  });
  expect(outcome(result)).toEqual({ status: 'validation_error' });
  expect(await counts()).toEqual(before);
});

it('rolls back a staged demand when a real grant is revoked before the final context reload', async () => {
  const f = await setup();
  const before = await counts();
  f.control.refresh = async (n) => {
    if (n === 5)
      await connection.db
        .update(grants)
        .set({ revokedAt: businessAt })
        .where(eq(grants.accountId, f.account));
  };
  expect(
    outcome(await f.tools.call(f.identity, 'draft_requirement', f.demand)),
  ).toEqual({ status: 'forbidden' });
  expect(await counts()).toEqual(before);
});

it('rechecks the real demand grant after waiting on its operation lock', async () => {
  const f = await setup();
  const held = gate(),
    release = gate();
  const lock = connection.db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'staffing-demand:' + f.account + ':' + f.demand.operationId},0))`,
    );
    held.resolve();
    await release.promise;
  });
  await held.promise;
  const before = await counts();
  const pending = f.tools.call(f.identity, 'draft_requirement', f.demand);
  try {
    let waiting = false;
    const deadline = Date.now() + 3000;
    while (!waiting && Date.now() < deadline) {
      const row = await connection.db.execute<{ waiting: boolean }>(
        sql`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event='advisory') as waiting`,
      );
      waiting = row.rows[0]!.waiting;
      if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await connection.db
      .update(grants)
      .set({ revokedAt: businessAt })
      .where(eq(grants.accountId, f.account));
  } finally {
    release.resolve();
    await lock;
  }
  expect(outcome(await pending)).toEqual({ status: 'forbidden' });
  expect(await counts()).toEqual(before);
});

it('keeps producer writes rolled back when the real queue is unavailable', async () => {
  const f = await setup();
  await boss.deleteQueue(staffingDemandQueue);
  const before = await counts();
  try {
    expect(
      outcome(await f.tools.call(f.identity, 'draft_requirement', f.demand)),
    ).toEqual({ status: 'unavailable' });
    expect(await counts()).toEqual(before);
  } finally {
    await boss.createQueue(staffingDemandQueue);
  }
  expect(
    outcome(await f.tools.call(f.identity, 'draft_requirement', f.demand)),
  ).toMatchObject({ status: 'success' });
});

it('rejects real directory rebinding and does not revive an observed invalid capability after restore', async () => {
  const f = await setup();
  await connection.db
    .update(accountBindings)
    .set({ personId: f.other })
    .where(eq(accountBindings.accountId, f.account));
  await expect(
    f.tools.call(f.identity, 'person_brief', { id: f.target }),
  ).rejects.toMatchObject({ kind: 'unauthenticated' });
  await connection.db
    .update(accountBindings)
    .set({ personId: f.evaluator })
    .where(eq(accountBindings.accountId, f.account));
  await expect(
    f.tools.call(f.identity, 'person_brief', { id: f.target }),
  ).rejects.toMatchObject({ kind: 'unauthenticated' });
});

it('denies out-of-scope people and rejects client-supplied actor fields before native writes', async () => {
  const f = await setup();
  const before = await counts();
  expect(
    outcome(
      await f.tools.call(f.identity, 'person_brief', { id: 'missing-person' }),
    ),
  ).toEqual({ status: 'forbidden' });
  expect(
    outcome(
      await f.tools.call(f.identity, 'record_moment', {
        ...f.input,
        accountId: f.account,
      }),
    ),
  ).toEqual({ status: 'validation_error' });
  expect(await counts()).toEqual(before);
});

it('applies the account limit across two credentials and releases slots after failure', async () => {
  const f = await setup();
  const twoEntered = gate(),
    release = gate();
  let entered = 0;
  f.control.audit = async () => {
    if (++entered === 2) twoEntered.resolve();
    await release.promise;
    throw new Error('synthetic audit failure');
  };
  const first = f.send('person_brief', { id: f.target });
  const second = f.send('person_brief', { id: f.target }, f.proof + '-second');
  try {
    await twoEntered.promise;
    const busy = await f.send('person_brief', { id: f.target });
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('1');
    expect(await busy.json()).toEqual({ error: 'busy' });
  } finally {
    release.resolve();
    await Promise.all([first, second]);
  }
  f.control.audit = undefined;
  expect(
    (await (await f.send('person_brief', { id: f.target })).json()).result
      .structuredContent.status,
  ).toBe('success');
});

it('fails closed when explicitly composed without an external verifier', async () => {
  const f = await setup();
  const http = createMcpPostgresHttp({
    ...f.options,
    identities: createEntryIdentityService(),
    endpoint: 'https://mcp.example.test/mcp',
  });
  const response = await http(
    new Request('https://mcp.example.test/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-unconfigured' },
    }),
  );
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'unavailable' });
});

it('filters native persisted personnel provenance before returning the actual person projection', async () => {
  const f = await setup();
  expect(
    outcome(await f.tools.call(f.identity, 'record_moment', f.input)),
  ).toMatchObject({ status: 'success' });
  const [intake] = await connection.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.creatorAccountId, f.account));
  const reference = intake.inputSource!;
  // A persisted event fixture references the actual producer-created source.
  // This test is about the reader, not a substitute claim of human confirmation.
  const eventId = randomUUID();
  await connection.db.insert(events).values({
    id: eventId,
    personId: f.target,
    recorderId: f.evaluator,
    projectId: null,
    evaluationNodeId: f.node,
    occurredOn: businessAt.slice(0, 10),
    title: '演示：允许的事件',
    situation: '演示场景',
    behavior: '演示行为',
    impact: '',
    ruleVersionId: 'rubric-v1',
    demo: true,
  });
  await connection.db.insert(eventSources).values({ eventId, ...reference });
  await connection.db.insert(statements).values({
    id: randomUUID(),
    eventId,
    ...reference,
    text: '演示事实',
    kind: 'original_fact',
    authorId: f.evaluator,
  });
  const visible = outcome(
    await f.tools.call(f.identity, 'person_brief', { id: f.target }),
  );
  expect(visible).toMatchObject({
    status: 'success',
    payload: { recentFacts: { status: 'ready', data: [{ eventId }] } },
  });
  f.control.refreshes = 0;
  f.control.refresh = async (n) => {
    if (n !== 5) return;
    await connection.db
      .update(arrangeInputs)
      .set({
        sourceContexts: intake.sourceContexts.map((context) => ({
          ...context,
          requiredKinds: ['performance'],
        })),
      })
      .where(eq(arrangeInputs.id, intake.id));
  };
  expect(
    outcome(await f.tools.call(f.identity, 'person_brief', { id: f.target })),
  ).toEqual({ status: 'forbidden' });
  f.control.refresh = undefined;
  const hidden = outcome(
    await f.tools.call(f.identity, 'person_brief', { id: f.target }),
  );
  expect(hidden).toMatchObject({
    status: 'success',
    payload: { recentFacts: { status: 'empty' } },
  });
  expect(JSON.stringify(hidden)).not.toContain(eventId);
});

it('uses native identity and audit by default and rejects credential revocation on the next HTTP call', async () => {
  const f = await setup();
  const tools = createMcpPostgresTools({
    db: connection.db,
    boss,
    now: () => new Date(wallAt),
    businessNow: () => businessAt,
  });
  const identity = await tools.authenticate(f.proof);
  expect(
    outcome(await tools.call(identity, 'person_brief', { id: f.target })),
  ).toMatchObject({ status: 'success' });
  const rows = await connection.db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.actorId, f.account));
  expect(
    rows.find((row) => row.action === 'entry.tool.person_brief')?.metadata,
  ).toEqual({ channel: 'mcp', revision: null });
  await connection.db
    .update(mcpCredentials)
    .set({ revokedAt: new Date(wallAt) })
    .where(eq(mcpCredentials.id, f.credentialId + '0'));
  await expect(tools.authenticate(f.proof)).rejects.toMatchObject({
    kind: 'unauthenticated',
  });
  await expect(
    tools.call(identity, 'person_brief', { id: f.target }),
  ).rejects.toMatchObject({ kind: 'unauthenticated' });
  expect((await f.send('person_brief', { id: f.target })).status).toBe(401);
});

it('rolls back native producer effects when the persisted credential revision changes during the call', async () => {
  const f = await setup();
  const before = await counts();
  f.control.refresh = async (n) => {
    if (n === 5)
      await connection.db
        .update(mcpCredentials)
        .set({ revision: 2 })
        .where(eq(mcpCredentials.id, f.credentialId + '0'));
  };
  expect(
    outcome(await f.tools.call(f.identity, 'draft_requirement', f.demand)),
  ).toEqual({ status: 'unauthenticated' });
  expect(await counts()).toEqual(before);
});
