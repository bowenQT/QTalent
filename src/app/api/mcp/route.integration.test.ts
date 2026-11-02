import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
} from '../../../../tests/fixtures/bow-845/native';
import {
  entryAccountBindingDigest,
  mcpTokenDigest,
} from '../../../server/auth/entry/persistent';
import { mcpCredentials } from '../../../server/auth/entry/schema';
import { recordArrangeQueue } from '../../../server/jobs/record-arrange';
import { arrangeInputs } from '../../../server/modules/records';
import { auditEvents } from '../../../server/platform/audit/schema';
import { staffingDemandQueue } from '../../../server/usecases/staffing-demand-runtime';

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  boss: undefined as unknown,
}));
const endpoint = 'https://mcp.example.test/api/mcp';
// Only the process-level wiring is redirected to the test database and its
// pg-boss; the route, MCP transport, credential reader, handlers, native
// intake, queue and audit below are the production modules.
vi.mock('../../../server/db/client', async (original) => ({
  ...(await original<typeof import('../../../server/db/client')>()),
  getDatabase: () => state.db,
}));
vi.mock('../../../server/platform/jobs/app-runtime', () => ({
  getAppJobProducer: async () => state.boss,
}));
vi.mock('../../../server/env', () => ({
  getEnv: () => ({
    APP_ENV: 'test',
    ACCESS_ENFORCED: false,
    MCP_ENDPOINT: endpoint,
    MCP_ALLOWED_ORIGINS: [],
  }),
}));

let c: Awaited<ReturnType<typeof nativeDatabase>>;
let boss: PgBoss;
beforeAll(async () => {
  c = await nativeDatabase();
  await seedNativeRules(c.db);
  boss = new PgBoss({ connectionString: c.testUrl });
  boss.on('error', () => undefined);
  await boss.start();
  await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
  await boss.createQueue(staffingDemandQueue);
  state.db = c.db;
  state.boss = boss;
}, 30000);
afterAll(async () => {
  await boss?.stop();
  await c?.close();
});

it('POST /api/mcp records a moment end to end: native batch, queued arrangement and an MCP entry audit', async () => {
  const facts = await seedNativeCase(c.db);
  const token = 'synthetic-mcp-route-' + randomUUID();
  await c.db.insert(mcpCredentials).values({
    id: facts.prefix + '-route-credential',
    accountId: facts.account,
    accountBindingDigest: entryAccountBindingDigest(
      facts.account,
      facts.evaluator,
      1,
    ),
    tokenDigest: mcpTokenDigest(token),
    revision: 1,
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    revokedAt: null,
  });
  const { POST } = await import('./route');
  const response = await POST(
    new Request(endpoint, {
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
        params: { name: 'record_moment', arguments: facts.input },
      }),
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.result.isError).toBe(false);
  const receipt = body.result.structuredContent;
  expect(receipt).toMatchObject({
    status: 'success',
    payload: {
      evaluationNodeId: facts.node,
      personIds: [facts.target],
      status: 'processing',
    },
  });
  expect(JSON.stringify(body)).not.toContain(token);
  const batchId = receipt.payload.batchId as string;
  const [input] = await c.db
    .select()
    .from(arrangeInputs)
    .where(eq(arrangeInputs.batchId, batchId));
  expect(input).toMatchObject({ creatorAccountId: facts.account });
  const queued = await c.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pgboss.job where name = ${recordArrangeQueue} and data->>'jobId' = ${input!.jobId}`,
  );
  expect(queued.rows[0]!.n).toBe(1);
  const audits = await c.db
    .select({
      resourceId: auditEvents.resourceId,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.actorId, facts.account),
        eq(auditEvents.action, 'entry.tool.record_moment'),
      ),
    );
  expect(audits).toHaveLength(1);
  expect(audits[0]!.metadata).toMatchObject({ channel: 'mcp' });
});

it('POST /api/mcp without a valid personal token changes nothing', async () => {
  const facts = await seedNativeCase(c.db);
  const { POST } = await import('./route');
  const response = await POST(
    new Request(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer synthetic-unknown-' + randomUUID(),
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'record_moment', arguments: facts.input },
      }),
    }),
  );
  expect(response.status).toBe(401);
  expect(
    await c.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.creatorAccountId, facts.account)),
  ).toEqual([]);
});
