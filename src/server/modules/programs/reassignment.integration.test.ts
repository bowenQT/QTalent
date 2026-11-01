import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { createDatabase } from '../../db/client';
import * as directorySchema from '../directory/schema';
import * as programsSchema from './schema';
import * as staffingSchema from '../staffing/schema';
import * as evaluationSchema from '../evaluation-system/schema';
import * as recordsSchema from '../records/schema';
import * as auditSchema from '../../platform/audit/schema';
import { reassignEvaluationWork } from '../../usecases/reassign-evaluation-work';
import { readEvaluationReassignments } from '../../usecases/read-evaluation-reassignments';
import { loadEvaluationContext } from '../../usecases/evaluation-context';
import {
  completeEvaluationWorkItem,
  insertEvaluationWorkItem,
  readEvaluationWorkItemForUpdate,
} from './reassignment-store';
import { canWorkOnEvaluationItem } from './reassignment-policy';
import { canReadNodeTalent } from '../../authz/evaluation-node';
import {
  evaluationWorkFixture,
  reassignmentInputFixture as input,
  reassignmentNow,
} from './reassignment.fixtures';

const name = 'qtalent_b899_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const db = () => connection!.db;
const now = () => reassignmentNow;
const { organizations, people, accountBindings, grants } = directorySchema;
const {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  evaluationWorkItems,
  evaluationReassignmentOperations,
} = programsSchema;
const { auditEvents } = auditSchema;
const { events } = recordsSchema;
const original = evaluationWorkFixture();
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'BOW-899 requires real loopback TEST_DATABASE_URL ending _test; no mock or skip fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(
      'BOW-899 test database must be isolated loopback and end _test',
    );
  admin = new Pool({ connectionString: source, max: 3 });
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  // A local generated test schema, never the final migration or production DB.
  const schema = generateDrizzleJson({
    ...directorySchema,
    ...programsSchema,
    ...staffingSchema,
    ...evaluationSchema,
    ...recordsSchema,
    ...auditSchema,
  });
  const statements = await generateMigration(generateDrizzleJson({}), schema);
  for (const statement of statements) await db().execute(sql.raw(statement));
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
      await admin.end();
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql.raw(
      'TRUNCATE directory_organizations, programs_cohorts, audit_events CASCADE',
    ),
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  const personIds = [
    'demo-person',
    'demo-hr',
    'demo-old-evaluator',
    'demo-new-evaluator',
    'demo-manager',
    'demo-admin',
    'demo-outside',
  ];
  await db()
    .insert(people)
    .values(
      personIds.map((id) => ({
        id,
        name: '演示：' + id,
        organizationId: 'demo-org',
      })),
    );
  await db()
    .insert(accountBindings)
    .values([
      { accountId: 'demo-hr-account', personId: 'demo-hr' },
      { accountId: 'demo-old-account', personId: 'demo-old-evaluator' },
      { accountId: 'demo-new-account', personId: 'demo-new-evaluator' },
      { accountId: 'demo-manager-account', personId: 'demo-manager' },
      {
        accountId: 'demo-admin-account',
        personId: 'demo-admin',
        isSystemAdmin: true,
      },
    ]);
  await db()
    .insert(cohorts)
    .values([
      { id: 'demo-cohort', name: '演示期次' },
      { id: 'demo-other-cohort', name: '演示另一期次' },
    ]);
  await db()
    .insert(grants)
    .values([
      {
        id: 'demo-hr-grant',
        accountId: 'demo-hr-account',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-manager-grant',
        accountId: 'demo-manager-account',
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
        id: 'demo-enrollment',
        personId: 'demo-person',
        cohortId: 'demo-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-outside-enrollment',
        personId: 'demo-outside',
        cohortId: 'demo-other-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(evaluationNodes)
    .values([
      { id: 'demo-node', name: '演示面试', kind: 'interview', cohortId: null },
      {
        id: 'demo-other-node',
        name: '演示答辩',
        kind: 'defense',
        cohortId: 'demo-other-cohort',
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values([
      { evaluationNodeId: 'demo-node', personId: 'demo-person' },
      { evaluationNodeId: 'demo-other-node', personId: 'demo-person' },
      { evaluationNodeId: 'demo-other-node', personId: 'demo-outside' },
    ]);
  await db()
    .insert(evaluationRelations)
    .values([
      {
        id: 'demo-old-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-old-evaluator',
        kind: 'interviewer',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: reassignmentNow,
      },
      {
        id: 'demo-new-relation',
        evaluationNodeId: 'demo-node',
        personId: 'demo-person',
        evaluatorId: 'demo-new-evaluator',
        kind: 'evaluator',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-11-01T00:00:00.000Z',
      },
      {
        id: 'demo-cross-node-relation',
        evaluationNodeId: 'demo-other-node',
        personId: 'demo-person',
        evaluatorId: 'demo-new-evaluator',
        kind: 'judge',
        validFrom: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'demo-outside-relation',
        evaluationNodeId: 'demo-other-node',
        personId: 'demo-outside',
        evaluatorId: 'demo-old-evaluator',
        kind: 'evaluator',
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: reassignmentNow,
      },
    ]);
  await db().insert(evaluationRelations).values({
    id: 'demo-third-relation',
    evaluationNodeId: 'demo-node',
    personId: 'demo-person',
    evaluatorId: 'demo-manager',
    kind: 'evaluator',
    validFrom: '2026-01-01T00:00:00.000Z',
  });
  await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: original.id,
        evaluationNodeId: original.evaluationNodeId,
        personId: original.personId,
        assignedRelationId: original.assignedRelationId,
        assignedEvaluatorId: original.assignedEvaluatorId,
        kind: original.kind,
        resourceId: original.resourceId,
      },
      original.updatedAt,
    ),
  );
});
async function currentWork() {
  const [item] = await db()
    .select()
    .from(evaluationWorkItems)
    .where(eq(evaluationWorkItems.id, original.id));
  return item;
}
it('expires the former evaluator, transfers once under concurrent replay, and fences old/finished work', async () => {
  await db()
    .update(evaluationWorkItems)
    .set({ state: 'processing' })
    .where(eq(evaluationWorkItems.id, original.id));
  const oldContext = (
    await loadEvaluationContext(db(), 'demo-old-account', now())
  ).context;
  expect(canWorkOnEvaluationItem(oldContext, await currentWork())).toBe(false);
  const results = await Promise.all([
    reassignEvaluationWork(db(), 'demo-hr-account', input, now),
    reassignEvaluationWork(db(), 'demo-hr-account', input, now),
  ]);
  expect(results.map((result) => result.replayed).sort()).toEqual([
    false,
    true,
  ]);
  expect(results[0].receipt).toEqual(results[1].receipt);
  const transferred = await currentWork();
  expect(transferred).toMatchObject({
    revision: 2,
    assignedEvaluatorId: 'demo-new-evaluator',
    assignedRelationId: 'demo-new-relation',
  });
  expect(
    await db().select().from(evaluationReassignmentOperations),
  ).toHaveLength(1);
  expect(await db().select().from(auditEvents)).toHaveLength(1);
  const newContext = (
    await loadEvaluationContext(db(), 'demo-new-account', now())
  ).context;
  expect(canWorkOnEvaluationItem(newContext, transferred)).toBe(true);
  expect(canWorkOnEvaluationItem(oldContext, transferred)).toBe(false);
  const duplicate = await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: 'another-generated-id',
        evaluationNodeId: original.evaluationNodeId,
        personId: original.personId,
        assignedRelationId: original.assignedRelationId,
        assignedEvaluatorId: original.assignedEvaluatorId,
        kind: original.kind,
        resourceId: original.resourceId,
      },
      now(),
    ),
  );
  expect(duplicate.id).toBe(original.id);
  expect(duplicate.revision).toBe(2);
  expect(duplicate.assignedRelationId).toBe('demo-new-relation');
  await expect(
    db().transaction((tx) =>
      completeEvaluationWorkItem(
        tx,
        original.id,
        2,
        async (lockedTx) =>
          (await loadEvaluationContext(lockedTx, 'demo-old-account', now()))
            .context,
      ),
    ),
  ).rejects.toThrow('当前处理范围');
  await expect(
    db().transaction((tx) =>
      completeEvaluationWorkItem(
        tx,
        original.id,
        1,
        async (lockedTx) =>
          (await loadEvaluationContext(lockedTx, 'demo-new-account', now()))
            .context,
      ),
    ),
  ).rejects.toThrow('重新分派');
  await db().transaction((tx) =>
    completeEvaluationWorkItem(
      tx,
      original.id,
      2,
      async (lockedTx) =>
        (await loadEvaluationContext(lockedTx, 'demo-new-account', now()))
          .context,
    ),
  );
  const replay = await reassignEvaluationWork(
    db(),
    'demo-hr-account',
    input,
    now,
  );
  expect(replay).toEqual({ replayed: true, receipt: results[0].receipt });
  expect((await currentWork()).revision).toBe(3);
  expect(await db().select().from(auditEvents)).toHaveLength(1);
});
it('keeps current HR authorization ahead of replay and rejects payload or revision conflicts', async () => {
  await reassignEvaluationWork(db(), 'demo-hr-account', input, now);
  await expect(
    reassignEvaluationWork(
      db(),
      'demo-hr-account',
      {
        ...input,
        targetRelationId: 'demo-cross-node-relation',
      },
      now,
    ),
  ).rejects.toThrow('同一提交编号');
  await expect(
    reassignEvaluationWork(
      db(),
      'demo-hr-account',
      {
        ...input,
        operationId: 'demo-new-key',
      },
      now,
    ),
  ).rejects.toThrow('状态已变化');
  await db()
    .update(grants)
    .set({ revokedAt: '2026-10-31' })
    .where(eq(grants.id, 'demo-hr-grant'));
  await expect(
    reassignEvaluationWork(db(), 'demo-hr-account', input, now),
  ).rejects.toThrow('没有重新分派');
  expect(
    await db().select().from(evaluationReassignmentOperations),
  ).toHaveLength(1);
});
it('serializes different operation keys racing on one expected revision', async () => {
  const results = await Promise.allSettled([
    reassignEvaluationWork(db(), 'demo-hr-account', input, now),
    reassignEvaluationWork(
      db(),
      'demo-hr-account',
      { ...input, operationId: 'demo-second-key' },
      now,
    ),
  ]);
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(
    1,
  );
  expect((await currentWork()).revision).toBe(2);
  expect(
    await db().select().from(evaluationReassignmentOperations),
  ).toHaveLength(1);
  expect(await db().select().from(auditEvents)).toHaveLength(1);
});
it('rolls back ownership and replay state if audit persistence fails', async () => {
  await db().execute(
    sql.raw(
      "CREATE FUNCTION fail_b899_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$",
    ),
  );
  await db().execute(
    sql.raw(
      'CREATE TRIGGER fail_b899_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_b899_audit()',
    ),
  );
  try {
    await expect(
      reassignEvaluationWork(db(), 'demo-hr-account', input, now),
    ).rejects.toThrow();
    expect(await currentWork()).toMatchObject({
      revision: 1,
      assignedEvaluatorId: 'demo-old-evaluator',
    });
    expect(
      await db().select().from(evaluationReassignmentOperations),
    ).toHaveLength(0);
    expect(await db().select().from(auditEvents)).toHaveLength(0);
  } finally {
    await db().execute(sql.raw('DROP TRIGGER fail_b899_audit ON audit_events'));
    await db().execute(sql.raw('DROP FUNCTION fail_b899_audit()'));
  }
});
it('reads only scoped orphan work and enforces both HR-only interview review handlers', async () => {
  const kinds = [
    'speaker',
    'unknown_person',
    'image_scope',
    'unknown_interviewer',
    'unknown_project',
    'unknown_interview_candidate',
  ] as const;
  for (const kind of kinds)
    await db().transaction((tx) =>
      insertEvaluationWorkItem(
        tx,
        {
          id: 'demo-work-' + kind,
          evaluationNodeId: 'demo-node',
          personId: 'demo-person',
          assignedRelationId: 'demo-old-relation',
          assignedEvaluatorId: 'demo-old-evaluator',
          kind,
          resourceId: 'demo-resource-' + kind,
        },
        now(),
      ),
    );
  await db().transaction((tx) =>
    insertEvaluationWorkItem(
      tx,
      {
        id: 'demo-outside-work',
        evaluationNodeId: 'demo-other-node',
        personId: 'demo-outside',
        assignedRelationId: 'demo-outside-relation',
        assignedEvaluatorId: 'demo-old-evaluator',
        kind: 'confirmation',
        resourceId: 'demo-outside-resource',
      },
      now(),
    ),
  );
  const result = await readEvaluationReassignments(
    db(),
    'demo-hr-account',
    now(),
  );
  expect(result.items).toHaveLength(7);
  expect(JSON.stringify(result)).not.toContain('demo-outside');
  for (const kind of ['unknown_interviewer', 'unknown_interview_candidate'])
    expect(result.items.find((item) => item.kind === kind)!.candidates).toEqual(
      [],
    );
  expect(
    result.items
      .find((item) => item.kind === 'speaker')!
      .candidates.map((candidate) => candidate.relationId),
  ).toEqual(['demo-new-relation', 'demo-third-relation']);
  await expect(
    readEvaluationReassignments(db(), 'demo-new-account', now()),
  ).rejects.toThrow('HR');
  for (const kind of ['unknown_interviewer', 'unknown_interview_candidate'])
    await expect(
      reassignEvaluationWork(
        db(),
        'demo-hr-account',
        {
          ...input,
          operationId: 'demo-' + kind + '-operation',
          workItemId: 'demo-work-' + kind,
        },
        now,
      ),
    ).rejects.toThrow('接手评价关系');
  await db().insert(grants).values({
    id: 'demo-successor-hr',
    accountId: 'demo-new-account',
    role: 'hr',
    scope: 'cohort',
    cohortId: 'demo-cohort',
    validFrom: '2026-01-01',
  });
  for (const kind of ['unknown_interviewer', 'unknown_interview_candidate']) {
    expect(
      (await readEvaluationReassignments(db(), 'demo-hr-account', now())).items
        .find((item) => item.kind === kind)!
        .candidates.map((candidate) => candidate.relationId),
    ).toEqual(['demo-new-relation']);
    expect(
      (
        await reassignEvaluationWork(
          db(),
          'demo-hr-account',
          {
            ...input,
            operationId: 'demo-' + kind + '-operation',
            workItemId: 'demo-work-' + kind,
          },
          now,
        )
      ).receipt,
    ).toMatchObject({
      assignedEvaluatorId: 'demo-new-evaluator',
      kind,
      resourceId: 'demo-resource-' + kind,
    });
  }
  for (const accountId of [
    'demo-old-account',
    'demo-new-account',
    'demo-manager-account',
    'demo-admin-account',
  ]) {
    if (accountId === 'demo-new-account') continue;
    await expect(
      readEvaluationReassignments(db(), accountId, now()),
    ).rejects.toThrow();
  }
});
it('persists a node-linked event without a project and rejects unrelated node assignments at the DB boundary', async () => {
  await db()
    .insert(evaluationSchema.ruleVersions)
    .values({ id: 'demo-rule', provenance: 'published' })
    .onConflictDoNothing();
  await db().insert(events).values({
    id: 'demo-event',
    evaluationNodeId: 'demo-node',
    personId: 'demo-person',
    recorderId: 'demo-new-evaluator',
    projectId: null,
    occurredOn: '2026-10-31',
    title: '演示：独立节点事件',
    situation: '演示环境',
    behavior: '完成合成任务',
    impact: '演示验证',
    ruleVersionId: 'demo-rule',
    demo: true,
  });
  const [event] = await db()
    .select()
    .from(events)
    .where(eq(events.id, 'demo-event'));
  expect(event).toMatchObject({
    evaluationNodeId: 'demo-node',
    projectId: null,
  });
  await expect(
    db()
      .insert(events)
      .values({
        ...event,
        id: 'demo-invalid-node-event',
        evaluationNodeId: 'missing-node',
      }),
  ).rejects.toThrow();
  await expect(
    db()
      .insert(events)
      .values({
        ...event,
        id: 'demo-wrong-subject-event',
        personId: 'demo-outside',
      }),
  ).rejects.toThrow();
  const context = (await loadEvaluationContext(db(), 'demo-new-account', now()))
    .context;
  expect(
    canReadNodeTalent(
      context,
      {
        evaluationNodeId: event.evaluationNodeId!,
        personId: event.personId,
        kind: 'evaluation',
      },
      'person-profile',
    ),
  ).toBe(true);
  expect(
    canReadNodeTalent(
      context,
      {
        evaluationNodeId: 'missing-node',
        personId: event.personId,
        kind: 'evaluation',
      },
      'person-profile',
    ),
  ).toBe(false);
  await expect(
    db()
      .update(evaluationWorkItems)
      .set({
        assignedRelationId: 'demo-cross-node-relation',
      })
      .where(eq(evaluationWorkItems.id, original.id)),
  ).rejects.toThrow();
  expect((await currentWork()).assignedRelationId).toBe('demo-old-relation');
});
it('reads the business clock after waiting for row locks so a successor cannot expire in the queue unnoticed', async () => {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = db().transaction(async (tx) => {
    await readEvaluationWorkItemForUpdate(tx, original.id);
    acquired();
    await held;
  });
  await ready;
  let instant = reassignmentNow;
  const clock = vi.fn(() => instant);
  const pending = reassignEvaluationWork(
    db(),
    'demo-hr-account',
    input,
    clock,
  ).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  try {
    await vi.waitFor(
      async () => {
        const waiting = await admin!.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = $2',
          [name, 'Lock'],
        );
        expect(waiting.rows[0].n).toBeGreaterThan(0);
      },
      { interval: 20, timeout: 3000 },
    );
    expect(clock).not.toHaveBeenCalled();
    instant = '2026-11-01T00:00:00.000Z';
  } finally {
    release();
    await blocker;
  }
  const result = await pending;
  expect(result.value).toBeNull();
  expect(result.error).toBeInstanceOf(Error);
  expect((result.error as Error).message).toContain('接手评价关系');
  expect((await currentWork()).revision).toBe(1);
  expect(await db().select().from(auditEvents)).toHaveLength(0);
});

