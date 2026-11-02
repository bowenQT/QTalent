import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  nativeDatabase,
  seedNativeCase,
  seedNativeRules,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../../tests/fixtures/bow-845/native';
import { buildEntryDeepLink } from '../../../contracts/entry-links';
import { user, session } from '../../auth/schema';
import { accountBindings, grants } from '../../modules/directory';
import { evaluationRelations } from '../../modules/programs';
import { projects } from '../../modules/staffing/schema';
import { demandRoots } from '../../modules/staffing/demand/schema';
import { auditEvents } from '../../platform/audit/schema';
import type { Database } from '../../db/client';
import { createRecordBatchArrangeRequests } from '../record-batch-arrange-requests';
import { createRecordArrangeApplication } from '../record-arrange-application';
import { recordArrangeQueue } from '../../jobs/record-arrange';
import { recordDraftBatches } from '../../modules/records/save-state/schema';
import { openEntryLinkRequest } from './open-link';

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
// Only the existing authentication interfaces are controlled; every adapter,
// reader, permission and audit statement below is real code on real PG.
vi.mock('../../access', () => ({ verifyAccessRequest: vi.fn() }));
vi.mock('../../env', () => ({ getEnv: () => ({ ACCESS_ENFORCED: false }) }));
vi.mock('../../auth/index', () => ({ getSession: mocks.session }));

let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_915_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_915_TEST_MIGRATIONS_DIR,
    });
  await seedNativeRules(c.db);
}, 30000);
let boss: PgBoss | undefined;
let started = false;
afterAll(async () => {
  if (started) await boss?.stop();
  await c?.close();
});
beforeEach(() => {
  mocks.session.mockReset();
});
const wallNow = () => new Date(wallAt);
const expiresAt = new Date('2026-12-01T00:00:00Z');

