import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { createDatabase, getDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../modules/programs';
import { fixture, nodeFixture } from './person-test-helpers';
import { readJudgmentComparison } from '../modules/evaluation-system/judgment-comparison/read';
import { comparisonReadPorts, getJudgePage } from './judge';

vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));

const clock = createClock('test');
const databaseName =
  'qtalent_judge_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;

beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });

  const db = connection.db;
  const data = nodeFixture();
  await db.insert(organizations).values(data.directory.organizations);
  await db.insert(people).values(data.directory.people);
  await db.insert(cohorts).values(data.cohorts);
  await db.insert(enrollments).values({
    ...data.context.enrollments[0],
    id: 'enrollment',
  });
  for (const role of ['manager', 'hr', 'mentor', 'admin'] as const) {
    await db.insert(accountBindings).values({
      accountId: role,
      personId: 'actor',
      isSystemAdmin: role === 'admin',
    });
    await db.insert(grants).values({
      ...fixture(role).context.grants[0],
      id: role,
      accountId: role,
    });
  }
  await db.insert(evaluationNodes).values(
    data.context.evaluationNodes!.map((node) => ({
      ...node,
      name: '演示：' + node.id,
    })),
  );
  await db
    .insert(evaluationNodeSubjects)
    .values(data.context.evaluationNodeSubjects!);
  await db.insert(evaluationRelations).values([
    ...data.context.evaluationRelations!,
    {
      id: 'relation-other-evaluator',
      evaluationNodeId: 'node-other',
      personId: 'one',
      evaluatorId: 'two',
      kind: 'judge',
      validFrom: '2026-01-01T00:00:00.000Z',
    },
  ]);
}, 30_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(getDatabase).mockReturnValue(connection!.db);
  await connection!.db
    .update(evaluationRelations)
    .set({ validTo: null, revokedAt: null })
    .where(eq(evaluationRelations.id, 'relation-current'));
});

afterAll(async () => {
  vi.restoreAllMocks();
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

function signIn(accountId: string) {
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: accountId },
  } as Awaited<ReturnType<typeof requireSession>>);
}

it.each([
  ['admin', { status: 'admin' }],
  ['manager', { status: 'not_connected', audience: 'manager' }],
  ['hr', { status: 'not_connected', audience: 'hr' }],
  ['mentor', { status: 'not_connected', audience: 'rater' }],
  ['nobody', { status: 'forbidden' }],
] as const)(
  'resolves the /judge view of %s from persisted grants',
  async (account, page) => {
    signIn(account);
    expect(await getJudgePage()).toEqual(page);
  },
);

it('derives each audience scope from persisted node relations and grants', async () => {
  const db = connection!.db;
  const open = { validFrom: '2026-01-01T00:00:00.000Z', validUntil: null };
  const rater = await comparisonReadPorts(
    db,
    'mentor',
    clock,
  ).loadCurrentAccess();
  // Only the mentor's own relation counts; another evaluator's node does not.
  expect(rater?.grants).toEqual([
    { personId: 'one', nodeId: 'node-current', ...open },
  ]);
  const manager = await comparisonReadPorts(
    db,
    'manager',
    clock,
  ).loadCurrentAccess();
  expect(manager?.grants.map((grant) => grant.nodeId)).toEqual([
    'node-current',
    'node-other',
  ]);

  await db
    .update(evaluationRelations)
    .set({ revokedAt: clock.now().toISOString() })
    .where(eq(evaluationRelations.id, 'relation-current'));
  expect(
    await comparisonReadPorts(db, 'mentor', clock).loadCurrentAccess(),
  ).toMatchObject({ audience: 'rater', grants: [] });
});

it('reads no batch while comparison batches, mappings and selection judgments are not stored', async () => {
  const ports = comparisonReadPorts(connection!.db, 'manager', clock);
  const access = await ports.loadCurrentAccess();
  expect(access).not.toBeNull();
  expect(await ports.loadBatch('demo-batch', access!)).toBeNull();
});

it('answers forbidden through the real ports for an admin, an unbound account and a removed binding', async () => {
  const db = connection!.db;
  const forbidden = { status: 'forbidden', message: '当前账号无法读取此范围' };
  const read = (account: string) =>
    readJudgmentComparison(
      { batchId: 'demo-batch' },
      comparisonReadPorts(db, account, clock),
    );
  expect(
    await comparisonReadPorts(db, 'admin', clock).loadCurrentAccess(),
  ).toBeNull();
  expect(await read('admin')).toEqual(forbidden);
  expect(await read('nobody')).toEqual(forbidden);

  // A binding that existed when the session began and was removed since.
  await db
    .insert(accountBindings)
    .values({ accountId: 'removed', personId: 'actor', isSystemAdmin: false });
  await db.insert(grants).values({
    ...fixture('manager').context.grants[0],
    id: 'removed-manager',
    accountId: 'removed',
  });
  expect(await read('removed')).toEqual({
    status: 'not_found',
    message: '未找到可读取的对照批次',
  });
  await db.delete(grants).where(eq(grants.id, 'removed-manager'));
  await db
    .delete(accountBindings)
    .where(eq(accountBindings.accountId, 'removed'));
  expect(await read('removed')).toEqual(forbidden);
  signIn('removed');
  expect(await getJudgePage()).toEqual({ status: 'forbidden' });
});
