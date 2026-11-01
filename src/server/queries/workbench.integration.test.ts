import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { workbenchPageSchema } from '../../contracts/page-result';
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
  assignments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../modules/programs';
import { projects, members } from '../modules/staffing';
import * as personData from './person-data';
import { fixture, nodeFixture } from './person-test-helpers';
import {
  getWorkbenchForCurrentUser,
  WorkbenchNotConnectedError,
} from './workbench';

vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', async (original) => ({
  ...(await original<typeof import('../db/client')>()),
  getDatabase: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));

const now = '2026-09-04T00:00:00.000Z';
const databaseName =
  'qtalent_workbench_' + randomUUID().replaceAll('-', '') + '_test';
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
  // This live legacy assignment is deliberately retained when the node
  // relationship expires or is revoked. It must never restore access.
  await db.insert(assignments).values({
    ...data.context.assignments[0],
    id: 'assignment',
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
    .values([
      ...data.context.evaluationNodeSubjects!,
      { evaluationNodeId: 'node-other', personId: 'two' },
    ]);
  await db.insert(evaluationRelations).values([
    ...data.context.evaluationRelations!,
    {
      id: 'relation-other-node',
      evaluationNodeId: 'node-other',
      personId: 'two',
      evaluatorId: 'one',
      kind: 'judge',
      validFrom: '2026-01-01T00:00:00.000Z',
    },
  ]);
  await db.insert(projects).values({
    id: 'topic',
    name: '演示：第六期课题',
    type: '课题',
    status: '进行中',
    goal: '演示目标',
    organizationId: 'org',
    cohortId: 'cohort',
    isTopic: true,
    creatorId: 'actor',
    from: '2026-01-01',
    to: '2026-12-31',
  });
  await db.insert(members).values({
    id: 'member',
    projectId: 'topic',
    personId: 'one',
    role: '成员',
    mode: '兼职',
    validFrom: '2026-01-01',
    by: 'actor',
  });
}, 30_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  const db = connection!.db;
  vi.mocked(getDatabase).mockReturnValue(db);
  signIn('mentor');
  await db
    .update(evaluationRelations)
    .set({
      evaluatorId: 'actor',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      revokedAt: null,
    })
    .where(eq(evaluationRelations.id, 'relation-current'));
  await db
    .update(grants)
    .set({ validTo: null, revokedAt: null })
    .where(eq(grants.id, 'mentor'));
  await db.delete(grants).where(eq(grants.id, 'mixed-hr'));
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

it('reads actual node membership and the selected cohort topic through the native query', async () => {
  const result = await getWorkbenchForCurrentUser();
  expect(workbenchPageSchema.parse(result)).toEqual({
    status: 'ok',
    data: {
      role: 'mentor',
      greeting: { displayName: 'Synthetic actor' },
      asOf: '2026-09-04',
      entries: ['record'],
      trainees: {
        status: 'ready',
        data: [
          {
            person: {
              id: 'one',
              name: 'Synthetic one',
              hue: 220,
              photo: null,
            },
            topic: '演示：第六期课题',
            activity: { status: 'unknown', reason: '近期记录尚未接通' },
          },
        ],
      },
      todos: { status: 'not_connected' },
      recommendations: { status: 'not_connected' },
      materialTasks: { status: 'not_connected' },
    },
  });
  // A different evaluator's current defense-node relation is not a student
  // of this mentor, even though all three identities exist in the database.
  expect(JSON.stringify(result)).not.toMatch(
    /Synthetic two|score|quadrant|management|source|recordedThisWeek/,
  );
});

it.each([
  ['validTo', now],
  ['revokedAt', now],
  ['validFrom', '2026-09-04T00:00:00.001Z'],
  ['evaluatorId', 'two'],
] as const)(
  're-reads persisted %s and excludes an ineligible node relationship',
  async (field, value) => {
    await connection!.db
      .update(evaluationRelations)
      .set({ [field]: value })
      .where(eq(evaluationRelations.id, 'relation-current'));
    expect(await getWorkbenchForCurrentUser()).toMatchObject({
      status: 'ok',
      data: { role: 'mentor', trainees: { status: 'empty' } },
    });
    const [legacy] = await connection!.db.select().from(assignments);
    expect(legacy).toMatchObject({
      personId: 'actor',
      studentId: 'one',
      validTo: null,
      revokedAt: null,
    });
  },
);

it('allows the inclusive start and rejects the exclusive end at the current instant', async () => {
  await connection!.db
    .update(evaluationRelations)
    .set({ validFrom: now })
    .where(eq(evaluationRelations.id, 'relation-current'));
  expect(await getWorkbenchForCurrentUser()).toHaveProperty(
    'data.trainees.status',
    'ready',
  );
  await connection!.db
    .update(evaluationRelations)
    .set({
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: now,
    })
    .where(eq(evaluationRelations.id, 'relation-current'));
  expect(await getWorkbenchForCurrentUser()).toHaveProperty(
    'data.trainees.status',
    'empty',
  );
});

it('uses real current authorization after the initial database snapshot has been loaded', async () => {
  const readSnapshot = personData.loadPersonData;
  vi.spyOn(personData, 'loadPersonData').mockImplementationOnce(
    async (...args) => {
      const snapshot = await readSnapshot(...args);
      expect(
        snapshot.context.evaluationRelations?.find(
          (relation) => relation.id === 'relation-current',
        )?.revokedAt,
      ).toBeNull();
      await connection!.db
        .update(evaluationRelations)
        .set({ revokedAt: now })
        .where(eq(evaluationRelations.id, 'relation-current'));
      return snapshot;
    },
  );
  expect(await getWorkbenchForCurrentUser()).toHaveProperty(
    'data.trainees.status',
    'empty',
  );
});

it.each(['manager', 'hr'] as const)(
  'keeps the existing %s scope and disconnected blocks without fabricating zero',
  async (role) => {
    signIn(role);
    const result = await getWorkbenchForCurrentUser();
    expect(workbenchPageSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      status: 'ok',
      data: { role, entries: ['record', 'find_people'], asOf: '2026-09-04' },
    });
    const blocks =
      role === 'manager'
        ? [
            'judgmentReminders',
            'noteworthyPeople',
            'noteworthyProjects',
            'myWatch',
          ]
        : ['changedPeople', 'judgmentComparison', 'todos', 'materialTasks'];
    for (const block of blocks)
      expect(result).toHaveProperty('data.' + block, {
        status: 'not_connected',
      });
    expect(result).not.toHaveProperty('data.trainees');
    expect(JSON.stringify(result)).not.toMatch(
      /Synthetic one|Synthetic two|count|total/,
    );
  },
);

it.each(['admin', 'missing'])(
  'returns only forbidden for the %s account',
  async (accountId) => {
    signIn(accountId);
    expect(await getWorkbenchForCurrentUser()).toEqual({ status: 'forbidden' });
  },
);

it('returns forbidden after the persisted business grant is revoked', async () => {
  await connection!.db
    .update(grants)
    .set({ revokedAt: '2026-09-04' })
    .where(eq(grants.id, 'mentor'));
  expect(await getWorkbenchForCurrentUser()).toEqual({ status: 'forbidden' });
});

it('preserves the explicit mixed HR and mentor unavailable boundary', async () => {
  await connection!.db.insert(grants).values({
    ...fixture('hr').context.grants[0],
    id: 'mixed-hr',
    accountId: 'mentor',
  });
  await expect(getWorkbenchForCurrentUser()).rejects.toBeInstanceOf(
    WorkbenchNotConnectedError,
  );
});
