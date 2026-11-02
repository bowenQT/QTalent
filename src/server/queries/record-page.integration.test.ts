import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, getDatabase } from '../db/client';
import { organizations, people } from '../modules/directory';
import {
  anchors,
  dimensions,
  ruleVersionApplicability,
  ruleVersions,
} from '../modules/evaluation-system';
import { getRecordPage } from './record-arrange';
import { getRecordPageData, readRecordAnchors } from './record-page';

vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
// The business day is fixed in tests; rubric-v2 takes effect on it.
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../../lib/clock', () => ({
  createClock: () => ({ now: () => new Date('2026-10-15T00:00:00.000Z') }),
}));
vi.mock('./record-arrange', () => ({ getRecordPage: vi.fn() }));

const name = `qtalent_record_page_${randomUUID().replaceAll('-', '')}_test`;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
function db() {
  if (!connection)
    throw new Error('Real PostgreSQL fixture is not initialized');
  return connection.db;
}
const scope = (ids: string[]) => ({
  status: 'success' as const,
  context: {
    accountId: 'acc',
    people: ids.map((id) => ({ id, label: `演示${id}` })),
    projects: [{ id: 'proj-1', label: '演示项目' }],
    evaluationNodes: [],
    selectedPersonId: null,
    selectedProjectId: null,
    selectedEvaluationNodeId: null,
  },
});

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
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  vi.mocked(getDatabase).mockReturnValue(connection.db);
  await db().insert(organizations).values({
    id: 'org-demo',
    name: '演示事业部',
    shortName: '演示部',
  });
  await db()
    .insert(people)
    .values([
      {
        id: 'p-a',
        name: '演示甲',
        organizationId: 'org-demo',
        hue: 30,
        demo: false,
      },
      {
        id: 'p-b',
        name: '演示乙',
        organizationId: 'org-demo',
        hue: 200,
        photo: '/demo/b.png',
      },
      { id: 'p-out', name: '演示范围外', organizationId: 'org-demo' },
    ]);
  await db()
    .insert(dimensions)
    .values([
      { id: 'demo-mot', name: '演示内生动力', axis: 'pot', core: true },
      { id: 'demo-prof', name: '演示专业度', axis: 'prof', core: true },
      { id: 'demo-old', name: '演示旧维度', axis: 'pot', core: false },
    ]);
  for (const [id, from, until] of [
    ['rubric-v1', '2026-01-01', '2026-10-01'],
    ['rubric-v2', '2026-10-01', null],
  ] as const) {
    await db().insert(ruleVersions).values({ id, provenance: 'published' });
    await db()
      .insert(ruleVersionApplicability)
      .values({
        periodId: `demo-period:${id}`,
        versionId: id,
        category: 'dimension_anchors',
        effectiveFrom: new Date(`${from}T00:00:00Z`),
        effectiveUntil: until ? new Date(`${until}T00:00:00Z`) : null,
      });
  }
  await db()
    .insert(anchors)
    .values([
      ...[1, 2, 3, 4, 5].map((value) => ({
        id: `demo-mot-${value}`,
        dimensionId: 'demo-mot',
        ruleVersionId: 'rubric-v2',
        value,
        text: `演示：内生动力 ${value} 档`,
      })),
      {
        id: 'demo-prof-3',
        dimensionId: 'demo-prof',
        ruleVersionId: 'rubric-v2',
        value: 3,
        text: '演示：专业度 3 档',
      },
      {
        id: 'demo-old-3',
        dimensionId: 'demo-old',
        ruleVersionId: 'rubric-v1',
        value: 3,
        text: '演示：旧维度 3 档',
      },
    ]);
}, 30_000);
beforeEach(() => vi.mocked(getRecordPage).mockReset());
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});

it('adds display fields only to the people the 845 page read returned', async () => {
  vi.mocked(getRecordPage).mockResolvedValue(scope(['p-b', 'p-a', 'p-gone']));
  const data = await getRecordPageData();
  expect(data).toEqual({
    status: 'ok',
    // page() order is kept; an id without a directory row is dropped, not invented.
    people: [
      {
        id: 'p-b',
        name: '演示p-b',
        hue: 200,
        photo: '/demo/b.png',
        orgShort: '演示部',
        demo: true,
      },
      {
        id: 'p-a',
        name: '演示p-a',
        hue: 30,
        photo: null,
        orgShort: '演示部',
        // The directory flag is carried as stored, not assumed.
        demo: false,
      },
    ],
    projects: [{ id: 'proj-1', name: '演示项目' }],
    dimensions: [
      { id: 'demo-mot', name: '演示内生动力' },
      { id: 'demo-prof', name: '演示专业度' },
    ],
  });
  expect(JSON.stringify(data)).not.toContain('p-out');
  expect(getRecordPage).toHaveBeenCalledWith({});
});

it('reads no directory rows when the scope is empty', async () => {
  vi.mocked(getRecordPage).mockResolvedValue(scope([]));
  expect(await getRecordPageData()).toMatchObject({ status: 'ok', people: [] });
});

it.each([
  [{ status: 'forbidden' as const }, 'forbidden'],
  [{ status: 'not_found' as const }, 'forbidden'],
  [{ status: 'validation_error' as const }, 'unavailable'],
])('maps the page read %j to %s', async (answer, status) => {
  vi.mocked(getRecordPage).mockResolvedValue(answer);
  expect(await getRecordPageData()).toEqual({ status });
});

it('reads anchors of the asked versions only', async () => {
  expect(await readRecordAnchors([])).toEqual([]);
  const rows = await readRecordAnchors(['rubric-v1']);
  expect(rows).toEqual([
    {
      dimensionId: 'demo-old',
      ruleVersion: 'rubric-v1',
      value: 3,
      text: '演示：旧维度 3 档',
    },
  ]);
  expect(await readRecordAnchors(['rubric-v2'])).toHaveLength(6);
});
