import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';
import { createDatabase } from '../../../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
} from '..';
import {
  NodeConclusionError,
  canConfirmNodeConclusion,
} from '../node-conclusion';
import { createPostgresNodeConclusionContext } from './postgres';

const database = 'qtalent_b902_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined,
  connection: ReturnType<typeof createDatabase> | undefined,
  created = false;
const db = () => connection!.db;
const identity = { evaluationNodeId: 'demo-defense', personId: 'demo-person' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
  await admin.query('CREATE DATABASE "' + database + '"');
  created = true;
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
}, 30000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created)
          await admin.query('DROP DATABASE IF EXISTS "' + database + '"');
      } finally {
        await admin.end();
      }
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql`TRUNCATE directory_organizations, programs_cohorts, audit_events CASCADE`,
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      [
        'demo-person',
        'demo-hr',
        'demo-manager',
        'demo-judge',
        'demo-outside',
      ].map((id) => ({ id, name: '演示·' + id, organizationId: 'demo-org' })),
    );
  await db()
    .insert(accountBindings)
    .values([
      { accountId: 'demo-hr-account', personId: 'demo-hr' },
      { accountId: 'demo-manager-account', personId: 'demo-manager' },
    ]);
  await db()
    .insert(cohorts)
    .values([
      { id: 'demo-cohort-a', name: '演示期次A' },
      { id: 'demo-cohort-b', name: '演示期次B' },
    ]);
  await db()
    .insert(enrollments)
    .values([
      {
        id: 'demo-enrollment-a',
        cohortId: 'demo-cohort-a',
        personId: 'demo-person',
        confirmed: true,
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-enrollment-b',
        cohortId: 'demo-cohort-b',
        personId: 'demo-outside',
        confirmed: true,
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(grants)
    .values([
      {
        id: 'demo-hr-grant',
        accountId: 'demo-hr-account',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort-a',
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-manager-grant',
        accountId: 'demo-manager-account',
        role: 'manager',
        scope: 'company',
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(evaluationNodes)
    .values([
      {
        id: identity.evaluationNodeId,
        name: '演示答辩',
        kind: 'defense',
        cohortId: 'demo-cohort-a',
      },
      {
        id: 'demo-other-defense',
        name: '演示其他答辩',
        kind: 'defense',
        cohortId: 'demo-cohort-b',
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values([
      identity,
      { evaluationNodeId: 'demo-other-defense', personId: 'demo-outside' },
    ]);
});

it('原生事务声明Read Committed，同事务回滚真实写入', async () => {
  const native = createPostgresNodeConclusionContext(db());
  await expect(
    native.transaction(async (tx) => {
      const level = await tx.execute(sql`show transaction_isolation`);
      expect(level.rows[0]).toMatchObject({
        transaction_isolation: 'read committed',
      });
      await tx
        .update(people)
        .set({ name: '演示回滚中的姓名' })
        .where(eq(people.id, 'demo-hr'));
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  const [person] = await db()
    .select()
    .from(people)
    .where(eq(people.id, 'demo-hr'));
  expect(person!.name).toBe('演示·demo-hr');
});
it('原生授权读取真实899节点关系和当前目录署名，不以HR身份代替范围', async () => {
  const native = createPostgresNodeConclusionContext(db());
  const loaded = await native.transaction((tx) =>
    native.loadAuthorization(tx, 'demo-hr-account', '2026-09-04T00:00:00.000Z'),
  );
  expect(loaded.actor).toEqual({ id: 'demo-hr', name: '演示·demo-hr' });
  expect(canConfirmNodeConclusion(loaded.context, identity)).toBe(true);
  expect(
    canConfirmNodeConclusion(loaded.context, {
      evaluationNodeId: 'demo-other-defense',
      personId: 'demo-outside',
    }),
  ).toBe(false);
  await db()
    .update(people)
    .set({ name: '演示·当前目录名称' })
    .where(eq(people.id, 'demo-hr'));
  const fresh = await native.transaction((tx) =>
    native.loadAuthorization(tx, 'demo-hr-account', '2026-09-04T00:00:00.000Z'),
  );
  expect(fresh.actor.name).toBe('演示·当前目录名称');
});
it('目录署名为空时失败关闭，不接受客户端替代署名', async () => {
  await db()
    .update(people)
    .set({ name: '   ' })
    .where(eq(people.id, 'demo-hr'));
  const native = createPostgresNodeConclusionContext(db());
  await expect(
    native.transaction((tx) =>
      native.loadAuthorization(
        tx,
        'demo-hr-account',
        '2026-09-04T00:00:00.000Z',
      ),
    ),
  ).rejects.toMatchObject({ code: 'forbidden' });
});
it.each(['unknown', 'admin'] as const)(
  '原生身份%s失败关闭，不把数据库错误伪装成功',
  async (mode) => {
    if (mode === 'admin')
      await db()
        .update(accountBindings)
        .set({ isSystemAdmin: true })
        .where(eq(accountBindings.accountId, 'demo-hr-account'));
    const native = createPostgresNodeConclusionContext(db());
    await expect(
      native.transaction((tx) =>
        native.loadAuthorization(
          tx,
          mode === 'unknown' ? 'missing-account' : 'demo-hr-account',
          '2026-09-04T00:00:00.000Z',
        ),
      ),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<NodeConclusionError>);
  },
);
it.each(['operation', 'identity'] as const)(
  '原生%s锁后重读，在等锁期间撤权不可复用旧授权',
  async (kind) => {
    const native = createPostgresNodeConclusionContext(db()),
      held = deferred(),
      release = deferred(),
      entered = deferred();
    const session = 'b902-' + randomUUID();
    const lock = (tx: Parameters<typeof native.lockConclusion>[0]) =>
      kind === 'identity'
        ? native.lockConclusion(tx, identity)
        : native.lockOperation(tx, 'demo-hr-account', 'demo-operation');
    const holder = native.transaction(async (tx) => {
      await lock(tx);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const waiting = native.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('application_name', ${session}, true)`,
      );
      entered.resolve();
      await lock(tx);
      return native.loadAuthorization(
        tx,
        'demo-hr-account',
        '2026-09-04T00:00:00.000Z',
      );
    });
    void waiting.catch(() => undefined);
    try {
      await entered.promise;
      const deadline = Date.now() + 2000;
      let observed = false;
      while (Date.now() < deadline) {
        const state = await db().execute(
          sql`select 1 from pg_stat_activity where application_name = ${session} and wait_event_type = 'Lock'`,
        );
        if (state.rows.length === 1) {
          observed = true;
          break;
        }
        await delay(10);
      }
      expect(
        observed,
        'The real second PostgreSQL transaction must wait on the lock',
      ).toBe(true);
      await db()
        .update(grants)
        .set({ revokedAt: '2026-09-04' })
        .where(eq(grants.id, 'demo-hr-grant'));
    } finally {
      release.resolve();
      await holder;
    }
    const loaded = await waiting;
    expect(canConfirmNodeConclusion(loaded.context, identity)).toBe(false);
  },
);
it('锁后按当前业务日判断到期，不复用demo固定日期', async () => {
  const native = createPostgresNodeConclusionContext(db());
  await db()
    .update(grants)
    .set({ validTo: '2026-09-05' })
    .where(eq(grants.id, 'demo-hr-grant'));
  const loaded = await native.transaction(async (tx) => {
    await native.lockConclusion(tx, identity);
    return native.loadAuthorization(
      tx,
      'demo-hr-account',
      '2026-09-05T00:00:00.000Z',
    );
  });
  expect(canConfirmNodeConclusion(loaded.context, identity)).toBe(false);
});
it('授权读取失败不映射成空身份或allow-all', async () => {
  const native = createPostgresNodeConclusionContext(db());
  await expect(
    native.transaction(async (tx) => {
      await tx.execute(sql`select 1/0`).catch(() => undefined);
      return native.loadAuthorization(
        tx,
        'demo-hr-account',
        '2026-09-04T00:00:00.000Z',
      );
    }),
  ).rejects.toMatchObject({ cause: { code: '25P02' } });
});