async function setup() {
  const facts = await seedNativeCase(c.db);
  // Find-people is for managers; the same grant also writes this batch.
  await c.db
    .update(grants)
    .set({ role: 'manager', scope: 'company', cohortId: null })
    .where(eq(grants.accountId, facts.account));
  const sessions = new Map<string, string>();
  for (const account of [facts.account, facts.outsiderAccount]) {
    const id = 'session-' + randomUUID();
    await c.db.insert(user).values({
      id: account,
      name: '演示',
      email: randomUUID() + '@example.invalid',
    });
    await c.db.insert(session).values({
      id,
      userId: account,
      token: 'synthetic-' + id,
      expiresAt,
      bindingGeneration: 1,
    });
    sessions.set(account, id);
  }
  const recordsOn = (db: Database) =>
    createRecordBatchArrangeRequests({
      db,
      now: wallNow,
      businessNow: () => businessAt,
      // Creating the fixture batch only; opening a link never enqueues.
      enqueue: async () => undefined,
    });
  const records = recordsOn(c.db);
  const created = await records.create(facts.account, facts.input);
  if (created.status !== 'success') throw new Error('native batch required');
  const batch = created.result;
  const projectId = facts.prefix + '-project';
  await c.db.insert(projects).values({
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
  const demandId = facts.prefix + '-demand';
  await c.db.insert(demandRoots).values({
    id: demandId,
    projectId,
    initiatorAccountId: facts.account,
    initiatorPersonId: facts.evaluator,
    inputText: '演示：需要工程负责人',
    createdAt: businessAt,
    currentRevision: 2,
    promptVersion: 'demo',
  });
  const as = (account: string | null) =>
    mocks.session.mockResolvedValue(
      account === null
        ? null
        : {
            user: { id: account },
            session: {
              id: sessions.get(account)!,
              userId: account,
              expiresAt,
            },
          },
    );
  // The readers are built on the same database as the request, so a reader
  // that left the transaction for the pool would hit that pool too.
  const open = (href: string, db: Database = c.db) =>
    openEntryLinkRequest({
      db,
      headers: new Headers({ cookie: 'synthetic=1' }),
      href,
      records: recordsOn(db),
      wallNow,
      businessNow: () => businessAt,
    });
  const batchLink = (expectedRevision = batch.revision) =>
    buildEntryDeepLink({
      kind: 'material_batch',
      id: batch.batchId,
      expectedRevision,
    });
  const demandLink = (expectedRevision = 2) =>
    buildEntryDeepLink({
      kind: 'staffing_demand',
      id: demandId,
      expectedRevision,
    });
  const opens = () =>
    c.db
      .select({
        resourceId: auditEvents.resourceId,
        metadata: auditEvents.metadata,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, facts.account),
          eq(auditEvents.action, 'entry.link.open'),
        ),
      );
  return {
    ...facts,
    batch,
    projectId,
    demandId,
    as,
    open,
    batchLink,
    demandLink,
    opens,
  };
}

it('sends an anonymous opener to login with the canonical link and reads nothing', async () => {
  const f = await setup();
  f.as(null);
  expect(await f.open(f.batchLink())).toEqual({
    status: 'authentication_required',
    returnTo: f.batchLink(),
  });
  expect(await f.opens()).toEqual([]);
});
it('opens the batch receipt and the demand on the find-people page for the current owner', async () => {
  const f = await setup();
  f.as(f.account);
  expect(await f.open(f.batchLink())).toEqual({
    status: 'ready',
    target: {
      kind: 'material_batch',
      id: f.batch.batchId,
      expectedRevision: f.batch.revision,
    },
    href: `/receipt?id=${f.batch.batchId}`,
  });
  expect(await f.open(f.demandLink())).toMatchObject({
    status: 'ready',
    href: `/staffing?project=${f.projectId}&demand=${f.demandId}`,
  });
  expect(await f.opens()).toEqual(
    expect.arrayContaining([
      {
        resourceId: f.batch.batchId,
        metadata: { channel: 'web', revision: f.batch.revision },
      },
      { resourceId: f.demandId, metadata: { channel: 'web', revision: 2 } },
    ]),
  );
}, 15000);
it('a link whose revision is no longer current returns the refresh link, not the object', async () => {
  const f = await setup();
  f.as(f.account);
  expect(await f.open(f.demandLink(1))).toEqual({
    status: 'stale',
    refreshHref: f.demandLink(2),
  });
});
it('a batch link minted before the batch moved on returns the current refresh link', async () => {
  const f = await setup();
  f.as(f.account);
  const old = f.batchLink();
  expect(await f.open(old)).toMatchObject({ status: 'ready' });
  // The real runner produces the native draft set (revision 1); a later human
  // revision of the set is stood in for by advancing that set and its drafts.
  boss ??= new PgBoss({ connectionString: c.testUrl });
  if (!started) {
    boss.on('error', () => undefined);
    await boss.start();
    await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
    started = true;
  }
  const app = createRecordArrangeApplication({
    db: c.db,
    boss,
    client: syntheticBatchClient({ twoEvents: true }).client,
    businessNow: () => businessAt,
    now: wallNow,
  });
  expect(await app.runner.run(f.batch.jobId!, 1)).toBe('awaiting_manual');
  await c.db
    .update(recordDraftBatches)
    .set({ revision: 2 })
    .where(eq(recordDraftBatches.batchId, f.batch.batchId));
  await c.db.execute(
    sql`update records_drafts set revision = 2, draft = jsonb_set(draft, '{revision}', '2') where batch_id = ${f.batch.batchId}`,
  );
  const now = await app.requests.readBatch(f.account, {
    batchId: f.batch.batchId,
  });
  expect(now).toMatchObject({ status: 'success', result: { revision: 2 } });
  expect(await f.open(old)).toEqual({
    status: 'stale',
    refreshHref: f.batchLink(2),
  });
  expect(await f.open(f.batchLink(2))).toMatchObject({ status: 'ready' });
}, 15000);
it('an expired administrator session still goes to sign-in, not to the 404', async () => {
  const f = await setup();
  await c.db
    .update(accountBindings)
    .set({ isSystemAdmin: true })
    .where(eq(accountBindings.accountId, f.account));
  const past = new Date(new Date(wallAt).getTime() - 60_000);
  await c.db
    .update(session)
    .set({ expiresAt: past })
    .where(eq(session.userId, f.account));
  f.as(f.account);
  expect(await f.open(f.batchLink())).toEqual({
    status: 'authentication_required',
    returnTo: f.batchLink(),
  });
});
it('a system administrator gets the same 404 answer, never a login loop, and no audit', async () => {
  const f = await setup();
  f.as(f.account);
  await c.db
    .update(accountBindings)
    .set({ isSystemAdmin: true })
    .where(eq(accountBindings.accountId, f.account));
  expect(await f.open(f.batchLink())).toEqual({ status: 'forbidden' });
  expect(await f.open(f.demandLink())).toEqual({ status: 'forbidden' });
  expect(await f.opens()).toEqual([]);
});
it('a forwarded link and a switched account see the same answer as a missing object', async () => {
  const f = await setup();
  f.as(f.outsiderAccount);
  const missing = await f.open(
    buildEntryDeepLink({
      kind: 'material_batch',
      id: 'demo-missing',
      expectedRevision: 1,
    }),
  );
  expect(missing).toEqual({ status: 'forbidden' });
  expect(await f.open(f.batchLink())).toEqual(missing);
  expect(await f.open(f.demandLink())).toEqual(missing);
  // Switching back to the owner's own session opens it again.
  f.as(f.account);
  expect(await f.open(f.batchLink())).toMatchObject({ status: 'ready' });
});
it('an expired grant or evaluation relation closes links that worked before', async () => {
  const f = await setup();
  f.as(f.account);
  expect(await f.open(f.batchLink())).toMatchObject({ status: 'ready' });
  await c.db
    .update(evaluationRelations)
    .set({ validTo: '2026-02-01T00:00:00Z' })
    .where(eq(evaluationRelations.id, f.relation));
  await c.db
    .update(grants)
    .set({ validTo: '2026-02-01' })
    .where(eq(grants.accountId, f.account));
  expect(await f.open(f.batchLink())).toEqual({ status: 'forbidden' });
  expect(await f.open(f.demandLink())).toEqual({ status: 'forbidden' });
});
it('a demand still generating (revision 0) is not addressable', async () => {
  const f = await setup();
  f.as(f.account);
  await c.db
    .update(demandRoots)
    .set({ currentRevision: 0 })
    .where(eq(demandRoots.id, f.demandId));
  expect(await f.open(f.demandLink(1))).toEqual({ status: 'forbidden' });
});
it('opens with a one-connection pool: nothing borrows a second connection inside the transaction', async () => {
  const f = await setup();
  f.as(f.account);
  const pool = new Pool({
    connectionString: c.testUrl,
    max: 1,
    connectionTimeoutMillis: 1500,
  });
  try {
    const tight = drizzle(pool);
    expect(await f.open(f.batchLink(), tight)).toMatchObject({
      status: 'ready',
    });
    expect(await f.open(f.demandLink(), tight)).toMatchObject({
      status: 'ready',
    });
  } finally {
    await pool.end();
  }
}, 15000);
