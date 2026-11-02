import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client';
import {
  accountBindings,
  grants,
  organizations,
  people,
} from '../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  evaluationWorkItems,
  insertEvaluationWorkItem,
  completeEvaluationWorkItem,
} from '../modules/programs';
import { loadEvaluationContext } from '../usecases/evaluation-context';
import { reassignEvaluationWork } from '../usecases/reassign-evaluation-work';
import { readWorkbenchTodoSources } from './workbench-todos';

const now = '2026-11-01T12:00:00.000Z';
const dbName = `qtalent_b863_${randomUUID().replaceAll('-', '')}_test`;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const db = () => connection!.db;
const task = {
  id: 'demo-task',
  evaluationNodeId: 'demo-node',
  personId: 'demo-person',
  assignedRelationId: 'demo-relation',
  assignedEvaluatorId: 'demo-mentor',
  kind: 'speaker' as const,
  resourceId: 'demo-review-item',
};
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('BOW-863 requires isolated TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('BOW-863 requires a loopback _test database');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${dbName}"`);
  url.pathname = '/' + dbName;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      } finally {
        await admin.end();
      }
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql`TRUNCATE directory_organizations, programs_cohorts CASCADE`,
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '化名演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      ['person', 'outside', 'hr', 'mentor', 'next', 'manager', 'admin'].map(
        (id) => ({
          id: `demo-${id}`,
          name: `化名演示 ${id}`,
          organizationId: 'demo-org',
        }),
      ),
    );
  await db()
    .insert(accountBindings)
    .values(
      ['hr', 'mentor', 'next', 'manager', 'admin'].map((id) => ({
        accountId: `account-${id}`,
        personId: `demo-${id}`,
        isSystemAdmin: id === 'admin',
      })),
    );
  await db()
    .insert(cohorts)
    .values([
      { id: 'demo-cohort', name: '化名演示期次' },
      { id: 'outside-cohort', name: '范围外演示期次' },
    ]);
  await db()
    .insert(grants)
    .values([
      {
        id: 'grant-hr',
        accountId: 'account-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'grant-mentor',
        accountId: 'account-mentor',
        role: 'mentor',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'grant-next',
        accountId: 'account-next',
        role: 'mentor',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'grant-manager',
        accountId: 'account-manager',
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(enrollments)
    .values([
      {
        id: 'enrollment',
        personId: 'demo-person',
        cohortId: 'demo-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
      {
        id: 'outside-enrollment',
        personId: 'demo-outside',
        cohortId: 'outside-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(evaluationNodes)
    .values([
      {
        id: 'demo-node',
        name: '化名演示答辩',
        kind: 'defense',
        cohortId: 'demo-cohort',
      },
      {
        id: 'other-node',
        name: '化名演示面试',
        kind: 'interview',
        cohortId: null,
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values([
      { evaluationNodeId: 'demo-node', personId: 'demo-person' },
      { evaluationNodeId: 'demo-node', personId: 'demo-outside' },
      { evaluationNodeId: 'other-node', personId: 'demo-person' },
    ]);
  await db()
    .insert(evaluationRelations)
    .values([
      {
        id: 'demo-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-mentor',
        kind: 'mentor',
        validFrom: '2026-01-01',
      },
      {
        id: 'next-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-next',
        kind: 'evaluator',
        validFrom: '2026-01-01',
      },
      {
        id: 'outside-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-outside',
        evaluatorId: 'demo-next',
        kind: 'evaluator',
        validFrom: '2026-01-01',
        validTo: now,
      },
      {
        id: 'other-node-relation',
        evaluationNodeId: 'other-node',
        personId: 'demo-person',
        evaluatorId: 'demo-next',
        kind: 'interviewer',
        validFrom: '2026-01-01',
      },
    ]);
  await db().transaction((tx) => insertEvaluationWorkItem(tx, task, now));
});
async function registered(account = 'account-mentor', instant = now) {
  const result = await readWorkbenchTodoSources(db(), account, instant);
  expect(result.status).toBe('not_connected');
  if (result.status !== 'not_connected')
    throw new Error('No registered source');
  return result.registeredWork;
}
async function expireOwner() {
  await db()
    .update(evaluationRelations)
    .set({ validTo: now })
    .where(eq(evaluationRelations.id, 'demo-relation'));
}

describe('BOW-863 real registered-work read', () => {
  it('reads persisted source and keeps unconnected producers explicit', async () => {
    expect(await registered()).toMatchObject({
      count: 1,
      items: [{ id: task.id, action: 'handle' }],
    });
    expect(
      await readWorkbenchTodoSources(db(), 'account-mentor', now),
    ).toMatchObject({
      status: 'not_connected',
      speakerInventory: { status: 'not_connected' },
      nodeCoverage: { status: 'not_connected' },
      scoreReviews: { status: 'not_connected' },
    });
  });
  it('source replay does not create a second todo', async () => {
    await db().transaction((tx) =>
      insertEvaluationWorkItem(
        tx,
        { ...task, id: 'duplicate-registration' },
        now,
      ),
    );
    expect((await registered()).count).toBe(1);
    expect(await db().select().from(evaluationWorkItems)).toHaveLength(1);
  });
  it('a real completion removes the item on the next read', async () => {
    await db().transaction((tx) =>
      completeEvaluationWorkItem(
        tx,
        task.id,
        1,
        async (tx) =>
          (await loadEvaluationContext(tx, 'account-mentor', now)).context,
      ),
    );
    expect((await registered()).count).toBe(0);
  });
  it('cancelled source tasks are not pending', async () => {
    await db()
      .update(evaluationWorkItems)
      .set({ state: 'cancelled', revision: 2 })
      .where(eq(evaluationWorkItems.id, task.id));
    expect((await registered()).count).toBe(0);
  });
  it('HR reassignment transfers the real item and removes the reassign reminder', async () => {
    await expireOwner();
    expect((await registered()).count).toBe(0);
    expect(await registered('account-hr')).toMatchObject({
      count: 1,
      items: [{ action: 'reassign' }],
    });
    const receipt = await reassignEvaluationWork(
      db(),
      'account-hr',
      {
        operationId: 'demo-reassign',
        workItemId: task.id,
        expectedRevision: 1,
        targetRelationId: 'next-relation',
      },
      () => now,
    );
    expect(receipt).toMatchObject({
      replayed: false,
      receipt: { workItemId: task.id, revision: 2 },
    });
    expect((await registered()).count).toBe(0);
    expect((await registered('account-hr')).count).toBe(0);
    expect(await registered('account-next')).toMatchObject({
      count: 1,
      items: [{ revision: 2, action: 'handle' }],
    });
  });
  it('a task completed before its owner expired never becomes an HR reassign reminder', async () => {
    await db().transaction((tx) =>
      completeEvaluationWorkItem(
        tx,
        task.id,
        1,
        async (tx) =>
          (await loadEvaluationContext(tx, 'account-mentor', now)).context,
      ),
    );
    await expireOwner();
    expect(await registered('account-hr')).toMatchObject({
      count: 0,
      items: [],
    });
  });
  it('a cancelled task of an expired owner is not offered for reassignment', async () => {
    await expireOwner();
    await db()
      .update(evaluationWorkItems)
      .set({ state: 'cancelled', revision: 2 })
      .where(eq(evaluationWorkItems.id, task.id));
    expect(await registered('account-hr')).toMatchObject({
      count: 0,
      items: [],
    });
  });
  it('HR never sees the outside-person expired item', async () => {
    await expireOwner();
    await db().transaction((tx) =>
      insertEvaluationWorkItem(
        tx,
        {
          ...task,
          id: 'outside-task',
          personId: 'demo-outside',
          assignedRelationId: 'outside-relation',
          assignedEvaluatorId: 'demo-next',
          resourceId: 'outside-review',
        },
        now,
      ),
    );
    expect((await registered('account-hr')).items.map((x) => x.id)).toEqual([
      task.id,
    ]);
  });
  it('same person in another node does not grant its tasks', async () => {
    await db().transaction((tx) =>
      insertEvaluationWorkItem(
        tx,
        {
          ...task,
          id: 'cross-node-task',
          evaluationNodeId: 'other-node',
          assignedRelationId: 'other-node-relation',
          assignedEvaluatorId: 'demo-next',
        },
        now,
      ),
    );
    expect((await registered()).items.map((x) => x.id)).toEqual([task.id]);
  });
  it('current grant revocation denies a previously readable account', async () => {
    expect((await registered()).count).toBe(1);
    await db()
      .update(grants)
      .set({ revokedAt: '2026-11-01' })
      .where(eq(grants.id, 'grant-mentor'));
    await expect(registered()).rejects.toThrow('无权限');
  });
  it('rebound account cannot keep old person tasks', async () => {
    await db()
      .update(accountBindings)
      .set({ personId: 'demo-next' })
      .where(eq(accountBindings.accountId, 'account-mentor'));
    expect((await registered()).count).toBe(0);
  });
  it('expiration is evaluated at the current instant', async () => {
    await db()
      .update(evaluationRelations)
      .set({ validTo: now })
      .where(eq(evaluationRelations.id, 'demo-relation'));
    expect(
      (await registered('account-mentor', '2026-11-01T11:59:59.999Z')).count,
    ).toBe(1);
    expect((await registered()).count).toBe(0);
  });
  it('target noReview suppresses the registered item', async () => {
    await db()
      .update(people)
      .set({ noReview: true })
      .where(eq(people.id, 'demo-person'));
    expect((await registered()).count).toBe(0);
  });
  it('manager does not receive count or source item identity', async () => {
    expect(
      await readWorkbenchTodoSources(db(), 'account-manager', now),
    ).toEqual({ status: 'not_applicable' });
  });
  it.each(['account-admin', 'unknown-account'])(
    'denies %s',
    async (account) => {
      await expect(
        readWorkbenchTodoSources(db(), account, now),
      ).rejects.toThrow('无权限');
    },
  );
  it('does not reinterpret an empty registered source as connected coverage or speaker inventory', async () => {
    await db().delete(evaluationWorkItems);
    expect(
      await readWorkbenchTodoSources(db(), 'account-mentor', now),
    ).toMatchObject({
      status: 'not_connected',
      registeredWork: { count: 0 },
      nodeCoverage: { status: 'not_connected' },
      speakerInventory: { status: 'not_connected' },
    });
  });
  it('a rolled back completion remains pending', async () => {
    await expect(
      db().transaction(async (tx) => {
        await completeEvaluationWorkItem(
          tx,
          task.id,
          1,
          async (tx) =>
            (await loadEvaluationContext(tx, 'account-mentor', now)).context,
        );
        throw new Error('Synthetic rollback');
      }),
    ).rejects.toThrow('Synthetic rollback');
    expect((await registered()).count).toBe(1);
  });
});