it('observes an HR revocation committed while the request is waiting for the work lock', async () => {
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blocker = db().transaction(async (tx) => {
    await readEvaluationWorkItemForUpdate(tx, original.id);
    acquired();
    await held;
  });
  await ready;
  const pending = reassignEvaluationWork(
    db(),
    'demo-hr-account',
    input,
    now,
  ).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  try {
    await vi.waitFor(
      async () => {
        const waiting = await admin!.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = $2',
          [name, 'Lock'],
        );
        expect(waiting.rows[0].n).toBeGreaterThan(0);
      },
      { interval: 20, timeout: 3000 },
    );
    await db()
      .update(grants)
      .set({ revokedAt: '2026-10-31' })
      .where(eq(grants.id, 'demo-hr-grant'));
  } finally {
    release();
    await blocker;
  }
  const result = await pending;
  expect(result.value).toBeNull();
  expect((result.error as Error).message).toContain('没有重新分派');
  expect((await currentWork()).revision).toBe(1);
  expect(
    await db().select().from(evaluationReassignmentOperations),
  ).toHaveLength(0);
  expect(await db().select().from(auditEvents)).toHaveLength(0);
});

it.each([
  { kind: 'confirmation', revoked: 'relation' },
  { kind: 'unknown_interview_candidate', revoked: 'relation' },
  { kind: 'unknown_interview_candidate', revoked: 'hr' },
] as const)(
  'reloads $kind completion authority after a committed $revoked revocation during the row-lock wait',
  async ({ kind, revoked }) => {
    await db()
      .update(evaluationWorkItems)
      .set({ kind })
      .where(eq(evaluationWorkItems.id, original.id));
    if (kind === 'unknown_interview_candidate')
      await db().insert(grants).values({
        id: 'demo-successor-hr',
        accountId: 'demo-new-account',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      });
    await reassignEvaluationWork(db(), 'demo-hr-account', input, now);
    let release!: () => void;
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db().transaction(async (tx) => {
      await readEvaluationWorkItemForUpdate(tx, original.id);
      acquired();
      await held;
    });
    await ready;
    const pending = db()
      .transaction((tx) =>
        completeEvaluationWorkItem(
          tx,
          original.id,
          2,
          async (lockedTx) =>
            (await loadEvaluationContext(lockedTx, 'demo-new-account', now()))
              .context,
        ),
      )
      .then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
    try {
      await vi.waitFor(
        async () => {
          const waiting = await admin!.query(
            'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1 AND wait_event_type = $2',
            [name, 'Lock'],
          );
          expect(waiting.rows[0].n).toBeGreaterThan(0);
        },
        { interval: 20, timeout: 3000 },
      );
      if (revoked === 'relation')
        await db()
          .update(evaluationRelations)
          .set({ revokedAt: reassignmentNow })
          .where(eq(evaluationRelations.id, 'demo-new-relation'));
      else
        await db()
          .update(grants)
          .set({ revokedAt: '2026-10-31' })
          .where(eq(grants.id, 'demo-successor-hr'));
    } finally {
      release();
      await blocker;
    }
    const result = await pending;
    expect(result.value).toBeNull();
    expect((result.error as Error).message).toContain('当前处理范围');
    expect(await currentWork()).toMatchObject({
      revision: 2,
      state: 'pending',
    });
    expect(await db().select().from(auditEvents)).toHaveLength(1);
  },
);

