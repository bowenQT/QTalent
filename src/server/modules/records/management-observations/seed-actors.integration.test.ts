import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { createDatabase, type Transaction } from '../../../db/client';
import { importDemo } from '../../../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../../../db/seed';
import { loadEvaluationContext } from '../../../usecases/evaluation-context';
import {
  createManagementObservation,
  readManagementObservations,
} from '../../../usecases/management-observations';
import * as directory from '../../directory/schema';
import * as programs from '../../programs/schema';
import * as staffing from '../../staffing/schema';
import * as evaluation from '../../evaluation-system/schema';
import * as talent from '../../talent/schema';
import * as records from '../schema';
import * as saves from '../save-state/schema';
import * as auth from '../../../auth/schema';
import * as audit from '../../../platform/audit/schema';
import * as observations from './schema';
import { createManagementObservationPostgresPorts } from './postgres';

const name = 'qtalent_904_seed_' + randomUUID().replaceAll('-', '') + '_test';
const now = '2026-10-31T12:00:00.000Z';
let admin: Pool | undefined,
  connection: ReturnType<typeof createDatabase> | undefined,
  created = false;
let seed: ReturnType<typeof mapPrototypeSeed>;
let target: { personId: string; evaluationNodeId: string },
  mentorRelationId: string;
const db = () => connection!.db;
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error('BOW-904 seed regression requires real TEST_DATABASE_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid isolated test database configuration');
  }
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port === '55432' ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(
      'Isolated designated loopback _test database required; old 55432 forbidden',
    );
  admin = new Pool({ connectionString: raw, max: 3 });
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  vi.stubEnv('APP_ENV', 'test');
  vi.stubEnv('DATABASE_URL', url.toString());
  vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-b904-isolated-auth-secret-only');
  vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
  vi.stubEnv('ACCESS_ENFORCED', 'false');
  const schema = generateDrizzleJson({
    ...directory,
    ...programs,
    ...staffing,
    ...evaluation,
    ...talent,
    ...records,
    ...saves,
    ...auth,
    ...audit,
    ...observations,
  });
  for (const statement of await generateMigration(
    generateDrizzleJson({}),
    schema,
  ))
    await db().execute(sql.raw(statement));
  seed = mapPrototypeSeed(readPrototypeSeed(process.cwd()));
  await importDemo(db(), seed, 'Synthetic-904-test-password-only');
  // importDemo already writes 899's cohort node mapping; never invent a
  // graduation node or infer permissions from noReview.
  const relations = await db().select().from(programs.evaluationRelations);
  const mentor = seed.accounts.find((a) => a.role === 'mentor')!;
  const relation = relations.find(
    (r) =>
      r.evaluatorId === mentor.personId &&
      r.evaluationNodeId === 'cohort:b-xe6',
  )!;
  expect(relation).toBeDefined();
  target = {
    personId: relation.personId,
    evaluationNodeId: relation.evaluationNodeId,
  };
  mentorRelationId = relation.id;
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    try {
      if (admin) {
        if (created) await admin.query('DROP DATABASE "' + name + '"');
        await admin.end();
      }
    } finally {
      vi.unstubAllEnvs();
    }
  }
});
beforeEach(async () => {
  await db().delete(observations.managementObservationSources);
  await db().delete(observations.managementObservationOperations);
  await db().delete(observations.managementObservations);
  await db().delete(audit.auditEvents);
});
function account(role: 'hr' | 'manager' | 'mentor') {
  return seed.accounts.find((a) => a.role === role)!;
}
async function lockFacts(tx: Transaction) {
  await tx.execute(
    sql`lock table directory_account_bindings,directory_people,directory_grants,programs_enrollments,programs_assignments,programs_evaluation_nodes,programs_evaluation_node_subjects,programs_evaluation_relations in share mode`,
  );
}
function store() {
  return createManagementObservationPostgresPorts(db(), {
    lockFacts,
    loadSnapshot: async (tx, id) => {
      const current = await loadEvaluationContext(tx, id, now);
      return {
        context: current.context,
        actorName: current.directory.people.find(
          (p) => p.id === current.context.account.personId,
        )!.name,
      };
    },
    // These handwritten records have no attachments or interview attribution. Unexpected source calls fail closed.
    loadSources: async () => [],
    loadAttribution: async () => {
      throw new Error('No interview attribution in this seed regression');
    },
  });
}
function input(operationId = 'seed-actor-operation') {
  return {
    origin: 'manual' as const,
    operationId,
    ...target,
    text: '演示：履职身份与是否被评价分开判断。',
    occurredAt: '2026-10-30',
    sources: [],
  };
}
async function evidenceCounts() {
  const [events] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(records.events);
  const [scores] = await db()
    .select({ count: sql<number>`count(*)::int` })
    .from(talent.confirmations);
  return { events: events.count, scores: scores.count };
}
it.each(['hr', 'manager', 'mentor'] as const)(
  'formal seed %s with noReview can create, replay and read an authorized observation',
  async (role) => {
    const actor = account(role);
    const [person] = await db()
      .select()
      .from(directory.people)
      .where(eq(directory.people.id, actor.personId));
    expect(person.noReview).toBe(true);
    expect(person.id).toBe(
      ({ hr: 'p-suwan', manager: 'p-cheng', mentor: 'p-yeqing' } as const)[
        role
      ],
    );
    const evidenceBefore = await evidenceCounts();
    const created = await createManagementObservation(
      store(),
      actor.id,
      input(),
    );
    expect(created.observation.author).toEqual({
      personId: actor.personId,
      name: person.name,
    });
    const replayed = await createManagementObservation(
      store(),
      actor.id,
      input(),
    );
    expect(replayed.replayed).toBe(true);
    expect(replayed.observation).toEqual(created.observation);
    expect(await readManagementObservations(store(), actor.id, target)).toEqual(
      [created.observation],
    );
    expect(
      await db().select().from(observations.managementObservations),
    ).toHaveLength(1);
    expect(
      await db().select().from(observations.managementObservationOperations),
    ).toHaveLength(1);
    expect(await db().select().from(audit.auditEvents)).toHaveLength(1);
    expect(await evidenceCounts()).toEqual(evidenceBefore);
    expect(
      (
        await db()
          .select()
          .from(directory.people)
          .where(eq(directory.people.id, actor.personId))
      )[0].noReview,
    ).toBe(true);
  },
);
it('formal seed noReview is still a target exclusion even for manager/HR with an explicit node membership', async () => {
  const excluded = account('manager').personId;
  const member = {
    evaluationNodeId: target.evaluationNodeId,
    personId: excluded,
  };
  await db().insert(programs.evaluationNodeSubjects).values(member);
  try {
    for (const role of ['hr', 'manager'] as const) {
      await expect(
        createManagementObservation(store(), account(role).id, {
          ...input(),
          personId: excluded,
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        readManagementObservations(store(), account(role).id, member),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(
      await db().select().from(observations.managementObservations),
    ).toHaveLength(0);
  } finally {
    await db()
      .delete(programs.evaluationNodeSubjects)
      .where(
        and(
          eq(
            programs.evaluationNodeSubjects.evaluationNodeId,
            member.evaluationNodeId,
          ),
          eq(programs.evaluationNodeSubjects.personId, member.personId),
        ),
      );
  }
});
it('formal seed grant/relation expiry, employee and unknown identities remain denied', async () => {
  const mentor = account('mentor');
  await createManagementObservation(store(), mentor.id, input());
  const [relation] = await db()
    .select()
    .from(programs.evaluationRelations)
    .where(eq(programs.evaluationRelations.id, mentorRelationId));
  try {
    await db()
      .update(programs.evaluationRelations)
      .set({ validTo: now })
      .where(eq(programs.evaluationRelations.id, mentorRelationId));
    await expect(
      createManagementObservation(store(), mentor.id, input()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      readManagementObservations(store(), mentor.id, target),
    ).rejects.toMatchObject({ code: 'forbidden' });
  } finally {
    await db()
      .update(programs.evaluationRelations)
      .set({ validTo: relation.validTo })
      .where(eq(programs.evaluationRelations.id, mentorRelationId));
  }
  const hr = account('hr');
  const [grant] = await db()
    .select()
    .from(directory.grants)
    .where(eq(directory.grants.accountId, hr.id));
  try {
    await db()
      .update(directory.grants)
      .set({ validTo: '2026-10-31' })
      .where(eq(directory.grants.id, grant.id));
    await expect(
      createManagementObservation(store(), hr.id, input()),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      readManagementObservations(store(), hr.id, target),
    ).rejects.toMatchObject({ code: 'forbidden' });
  } finally {
    await db()
      .update(directory.grants)
      .set({ validTo: grant.validTo })
      .where(eq(directory.grants.id, grant.id));
  }
  await db()
    .insert(directory.accountBindings)
    .values({ accountId: 'synthetic-904-employee', personId: target.personId });
  try {
    for (const id of [
      'synthetic-904-employee',
      'missing-904-account',
      'demo-admin',
    ]) {
      await expect(
        createManagementObservation(store(), id, input('denied')),
      ).rejects.toThrow();
      await expect(
        readManagementObservations(store(), id, target),
      ).rejects.toThrow();
    }
  } finally {
    await db()
      .delete(directory.accountBindings)
      .where(eq(directory.accountBindings.accountId, 'synthetic-904-employee'));
  }
  expect(
    await db().select().from(observations.managementObservations),
  ).toHaveLength(1);
  expect(await db().select().from(audit.auditEvents)).toHaveLength(1);
});
