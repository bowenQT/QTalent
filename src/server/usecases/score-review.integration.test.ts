import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../db/client';
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
import { ruleVersions, dimensions } from '../modules/evaluation-system';
import { events } from '../modules/records';
import { scoreReviews } from '../modules/talent';
import type { ReviewTarget } from '../modules/talent/score-review/ports';
import {
  readScoreReviewAuthority,
  listAuthorizedScoreReviewIdentities,
  canReviewScoreTarget,
} from './score-review';

const database = `qtalent_b849_authority_${randomUUID().replaceAll('-', '')}_test`;
const now = '2026-11-01T00:00:00.000Z';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const db = () => connection!.db;
const target: ReviewTarget = {
  itemId: 'demo-review-a',
  eventId: 'demo-event-a',
  personId: 'demo-person-a',
  evaluationNodeId: 'demo-node-a',
  dimensionId: 'demo-dimension',
  ruleVersion: 'demo-rule',
  revision: 1,
  status: 'open',
};
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('TEST_DATABASE_URL required; no fake/skip fallback');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated loopback _test database allowed');
  admin = new Pool({
    connectionString: source,
    max: 2,
    connectionTimeoutMillis: 3000,
  });
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW849_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
}, 30000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      } finally {
        await admin.end();
      }
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql`TRUNCATE directory_organizations, programs_cohorts, evaluation_rule_versions, evaluation_dimensions CASCADE`,
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      [
        'hr',
        'new-hr',
        'manager',
        'mentor',
        'admin',
        'person-a',
        'person-b',
      ].map((id) => ({
        id: 'demo-' + id,
        name: '演示·' + id,
        organizationId: 'demo-org',
        noReview: !id.startsWith('person-'),
      })),
    );
  await db()
    .insert(accountBindings)
    .values(
      ['hr', 'manager', 'mentor', 'admin'].map((role) => ({
        accountId: 'demo-' + role + '-account',
        personId: 'demo-' + role,
        isSystemAdmin: role === 'admin',
      })),
    );
  await db()
    .insert(cohorts)
    .values(
      ['a', 'b'].map((id) => ({
        id: 'demo-cohort-' + id,
        name: '演示期次' + id,
      })),
    );
  await db()
    .insert(enrollments)
    .values(
      ['a', 'b'].map((id) => ({
        id: 'demo-enrollment-' + id,
        personId: 'demo-person-' + id,
        cohortId: 'demo-cohort-' + id,
        confirmed: true,
        validFrom: '2026-01-01',
      })),
    );
  await db()
    .insert(grants)
    .values(
      ['hr', 'manager', 'mentor', 'admin'].map((role) => ({
        id: 'demo-' + role + '-grant',
        accountId: 'demo-' + role + '-account',
        role:
          role === 'admin'
            ? ('hr' as const)
            : (role as 'hr' | 'manager' | 'mentor'),
        scope: role === 'manager' ? ('company' as const) : ('cohort' as const),
        cohortId: role === 'manager' ? null : 'demo-cohort-a',
        validFrom: '2026-01-01',
      })),
    );
  await db()
    .insert(evaluationNodes)
    .values(
      ['a', 'b'].map((id) => ({
        id: 'demo-node-' + id,
        name: '演示答辩' + id,
        kind: 'defense' as const,
        cohortId: 'demo-cohort-' + id,
      })),
    );
  await db()
    .insert(evaluationNodeSubjects)
    .values(
      ['a', 'b'].map((id) => ({
        evaluationNodeId: 'demo-node-' + id,
        personId: 'demo-person-' + id,
      })),
    );
  await db()
    .insert(ruleVersions)
    .values({ id: 'demo-rule', provenance: 'published' });
  await db().insert(dimensions).values({
    id: 'demo-dimension',
    name: '演示维度',
    axis: 'prof',
    core: true,
  });
  await db()
    .insert(events)
    .values(
      ['a', 'b'].map((id) => ({
        id: 'demo-event-' + id,
        evaluationNodeId: 'demo-node-' + id,
        personId: 'demo-person-' + id,
        recorderId: 'demo-mentor',
        occurredOn: '2026-10-31',
        title: '演示事件',
        situation: '',
        behavior: '合成演示行为',
        impact: '',
        ruleVersionId: 'demo-rule',
      })),
    );
  // Metadata scope tests deliberately contain no score/evidence payload. These
  // legacy rows are not presented as processable reviews without ledger proof.
  await db()
    .insert(scoreReviews)
    .values(
      ['a', 'b'].map((id) => ({
        id: 'demo-review-' + id,
        eventId: 'demo-event-' + id,
        dimensionId: 'demo-dimension',
        reason: 'score_gap',
      })),
    );
});
it('HR自身noReview仍可履职，只读目标范围元数据，不装配虚假双方', async () => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  expect(authority).toEqual({
    accountId: 'demo-hr-account',
    personId: 'demo-hr',
    isSystemAdmin: false,
    hasHrRole: true,
  });
  const rows = await listAuthorizedScoreReviewIdentities(
    db(),
    authority.accountId,
    now,
  );
  expect(rows).toEqual([
    {
      itemId: target.itemId,
      eventId: target.eventId,
      personId: target.personId,
      evaluationNodeId: target.evaluationNodeId,
      dimensionId: target.dimensionId,
      ruleVersion: target.ruleVersion,
    },
  ]);
  expect(rows[0]).not.toHaveProperty('revision');
  expect(rows[0]).not.toHaveProperty('sides');
  expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(true);
});
it.each(['manager', 'mentor', 'admin', 'missing'])(
  '拒绝%s，伪造HR标志不能赋权',
  async (role) => {
    const accountId = 'demo-' + role + '-account';
    await expect(
      readScoreReviewAuthority(db(), accountId, now),
    ).rejects.toMatchObject({ name: 'ScoreReviewForbiddenError' });
    await expect(
      listAuthorizedScoreReviewIdentities(db(), accountId, now),
    ).rejects.toMatchObject({ name: 'ScoreReviewForbiddenError' });
    expect(
      await canReviewScoreTarget(
        db(),
        {
          accountId,
          personId: 'demo-' + role,
          isSystemAdmin: false,
          hasHrRole: true,
        },
        target,
        now,
      ),
    ).toBe(false);
  },
);
it.each(['revoked', 'expired'])(
  '每次读取重载%s授权，不接受旧authority',
  async (mode) => {
    const authority = await readScoreReviewAuthority(
      db(),
      'demo-hr-account',
      now,
    );
    await db()
      .update(grants)
      .set(
        mode === 'revoked'
          ? { revokedAt: '2026-11-01' }
          : { validTo: '2026-11-01' },
      )
      .where(eq(grants.id, 'demo-hr-grant'));
    expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(
      false,
    );
    await expect(
      listAuthorizedScoreReviewIdentities(db(), authority.accountId, now),
    ).rejects.toMatchObject({ name: 'ScoreReviewForbiddenError' });
  },
);
it('另一节点评价关系不能扩张HR负责期次', async () => {
  await db().insert(evaluationRelations).values({
    id: 'demo-cross-relation',
    evaluationNodeId: 'demo-node-b',
    personId: 'demo-person-b',
    evaluatorId: 'demo-hr',
    kind: 'judge',
    validFrom: '2026-01-01',
  });
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  expect(
    await canReviewScoreTarget(
      db(),
      authority,
      {
        ...target,
        itemId: 'demo-review-b',
        eventId: 'demo-event-b',
        personId: 'demo-person-b',
        evaluationNodeId: 'demo-node-b',
      },
      now,
    ),
  ).toBe(false);
  expect(
    await listAuthorizedScoreReviewIdentities(db(), authority.accountId, now),
  ).toHaveLength(1);
});
it.each([
  'itemId',
  'eventId',
  'personId',
  'evaluationNodeId',
  'dimensionId',
  'ruleVersion',
] as const)('目标%s须与实际review/event一致', async (field) => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  expect(
    await canReviewScoreTarget(
      db(),
      authority,
      { ...target, [field]: 'demo-forged' },
      now,
    ),
  ).toBe(false);
});
it('换绑使旧authority失效，新绑定仍须实际HR范围', async () => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  await db()
    .update(accountBindings)
    .set({ personId: 'demo-new-hr' })
    .where(eq(accountBindings.accountId, authority.accountId));
  expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(false);
  const fresh = await readScoreReviewAuthority(db(), authority.accountId, now);
  expect(fresh.personId).toBe('demo-new-hr');
  expect(await canReviewScoreTarget(db(), fresh, target, now)).toBe(true);
});
it('目标人员noReview排除；不把操作人noReview当作该限制', async () => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, target.personId));
  expect(
    await listAuthorizedScoreReviewIdentities(db(), authority.accountId, now),
  ).toEqual([]);
  expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(false);
});
it.each(['review', 'event'])(
  '真实%s撤回后不再列出也不能处理旧目标',
  async (kind) => {
    const authority = await readScoreReviewAuthority(
      db(),
      'demo-hr-account',
      now,
    );
    if (kind === 'review')
      await db()
        .update(scoreReviews)
        .set({ withdrawnAt: new Date(now) })
        .where(eq(scoreReviews.id, target.itemId));
    else
      await db()
        .update(events)
        .set({ withdrawnAt: new Date(now) })
        .where(eq(events.id, target.eventId));
    expect(
      await listAuthorizedScoreReviewIdentities(db(), authority.accountId, now),
    ).toEqual([]);
    expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(
      false,
    );
  },
);
it('已resolved不在队列，合法旧操作重放仍可核当前范围；第三类不接入', async () => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  await db()
    .update(scoreReviews)
    .set({ status: 'resolved' })
    .where(eq(scoreReviews.id, target.itemId));
  expect(
    await listAuthorizedScoreReviewIdentities(db(), authority.accountId, now),
  ).toEqual([]);
  expect(
    await canReviewScoreTarget(
      db(),
      authority,
      { ...target, status: 'resolved' },
      now,
    ),
  ).toBe(true);
  await db()
    .update(scoreReviews)
    .set({ reason: 'post_freeze_position_change' })
    .where(eq(scoreReviews.id, target.itemId));
  expect(await canReviewScoreTarget(db(), authority, target, now)).toBe(false);
});
it('RC事务等待后的授权调用读取撤权，基础设施错误仍抛出', async () => {
  const authority = await readScoreReviewAuthority(
    db(),
    'demo-hr-account',
    now,
  );
  await db().transaction(
    async (tx) => {
      await db()
        .update(grants)
        .set({ revokedAt: '2026-11-01' })
        .where(eq(grants.id, 'demo-hr-grant'));
      expect(await canReviewScoreTarget(tx, authority, target, now)).toBe(
        false,
      );
    },
    { isolationLevel: 'read committed' },
  );
  await expect(
    db().transaction(async (tx) => {
      await expect(tx.execute(sql`SELECT 1/0`)).rejects.toThrow();
      return readScoreReviewAuthority(tx, authority.accountId, now);
    }),
  ).rejects.toThrow();
});
