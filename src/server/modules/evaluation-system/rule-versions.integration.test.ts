import { randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client';
import { effectiveRuleVersionReadResultSchema } from '../../../contracts/selection-standard';
import {
  anchors,
  dimensions,
  ruleVersionApplicability,
  ruleVersions,
} from './schema';
import { readEffectiveRuleVersion } from './effective-version';
import { backfillLegacyRuleVersionApplicability } from './legacy-applicability';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_rule_versions_${randomUUID().replaceAll('-', '')}_test`;
const january = new Date('2026-01-01T00:00:00Z');
const october = new Date('2026-10-01T00:00:00Z');
const now = () => new Date('2026-10-31T00:00:00Z');
const db = () => {
  if (!connection)
    throw new Error('Real PostgreSQL fixture is not initialized');
  return connection.db;
};
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'Real PostgreSQL integration requires TEST_DATABASE_URL; no skip or fake fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  ) {
    throw new Error('Integration database must be loopback and end _test');
  }
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  // The override permits an isolated Drizzle-generated temporary migration while
  // X1's serial migration is pending. CI uses the committed migration directory.
  await migrate(connection.db, {
    migrationsFolder:
      process.env.BOW_922_TEST_MIGRATIONS_DIR ?? 'src/server/db/migrations',
  });
}, 30_000);
beforeEach(async () => {
  await db().delete(ruleVersionApplicability);
  await db().delete(anchors);
  await db().delete(dimensions);
  await db().delete(ruleVersions);
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
async function addVersion(
  versionId: string,
  category: 'dimension_anchors' | 'xe_selection' | 'xe_weekly',
  from = january,
  until: Date | null = null,
) {
  await db()
    .insert(ruleVersions)
    .values({ id: versionId, provenance: 'published' });
  await db()
    .insert(ruleVersionApplicability)
    .values({
      periodId: `test:${versionId}`,
      versionId,
      category,
      effectiveFrom: from,
      effectiveUntil: until,
    });
}

describe('真实 PostgreSQL 按类别及时间点取版', () => {
  it('两个类别都已发布时，整理仍取维度锚点版本及其锚点', async () => {
    await addVersion('rubric-v1', 'dimension_anchors');
    await addVersion('xe-select-v1', 'xe_selection');
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
      text: '演示：独立完成明确范围的交付',
    });
    const rubric = effectiveRuleVersionReadResultSchema.parse(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        now,
      ),
    );
    expect(rubric).toEqual({
      status: 'success',
      version: {
        category: 'dimension_anchors',
        versionId: 'rubric-v1',
        provenance: 'published',
        effectiveFrom: january.toISOString(),
        effectiveUntil: null,
      },
    });
    if (rubric.status !== 'success') throw new Error('expected rubric version');
    const selectedAnchors = await db()
      .select()
      .from(anchors)
      .where(eq(anchors.ruleVersionId, rubric.version.versionId));
    expect(selectedAnchors.map((anchor) => anchor.id)).toEqual(['demo-anchor']);
    expect(
      await readEffectiveRuleVersion(db(), { category: 'xe_selection' }, now),
    ).toMatchObject({
      status: 'success',
      version: { versionId: 'xe-select-v1' },
    });
  });
  it.each([
    ['2026-09-30T23:59:59.999Z', 'rubric-v1'],
    ['2026-10-01T00:00:00Z', 'rubric-v2'],
    ['2026-10-31T00:00:00Z', 'rubric-v2'],
  ])('生效区间左闭右开：%s → %s', async (at, expectedId) => {
    await addVersion('rubric-v1', 'dimension_anchors', january, october);
    await addVersion('rubric-v2', 'dimension_anchors', october);
    await addVersion('xe-select-v1', 'xe_selection');
    const clock = vi.fn(() => {
      throw new Error('Explicit time must not use wall clock');
    });
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors', at },
        clock,
      ),
    ).toMatchObject({ status: 'success', version: { versionId: expectedId } });
    expect(clock).not.toHaveBeenCalled();
  });
  it('当前读取只取一次注入的服务端时间', async () => {
    await addVersion('rubric-v1', 'dimension_anchors');
    const clock = vi.fn(now);
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        clock,
      ),
    ).toMatchObject({ status: 'success' });
    expect(clock).toHaveBeenCalledOnce();
  });
  it('不存在的类别/尚未生效的时间如实 not_found，不退回全表首个版本', async () => {
    await addVersion('xe-select-v1', 'xe_selection', october);
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        now,
      ),
    ).toMatchObject({ status: 'not_found' });
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: '2026-09-30T00:00:00Z',
      }),
    ).toMatchObject({ status: 'not_found' });
  });
  it('同类别时间重叠返回 conflict，不按 id、时间或锚点数量猜一个', async () => {
    await addVersion('rubric-v1', 'dimension_anchors');
    await addVersion('rubric-v2', 'dimension_anchors', october);
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        now,
      ),
    ).toMatchObject({ status: 'conflict' });
  });
  it('没有 applicability 的旧行保留原样，不伪造生效版本', async () => {
    await db()
      .insert(ruleVersions)
      .values({ id: 'rubric-v1', provenance: 'published' });
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        now,
      ),
    ).toMatchObject({ status: 'not_found' });
    expect(await db().select().from(ruleVersionApplicability)).toEqual([]);
  });
  it('拒绝无效请求时间与无效服务端时钟', async () => {
    await expect(
      readEffectiveRuleVersion(db(), {
        category: 'dimension_anchors',
        at: 'invalid',
      }),
    ).rejects.toThrow();
    await expect(
      readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        () => new Date('invalid'),
      ),
    ).rejects.toThrow('Invalid rule version clock');
  });
});

describe('旧版分类与证据起点的真实回填', () => {
  async function oldVersions() {
    await db()
      .insert(ruleVersions)
      .values([
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
        { id: 'unrecognized-existing-version', provenance: 'published' },
      ]);
  }
  const usages = () => [
    { ruleVersionId: 'rubric-v1', usedAt: new Date('2026-07-10T00:00:00Z') },
    { ruleVersionId: 'rubric-v1', usedAt: new Date('2026-07-01T00:00:00Z') },
    { ruleVersionId: 'xe-weekly-v1', usedAt: new Date('2026-08-02T00:00:00Z') },
  ];
  it('两种旧版各自分类，provenance/sourceCommit 不变，未知版本不乱归类', async () => {
    await oldVersions();
    const before = await db()
      .select()
      .from(ruleVersions)
      .orderBy(ruleVersions.id);
    expect(
      (
        await db().transaction((tx) =>
          backfillLegacyRuleVersionApplicability(tx, usages()),
        )
      ).sort(),
    ).toEqual(['rubric-v1', 'xe-weekly-v1']);
    expect(
      await db().select().from(ruleVersions).orderBy(ruleVersions.id),
    ).toEqual(before);
    expect(
      await readEffectiveRuleVersion(
        db(),
        { category: 'dimension_anchors' },
        now,
      ),
    ).toMatchObject({
      status: 'success',
      version: {
        versionId: 'rubric-v1',
        provenance: 'demo_import_snapshot',
        effectiveFrom: '2026-07-01T00:00:00.000Z',
      },
    });
    expect(
      await readEffectiveRuleVersion(db(), { category: 'xe_weekly' }, now),
    ).toMatchObject({
      status: 'success',
      version: {
        versionId: 'xe-weekly-v1',
        provenance: 'demo_import_snapshot',
        effectiveFrom: '2026-08-02T00:00:00.000Z',
      },
    });
    expect(await db().select().from(ruleVersionApplicability)).toHaveLength(2);
  });
  it('缺一个旧版的使用时间时整体不写，不拿当前导入时间代替', async () => {
    await oldVersions();
    await expect(
      db().transaction((tx) =>
        backfillLegacyRuleVersionApplicability(tx, usages().slice(0, 2)),
      ),
    ).rejects.toThrow('xe-weekly-v1');
    expect(await db().select().from(ruleVersionApplicability)).toEqual([]);
  });
  it('可重跑，不覆盖已有起止边界，也不要求为已回填行重新提供证据', async () => {
    await oldVersions();
    await db().transaction((tx) =>
      backfillLegacyRuleVersionApplicability(tx, usages()),
    );
    await db()
      .update(ruleVersionApplicability)
      .set({ effectiveUntil: october })
      .where(eq(ruleVersionApplicability.versionId, 'rubric-v1'));
    expect(
      await db().transaction((tx) =>
        backfillLegacyRuleVersionApplicability(tx, []),
      ),
    ).toEqual([]);
    const row = await db()
      .select()
      .from(ruleVersionApplicability)
      .where(eq(ruleVersionApplicability.versionId, 'rubric-v1'));
    expect(row[0].effectiveFrom.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(row[0].effectiveUntil?.toISOString()).toBe(october.toISOString());
  });
});

describe('applicability 的数据库约束', () => {
  beforeEach(async () => {
    await db()
      .insert(ruleVersions)
      .values({ id: 'rubric-v1', provenance: 'published' });
  });
  it('规则生效元数据必须引用实际存在的规则版本', async () => {
    await expect(
      db().insert(ruleVersionApplicability).values({
        periodId: 'test:missing-select',
        versionId: 'xe-select-v1',
        category: 'xe_selection',
        effectiveFrom: january,
      }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
  it('同一个periodId只允许一份区段，versionId不再作主键', async () => {
    const value = {
      periodId: 'test:rubric',
      versionId: 'rubric-v1',
      category: 'dimension_anchors' as const,
      effectiveFrom: january,
    };
    await db().insert(ruleVersionApplicability).values(value);
    await expect(
      db().insert(ruleVersionApplicability).values(value),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });
  it('不能把维度锚点标成周评或选拔，也不能写不存在的类别', async () => {
    await expect(
      db().insert(ruleVersionApplicability).values({
        periodId: 'test:rubric',
        versionId: 'rubric-v1',
        category: 'xe_weekly',
        effectiveFrom: january,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: '23514',
        constraint: 'evaluation_rule_applicability_version_category',
      },
    });
    await expect(
      db().execute(
        sql`insert into ${ruleVersionApplicability} (period_id, version_id, category, effective_from) values ('test:raw', 'rubric-v1', 'published', '2026-01-01T00:00:00Z')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });
  it.each([new Date('2025-12-31T00:00:00Z')])(
    '结束时间 %s 不得早于起点',
    async (until) => {
      await expect(
        db().insert(ruleVersionApplicability).values({
          periodId: 'test:rubric',
          versionId: 'rubric-v1',
          category: 'dimension_anchors',
          effectiveFrom: january,
          effectiveUntil: until,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: '23514',
          constraint: 'evaluation_rule_applicability_window',
        },
      });
    },
  );
  it('同毫秒空段允许留存，但公开读取不能返回它', async () => {
    const period = {
      periodId: 'test:empty',
      versionId: 'rubric-v1',
      category: 'dimension_anchors' as const,
      effectiveFrom: january,
      effectiveUntil: january,
    };
    await db().insert(ruleVersionApplicability).values(period);
    expect(await db().select().from(ruleVersionApplicability)).toEqual([
      period,
    ]);
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'dimension_anchors',
        at: january.toISOString(),
      }),
    ).toHaveProperty('status', 'not_found');
  });
  it('拒绝 Infinity，避免序列化成伪造的 ISO 时间', async () => {
    await expect(
      db().execute(
        sql`insert into ${ruleVersionApplicability} (period_id, version_id, category, effective_from) values ('test:raw', 'rubric-v1', 'dimension_anchors', 'infinity')`,
      ),
    ).rejects.toMatchObject({
      cause: {
        code: '23514',
        constraint: 'evaluation_rule_applicability_window',
      },
    });
  });
});