it.each(['unknown_project', 'unknown_interview_candidate'] as const)(
  'keeps a %s native work item stable through concurrent transfer, completion and registration replay',
  async (kind) => {
    await db().insert(grants).values({
      id: 'demo-successor-hr',
      accountId: 'demo-new-account',
      role: 'hr',
      scope: 'cohort',
      cohortId: 'demo-cohort',
      validFrom: '2026-01-01',
    });
    // A source may register only after it has resolved a trusted node/subject.
    // This tests the native port; it does not invent an unknown candidate's identity.
    const registration = {
      id: 'demo-source-work',
      evaluationNodeId: 'demo-node',
      personId: 'demo-person',
      assignedRelationId: 'demo-old-relation',
      assignedEvaluatorId: 'demo-old-evaluator',
      kind,
      resourceId: 'demo-source-review-item-1',
    };
    await db().transaction((tx) =>
      insertEvaluationWorkItem(tx, registration, now()),
    );
    const sourceInput = { ...input, workItemId: registration.id };
    const results = await Promise.all([
      reassignEvaluationWork(db(), 'demo-hr-account', sourceInput, now),
      reassignEvaluationWork(db(), 'demo-hr-account', sourceInput, now),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0].receipt).toEqual(results[1].receipt);
    expect(results[0].receipt).toMatchObject({
      workItemId: registration.id,
      kind,
      resourceId: registration.resourceId,
      revision: 2,
    });
    await db().transaction((tx) =>
      completeEvaluationWorkItem(
        tx,
        registration.id,
        2,
        async (lockedTx) =>
          (await loadEvaluationContext(lockedTx, 'demo-new-account', now()))
            .context,
      ),
    );
    const replay = await db().transaction((tx) =>
      insertEvaluationWorkItem(
        tx,
        {
          ...registration,
          id: 'demo-repeated-delivery-id',
        },
        now(),
      ),
    );
    expect(replay).toMatchObject({
      id: registration.id,
      resourceId: registration.resourceId,
      state: 'completed',
      revision: 3,
      assignedRelationId: 'demo-new-relation',
    });
    expect(
      await reassignEvaluationWork(db(), 'demo-hr-account', sourceInput, now),
    ).toEqual({ replayed: true, receipt: results[0].receipt });
    await expect(
      reassignEvaluationWork(
        db(),
        'demo-hr-account',
        {
          ...sourceInput,
          operationId: 'demo-new-operation',
          expectedRevision: 3,
        },
        now,
      ),
    ).rejects.toThrow('状态已变化');
    const cancelled = {
      ...registration,
      id: 'demo-cancelled-work',
      resourceId: 'demo-source-review-item-2',
    };
    await db().transaction((tx) =>
      insertEvaluationWorkItem(tx, cancelled, now()),
    );
    await db()
      .update(evaluationWorkItems)
      .set({ state: 'cancelled' })
      .where(eq(evaluationWorkItems.id, cancelled.id));
    expect(
      await db().transaction((tx) =>
        insertEvaluationWorkItem(tx, cancelled, now()),
      ),
    ).toMatchObject({ id: cancelled.id, state: 'cancelled', revision: 1 });
    const queue = await readEvaluationReassignments(
      db(),
      'demo-hr-account',
      now(),
    );
    expect(queue.items.map((item) => item.workItemId)).toEqual([original.id]);
    expect(
      await db().select().from(evaluationReassignmentOperations),
    ).toHaveLength(1);
    expect(await db().select().from(auditEvents)).toHaveLength(1);
  },
);

it.each(['', '   '])(
  'rejects an empty stable source reference %j before registration',
  async (resourceId) => {
    await expect(
      db().transaction((tx) =>
        insertEvaluationWorkItem(
          tx,
          {
            id: 'demo-invalid-registration',
            evaluationNodeId: 'demo-node',
            personId: 'demo-person',
            assignedRelationId: 'demo-old-relation',
            assignedEvaluatorId: 'demo-old-evaluator',
            kind: 'confirmation',
            resourceId,
          },
          now(),
        ),
      ),
    ).rejects.toThrow();
    expect(await db().select().from(evaluationWorkItems)).toHaveLength(1);
  },
);
