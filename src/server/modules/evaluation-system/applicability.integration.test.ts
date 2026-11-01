import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { createDatabase, type Transaction } from '../../db/client';
import {
  anchors,
  dimensions,
  ruleVersionApplicability,
  ruleVersions,
} from './schema';
import {
  lockRuleCategory,
  switchSelectionApplicability,
  RuleApplicabilityConflictError,
  type SelectionApplicabilitySwitch,
} from './applicability';
import { readEffectiveRuleVersion } from './effective-version';
import { backfillLegacyRuleVersionApplicability } from './legacy-applicability';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_applicability_${randomUUID().replaceAll('-', '')}_test`;
const t0 = new Date('2026-01-01T00:00:00.000Z');
const t1 = new Date('2026-06-01T00:00:00.000Z');
const t2 = new Date('2026-10-01T00:00:00.000Z');
const db = () => {
  if (!connection) throw new Error('Real PG fixture not initialized');
  return connection.db;
};
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('Real PG TEST_DATABASE_URL required; no skip/fake');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Loopback _test database required');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
}, 30_000);
beforeEach(async () => {
  await db().delete(ruleVersionApplicability);
  await db().delete(anchors);
  await db().delete(dimensions);
  await db().delete(ruleVersions);
  await db()
    .insert(ruleVersions)
    .values([
      { id: 'xe-select-v1', provenance: 'published' },
      { id: 'xe-select-v2', provenance: 'published' },
      {
        id: 'rubric-v1',
        provenance: 'demo_import_snapshot',
        sourceCommit: '2e51b50',
      },
      {
        id: 'xe-weekly-v1',
        provenance: 'demo_import_snapshot',
        sourceCommit: '2e51b50',
      },
    ]);
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
const rows = () =>
  db()
    .select()
    .from(ruleVersionApplicability)
    .orderBy(ruleVersionApplicability.periodId);
const switchTo = (input: SelectionApplicabilitySwitch) =>
  db().transaction((tx) => switchSelectionApplicability(tx, input));
const start = () =>
  switchTo({
    expectedPeriodId: null,
    newPeriodId: 'demo-period-1',
    versionId: 'xe-select-v1',
    at: t0,
  });
const next = (
  extra: Partial<SelectionApplicabilitySwitch> = {},
): SelectionApplicabilitySwitch => ({
  expectedPeriodId: 'demo-period-1',
  newPeriodId: 'demo-period-2',
  versionId: 'xe-select-v2',
  at: t1,
  ...extra,
});
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitForCategoryLock(pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await db().execute(
      sql`select wait_event_type = 'Lock' and wait_event = 'advisory' as waiting from pg_stat_activity where pid = ${pid}`,
    );
    if (result.rows[0]?.waiting === true) return;
    await delay(10);
  }
  throw new Error('Second transaction did not reach the category lock');
}
async function pid(tx: Transaction) {
  return Number(
    (await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid,
  );
}
const usages = [
  { ruleVersionId: 'rubric-v1', usedAt: t0 },
  { ruleVersionId: 'xe-weekly-v1', usedAt: t1 },
];

describe('真实PG规则生效区段', () => {
  it('v1→v2→v1保存三段历史，按过去时间仍返回原区段', async () => {
    await start();
    await switchTo(next());
    await switchTo(
      next({
        expectedPeriodId: 'demo-period-2',
        newPeriodId: 'demo-period-3',
        versionId: 'xe-select-v1',
        at: t2,
      }),
    );
    expect(await rows()).toEqual([
      {
        periodId: 'demo-period-1',
        versionId: 'xe-select-v1',
        category: 'xe_selection',
        effectiveFrom: t0,
        effectiveUntil: t1,
      },
      {
        periodId: 'demo-period-2',
        versionId: 'xe-select-v2',
        category: 'xe_selection',
        effectiveFrom: t1,
        effectiveUntil: t2,
      },
      {
        periodId: 'demo-period-3',
        versionId: 'xe-select-v1',
        category: 'xe_selection',
        effectiveFrom: t2,
        effectiveUntil: null,
      },
    ]);
    for (const [at, versionId, effectiveFrom] of [
      ['2026-05-31T23:59:59.999Z', 'xe-select-v1', t0],
      [t1.toISOString(), 'xe-select-v2', t1],
      ['2026-09-30T23:59:59.999Z', 'xe-select-v2', t1],
      [t2.toISOString(), 'xe-select-v1', t2],
    ] as const)
      expect(
        await readEffectiveRuleVersion(db(), { category: 'xe_selection', at }),
      ).toMatchObject({
        status: 'success',
        version: { versionId, effectiveFrom: effectiveFrom.toISOString() },
      });
  });
  it('同毫秒发布/撤销保留空段，但有效读取只返回正区间且不移动时钟', async () => {
    await start();
    await switchTo(next({ at: t0 }));
    await switchTo(
      next({
        expectedPeriodId: 'demo-period-2',
        newPeriodId: 'demo-period-3',
        versionId: 'xe-select-v1',
        at: t0,
      }),
    );
    expect(
      (await rows()).map((row) => [
        row.periodId,
        row.effectiveFrom,
        row.effectiveUntil,
      ]),
    ).toEqual([
      ['demo-period-1', t0, t0],
      ['demo-period-2', t0, t0],
      ['demo-period-3', t0, null],
    ]);
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: t0.toISOString(),
      }),
    ).toMatchObject({
      status: 'success',
      version: {
        versionId: 'xe-select-v1',
        effectiveFrom: t0.toISOString(),
        effectiveUntil: null,
      },
    });
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: '2025-12-31T23:59:59.999Z',
      }),
    ).toHaveProperty('status', 'not_found');
  });
  it('选择标准切段不改变维度锚点、周评区段、来源或锚点内容', async () => {
    await db().transaction((tx) =>
      backfillLegacyRuleVersionApplicability(tx, usages),
    );
    await db().insert(dimensions).values({
      id: 'demo-prof',
      name: '演示专业度',
      axis: 'prof',
      core: true,
    });
    await db().insert(anchors).values({
      id: 'demo-anchor',
      dimensionId: 'demo-prof',
      ruleVersionId: 'rubric-v1',
      value: 3,
      text: '演示：独立完成交付',
    });
    const before = {
      periods: await rows(),
      versions: await db().select().from(ruleVersions).orderBy(ruleVersions.id),
      anchors: await db().select().from(anchors),
    };
    await start();
    await switchTo(next());
    expect(
      (await rows()).filter((row) => row.category !== 'xe_selection'),
    ).toEqual(before.periods);
    expect(
      await db().select().from(ruleVersions).orderBy(ruleVersions.id),
    ).toEqual(before.versions);
    expect(await db().select().from(anchors)).toEqual(before.anchors);
    for (const category of ['dimension_anchors', 'xe_weekly'] as const)
      expect(
        await readEffectiveRuleVersion(db(), {
          category,
          at: t2.toISOString(),
        }),
      ).toHaveProperty('status', 'success');
  });
  it.each([
    { at: new Date('2025-12-31T00:00:00.000Z') },
    { expectedPeriodId: 'demo-old-period' },
    { expectedPeriodId: null },
    { newPeriodId: 'demo-period-1' },
    { versionId: 'xe-select-v99' },
    { versionId: 'rubric-v1' },
    { at: new Date(NaN) },
  ])('拒绝回拨/旧身份/重用ID/缺目录等冲突且不改历史：%j', async (change) => {
    await start();
    const before = await rows();
    await expect(switchTo(next(change))).rejects.toBeInstanceOf(
      RuleApplicabilityConflictError,
    );
    expect(await rows()).toEqual(before);
  });
  it('已有未来边界不能被截短改写', async () => {
    await db()
      .insert(ruleVersionApplicability)
      .values([
        {
          periodId: 'demo-period-1',
          versionId: 'xe-select-v1',
          category: 'xe_selection',
          effectiveFrom: t0,
          effectiveUntil: t2,
        },
        {
          periodId: 'demo-future',
          versionId: 'xe-select-v2',
          category: 'xe_selection',
          effectiveFrom: t2,
          effectiveUntil: null,
        },
      ]);
    const before = await rows();
    await expect(switchTo(next())).rejects.toBeInstanceOf(
      RuleApplicabilityConflictError,
    );
    expect(await rows()).toEqual(before);
  });
  it('已有历史重叠如实冲突，不仅检查当前时点后挑一个', async () => {
    await db()
      .insert(ruleVersionApplicability)
      .values([
        {
          periodId: 'demo-history',
          versionId: 'xe-select-v1',
          category: 'xe_selection',
          effectiveFrom: t0,
          effectiveUntil: t2,
        },
        {
          periodId: 'demo-period-1',
          versionId: 'xe-select-v2',
          category: 'xe_selection',
          effectiveFrom: t1,
          effectiveUntil: null,
        },
      ]);
    const before = await rows();
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: t2.toISOString(),
      }),
    ).toHaveProperty('status', 'success');
    await expect(switchTo(next({ at: t2 }))).rejects.toBeInstanceOf(
      RuleApplicabilityConflictError,
    );
    expect(await rows()).toEqual(before);
  });
  it('同版本的两个非空重叠段也返回conflict，不能按versionId去重掩盖', async () => {
    await db()
      .insert(ruleVersionApplicability)
      .values([
        {
          periodId: 'demo-period-1',
          versionId: 'xe-select-v1',
          category: 'xe_selection',
          effectiveFrom: t0,
          effectiveUntil: null,
        },
        {
          periodId: 'demo-overlap',
          versionId: 'xe-select-v1',
          category: 'xe_selection',
          effectiveFrom: t1,
          effectiveUntil: null,
        },
      ]);
    const before = await rows();
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: t2.toISOString(),
      }),
    ).toHaveProperty('status', 'conflict');
    await expect(switchTo(next({ at: t2 }))).rejects.toBeInstanceOf(
      RuleApplicabilityConflictError,
    );
    expect(await rows()).toEqual(before);
  });
  it('全局periodId碰到其他类别也冲突，原类别不受影响', async () => {
    await db().transaction((tx) =>
      backfillLegacyRuleVersionApplicability(tx, usages),
    );
    const before = await rows();
    await expect(
      switchTo(
        next({ expectedPeriodId: null, newPeriodId: 'legacy:rubric-v1' }),
      ),
    ).rejects.toBeInstanceOf(RuleApplicabilityConflictError);
    expect(await rows()).toEqual(before);
  });
  it('要求显式Transaction，不在每条自动提交语句间假装持锁', async () => {
    await expect(
      switchSelectionApplicability(db() as unknown as Transaction, next()),
    ).rejects.toThrow('explicit transaction');
    await expect(
      backfillLegacyRuleVersionApplicability(
        db() as unknown as Transaction,
        usages,
      ),
    ).rejects.toThrow('explicit transaction');
    expect(await rows()).toEqual([]);
  });
  it('切段后迟发失败回滚两个区段，并释放类别锁供后续事务重试', async () => {
    await start();
    const before = await rows();
    await expect(
      db().transaction(async (tx) => {
        await switchSelectionApplicability(tx, next());
        throw new Error('synthetic late audit failure');
      }),
    ).rejects.toThrow('synthetic late audit failure');
    expect(await rows()).toEqual(before);
    expect(await switchTo(next())).toMatchObject({
      periodId: 'demo-period-2',
      effectiveFrom: t1,
      effectiveUntil: null,
    });
  });
  it('真实并发两个旧period只接受一个，等待类别锁后重读再拒绝旧身份', async () => {
    await start();
    const locked = deferred<void>();
    const release = deferred<void>();
    const secondPid = deferred<number>();
    const first = db().transaction(async (tx) => {
      const result = await switchSelectionApplicability(tx, next());
      locked.resolve();
      await release.promise;
      return result;
    });
    await locked.promise;
    const second = db().transaction(async (tx) => {
      secondPid.resolve(await pid(tx));
      return switchSelectionApplicability(
        tx,
        next({ newPeriodId: 'demo-contender' }),
      );
    });
    try {
      await waitForCategoryLock(await secondPid.promise);
    } finally {
      release.resolve();
    }
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({
      status: 'fulfilled',
      value: { periodId: 'demo-period-2' },
    });
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: { code: 'conflict' },
    });
    expect((await rows()).map((row) => row.periodId)).toEqual([
      'demo-period-1',
      'demo-period-2',
    ]);
  }, 10_000);
  it('多个类别按稳定顺序取锁，逆序输入也不会死锁', async () => {
    const locked = deferred<void>();
    const release = deferred<void>();
    const secondPid = deferred<number>();
    const first = db().transaction(async (tx) => {
      await lockRuleCategory(tx, ['xe_weekly', 'dimension_anchors']);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const second = db().transaction(async (tx) => {
      secondPid.resolve(await pid(tx));
      await lockRuleCategory(tx, [
        'dimension_anchors',
        'xe_weekly',
        'dimension_anchors',
      ]);
    });
    try {
      await waitForCategoryLock(await secondPid.promise);
    } finally {
      release.resolve();
    }
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  }, 10_000);
  it('不同类别锁互不阻塞，选择标准事务不会占住legacy回填', async () => {
    const locked = deferred<void>();
    const release = deferred<void>();
    const selection = db().transaction(async (tx) => {
      await lockRuleCategory(tx, 'xe_selection');
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      const result = await db().transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '2s'`);
        return backfillLegacyRuleVersionApplicability(tx, usages);
      });
      expect(result.sort()).toEqual(['rubric-v1', 'xe-weekly-v1']);
    } finally {
      release.resolve();
      await selection;
    }
  });
  it('两次并发legacy回填锁后重查，仅生成两条固定起始区段', async () => {
    const locked = deferred<void>();
    const release = deferred<void>();
    const secondPid = deferred<number>();
    const first = db().transaction(async (tx) => {
      const result = await backfillLegacyRuleVersionApplicability(tx, usages);
      locked.resolve();
      await release.promise;
      return result;
    });
    await locked.promise;
    const second = db().transaction(async (tx) => {
      secondPid.resolve(await pid(tx));
      return backfillLegacyRuleVersionApplicability(tx, usages);
    });
    try {
      await waitForCategoryLock(await secondPid.promise);
    } finally {
      release.resolve();
    }
    const result = await Promise.all([first, second]);
    expect(result[0].sort()).toEqual(['rubric-v1', 'xe-weekly-v1']);
    expect(result[1]).toEqual([]);
    expect((await rows()).map((row) => row.periodId)).toEqual([
      'legacy:rubric-v1',
      'legacy:xe-weekly-v1',
    ]);
  }, 10_000);
  it('legacy缺一个验证日期时整个事务零写，不补服务器当前时间', async () => {
    await expect(
      db().transaction(async (tx) => {
        await tx.insert(dimensions).values({
          id: 'demo-before-backfill',
          name: '演示事务前项',
          axis: 'prof',
          core: true,
        });
        return backfillLegacyRuleVersionApplicability(tx, usages.slice(0, 1));
      }),
    ).rejects.toThrow('xe-weekly-v1');
    expect(await rows()).toEqual([]);
    expect(await db().select().from(dimensions)).toEqual([]);
  });
  it('已知legacy存在多段历史时重跑不扩旧终点或改来源', async () => {
    await db()
      .insert(ruleVersionApplicability)
      .values([
        {
          periodId: 'legacy:rubric-v1',
          versionId: 'rubric-v1',
          category: 'dimension_anchors',
          effectiveFrom: t0,
          effectiveUntil: t1,
        },
        {
          periodId: 'demo-rubric-restored',
          versionId: 'rubric-v1',
          category: 'dimension_anchors',
          effectiveFrom: t2,
          effectiveUntil: null,
        },
        {
          periodId: 'legacy:xe-weekly-v1',
          versionId: 'xe-weekly-v1',
          category: 'xe_weekly',
          effectiveFrom: t1,
          effectiveUntil: t2,
        },
      ]);
    const before = await rows();
    const catalog = await db()
      .select()
      .from(ruleVersions)
      .orderBy(ruleVersions.id);
    expect(
      await db().transaction((tx) =>
        backfillLegacyRuleVersionApplicability(tx, []),
      ),
    ).toEqual([]);
    expect(await rows()).toEqual(before);
    expect(
      await db().select().from(ruleVersions).orderBy(ruleVersions.id),
    ).toEqual(catalog);
  });
});
