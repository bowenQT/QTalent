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
import { eq, sql } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import { cohorts } from '../modules/programs';
import {
  ruleVersions,
  ruleVersionApplicability,
} from '../modules/evaluation-system/schema';
import {
  selectionCategoryHeads,
  selectionVersionContents,
  selectionCohortBindings,
  selectionPublications,
} from '../modules/evaluation-system/selection/schema';
import { readCurrentSelectionStandard } from '../modules/evaluation-system/selection/postgres';
import { readEffectiveRuleVersion } from '../modules/evaluation-system/effective-version';
import { lockRuleCategory } from '../modules/evaluation-system/applicability';
import * as audit from '../platform/audit';
import { auditEvents } from '../platform/audit/schema';
import {
  initializeReviewedSelectionBaseline,
  bindExistingSelectionCohort,
  createSelectionCohort,
  readNativeSelectionCohortVersion,
} from './selection-standard-native';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName = `qtalent_native_selection_${randomUUID().replaceAll('-', '')}_test`;
const db = () => {
  if (!connection) throw new Error('Real PG required');
  return connection.db;
};
const now = '2026-10-31T10:00:00.000Z';
const clock = () => new Date(now);
const input = {
  versionId: 'xe-select-v1',
  periodId: 'demo-native-period',
  effectiveFrom: '2026-07-01T00:00:00.000Z',
  nextVersionOrdinal: 2,
  sourceCommit: '1'.repeat(40),
  sourceReference: 'synthetic:reviewed-baseline',
  content: {
    reviewPoints: [
      {
        id: 'demo-point',
        title: '作品来源',
        description: '演示：保留原文来源',
      },
    ],
  },
};
const initialize = () =>
  initializeReviewedSelectionBaseline(db(), 'manager', input, clock);
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no fake/skip');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Loopback _test required');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW_918_TEST_MIGRATIONS_DIR ?? 'src/server/db/migrations',
  });
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  for (const id of ['manager', 'hr', 'admin']) {
    await db()
      .insert(people)
      .values({ id, name: `${id}（演示）`, organizationId: 'demo-org' });
    await db()
      .insert(accountBindings)
      .values({ accountId: id, personId: id, isSystemAdmin: id === 'admin' });
  }
  await db()
    .insert(grants)
    .values([
      {
        id: 'manager-grant',
        accountId: 'manager',
        role: 'manager',
        scope: 'company',
        validFrom: '2026-01-01',
      },
      {
        id: 'hr-grant',
        accountId: 'hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
    ]);
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await db().delete(selectionCohortBindings);
  await db().delete(selectionCategoryHeads);
  await db().delete(selectionVersionContents);
  await db().delete(ruleVersionApplicability);
  await db().delete(ruleVersions);
  await db().delete(cohorts);
  await db().delete(auditEvents);
  await db().update(grants).set({ revokedAt: null, validTo: null });
  await db()
    .insert(cohorts)
    .values([
      { id: 'demo-cohort', name: '第六期（演示）' },
      { id: 'other-cohort', name: '另一期（演示）' },
    ]);
});

describe('918 actual baseline/cohort assembly (synthetic facts, real PostgreSQL)', () => {
  it('atomically imports explicit snapshot facts and reads the real922 category/time; no invented publisher', async () => {
    const head = await initialize();
    expect(head).toMatchObject({
      versionId: 'xe-select-v1',
      currentRevisionId: null,
      currentPublicationId: null,
      generation: 1,
    });
    expect(await db().select().from(ruleVersions)).toEqual([
      {
        id: 'xe-select-v1',
        provenance: 'demo_import_snapshot',
        sourceCommit: input.sourceCommit,
      },
    ]);
    const effective = await readEffectiveRuleVersion(db(), {
      category: 'xe_selection',
      at: now,
    });
    expect(effective).toMatchObject({
      status: 'success',
      version: {
        versionId: 'xe-select-v1',
        effectiveFrom: input.effectiveFrom,
      },
    });
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: '2026-06-30T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'not_found' });
    expect(await db().select().from(selectionPublications)).toEqual([]);
    expect(await db().select().from(auditEvents)).toHaveLength(1);
  });
  it('concurrent identical initialization is idempotent, including audit', async () => {
    const heads = await Promise.all([initialize(), initialize()]);
    expect(heads[0]).toEqual(heads[1]);
    expect(await db().select().from(ruleVersionApplicability)).toHaveLength(1);
    expect(await db().select().from(selectionVersionContents)).toHaveLength(1);
    expect(await db().select().from(auditEvents)).toHaveLength(1);
  });
  it.each([
    { sourceCommit: '2'.repeat(40) },
    { effectiveFrom: '2026-06-01T00:00:00.000Z' },
    { periodId: 'different-period' },
    { sourceReference: 'synthetic:different-source' },
    {
      content: {
        reviewPoints: [
          { id: 'changed', title: '变化（演示）', description: '不是原基线' },
        ],
      },
    },
  ])(
    'rejects changed baseline facts without replacing history: %j',
    async (change) => {
      await initialize();
      await expect(
        initializeReviewedSelectionBaseline(
          db(),
          'manager',
          { ...input, ...change },
          clock,
        ),
      ).rejects.toThrow();
      expect(
        (await db().select().from(selectionVersionContents))[0]?.content,
      ).toEqual(input.content);
      expect(await db().select().from(auditEvents)).toHaveLength(1);
    },
  );
  it.each([undefined, 'invalid', '2027-01-01T00:00:00.000Z'])(
    'does not invent missing or future effectiveFrom: %s',
    async (effectiveFrom) => {
      await expect(
        initializeReviewedSelectionBaseline(
          db(),
          'manager',
          { ...input, effectiveFrom } as typeof input,
          clock,
        ),
      ).rejects.toThrow();
      expect(await db().select().from(ruleVersions)).toEqual([]);
    },
  );
  it.each(['hr', 'admin', 'missing'])(
    'requires a current business manager, not caller roles: %s',
    async (actor) => {
      await expect(
        initializeReviewedSelectionBaseline(db(), actor, input, clock),
      ).rejects.toThrow();
      expect(await db().select().from(ruleVersions)).toEqual([]);
    },
  );
  it('audit failure rolls back directory, period, content and head in the same transaction', async () => {
    vi.spyOn(audit, 'recordAudit').mockRejectedValueOnce(
      new Error('Synthetic audit boundary failure'),
    );
    await expect(initialize()).rejects.toThrow(
      'Selection persistence unavailable',
    );
    for (const table of [
      ruleVersions,
      ruleVersionApplicability,
      selectionVersionContents,
      selectionCategoryHeads,
    ])
      expect(await db().select().from(table)).toEqual([]);
  });
  it('after waiting for the category lock, re-reads actual revoked authorization', async () => {
    let release!: () => void;
    let locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = db().transaction(async (tx) => {
      await lockRuleCategory(tx, 'xe_selection');
      locked();
      await gate;
      await tx
        .update(grants)
        .set({ revokedAt: '2026-10-31' })
        .where(eq(grants.id, 'manager-grant'));
    });
    await held;
    const pending = initialize();
    const assertion = expect(pending).rejects.toThrow();
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const result = await db().execute(
          sql`select count(*)::integer as n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and wait_event='advisory'`,
        );
        if (Number(result.rows[0].n) > 0) {
          waiting = true;
          break;
        }
        await delay(10);
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await blocker;
    await assertion;
    expect(await db().select().from(ruleVersions)).toEqual([]);
  });
  it('binds an actual authorized cohort once and reads that saved version', async () => {
    await initialize();
    expect(
      await readNativeSelectionCohortVersion(db(), 'hr', 'demo-cohort', clock),
    ).toBeNull();
    const first = await bindExistingSelectionCohort(
      db(),
      'hr',
      'demo-cohort',
      clock,
    );
    expect(first).toMatchObject({
      cohort: { id: 'demo-cohort' },
      standardVersionId: 'xe-select-v1',
      boundAt: now,
    });
    expect(
      await bindExistingSelectionCohort(
        db(),
        'hr',
        'demo-cohort',
        () => new Date('2026-11-01T00:00:00.000Z'),
      ),
    ).toEqual(first);
    expect(
      await readNativeSelectionCohortVersion(
        db(),
        'manager',
        'demo-cohort',
        clock,
      ),
    ).toEqual(first);
    expect(await db().select().from(selectionCohortBindings)).toHaveLength(1);
    expect(await db().select().from(auditEvents)).toHaveLength(2);
  });
  it('does not disclose or bind other cohorts; rechecks revoked HR on later reads', async () => {
    await initialize();
    await expect(
      bindExistingSelectionCohort(db(), 'hr', 'other-cohort', clock),
    ).rejects.toThrow();
    await expect(
      readNativeSelectionCohortVersion(db(), 'hr', 'other-cohort', clock),
    ).rejects.toThrow();
    await bindExistingSelectionCohort(db(), 'hr', 'demo-cohort', clock);
    await db()
      .update(grants)
      .set({ validTo: '2026-10-30' })
      .where(eq(grants.id, 'hr-grant'));
    await expect(
      readNativeSelectionCohortVersion(db(), 'hr', 'demo-cohort', clock),
    ).rejects.toThrow();
  });
  it('missing cohort is not fabricated by adoption', async () => {
    await initialize();
    await expect(
      bindExistingSelectionCohort(db(), 'manager', 'missing', clock),
    ).rejects.toThrow();
    await expect(
      readNativeSelectionCohortVersion(db(), 'manager', 'missing', clock),
    ).rejects.toThrow();
    expect(await db().select().from(selectionCohortBindings)).toEqual([]);
  });
  it('creates a real new cohort and binding atomically; rejects a conflicting name', async () => {
    await initialize();
    const raw = { id: 'new-cohort', name: '第七期（演示）' };
    const binding = await createSelectionCohort(db(), 'manager', raw, clock);
    expect(binding.cohort).toEqual(raw);
    expect(await createSelectionCohort(db(), 'manager', raw, clock)).toEqual(
      binding,
    );
    await expect(
      createSelectionCohort(
        db(),
        'manager',
        { ...raw, name: '另一名称（演示）' },
        clock,
      ),
    ).rejects.toThrow();
    await expect(
      createSelectionCohort(
        db(),
        'hr',
        { id: 'hr-new', name: '无权限（演示）' },
        clock,
      ),
    ).rejects.toThrow();
  });
  it('rolls new cohort creation back when no effective baseline exists', async () => {
    await expect(
      createSelectionCohort(
        db(),
        'manager',
        { id: 'new-cohort', name: '第七期（演示）' },
        clock,
      ),
    ).rejects.toThrow();
    expect(
      await db().select().from(cohorts).where(eq(cohorts.id, 'new-cohort')),
    ).toEqual([]);
  });
  it('corrupt stored content fails closed rather than falling back to current/default', async () => {
    await initialize();
    await bindExistingSelectionCohort(db(), 'hr', 'demo-cohort', clock);
    await db()
      .update(selectionVersionContents)
      .set({ content: { invalid: true } as unknown as typeof input.content });
    await expect(
      readNativeSelectionCohortVersion(db(), 'hr', 'demo-cohort', clock),
    ).rejects.toThrow();
  });
  it('does not relabel an existing published directory as an imported snapshot', async () => {
    await db()
      .insert(ruleVersions)
      .values({ id: input.versionId, provenance: 'published' });
    await expect(initialize()).rejects.toThrow();
    expect(await db().select().from(ruleVersionApplicability)).toEqual([]);
    expect((await db().select().from(ruleVersions))[0]?.provenance).toBe(
      'published',
    );
  });
  it('orphan baseline content cannot be adopted into a fabricated head', async () => {
    await initialize();
    await db().delete(selectionCategoryHeads);
    await expect(initialize()).rejects.toThrow();
    expect(await db().select().from(selectionCategoryHeads)).toEqual([]);
  });
  it('closed applicability is not reopened by replay', async () => {
    await initialize();
    await db()
      .update(ruleVersionApplicability)
      .set({ effectiveUntil: new Date(now) });
    await expect(initialize()).rejects.toThrow();
    await expect(
      bindExistingSelectionCohort(db(), 'hr', 'demo-cohort', clock),
    ).rejects.toThrow();
    expect(await db().select().from(selectionCohortBindings)).toEqual([]);
  });
  it('a category head pointing to a different actual period is not used for adoption', async () => {
    await initialize();
    await db()
      .insert(ruleVersions)
      .values({ id: 'rubric-v1', provenance: 'published' });
    await db()
      .insert(ruleVersionApplicability)
      .values({
        periodId: 'demo-rubric-period',
        versionId: 'rubric-v1',
        category: 'dimension_anchors',
        effectiveFrom: new Date(input.effectiveFrom),
      });
    await db()
      .update(selectionCategoryHeads)
      .set({ currentPeriodId: 'demo-rubric-period' });
    await expect(
      bindExistingSelectionCohort(db(), 'manager', 'demo-cohort', clock),
    ).rejects.toThrow();
    expect(await db().select().from(selectionCohortBindings)).toEqual([]);
  });
  it('late binding audit failure rolls back both new cohort and binding without leaking SQL', async () => {
    await initialize();
    vi.spyOn(audit, 'recordAudit').mockRejectedValueOnce(
      new Error('Synthetic SQL params must not escape'),
    );
    await expect(
      createSelectionCohort(
        db(),
        'manager',
        { id: 'new-cohort', name: '第七期（演示）' },
        clock,
      ),
    ).rejects.toThrow('Selection persistence unavailable');
    expect(
      await db().select().from(cohorts).where(eq(cohorts.id, 'new-cohort')),
    ).toEqual([]);
    expect(await db().select().from(selectionCohortBindings)).toEqual([]);
  });
  it('the native constraint rejects a different cohort identity and preserves the original binding', async () => {
    await initialize();
    const binding = await bindExistingSelectionCohort(
      db(),
      'manager',
      'demo-cohort',
      clock,
    );
    await expect(
      db()
        .update(selectionCohortBindings)
        .set({
          binding: {
            ...binding,
            cohort: { id: 'other-cohort', name: '另一期（演示）' },
          },
        }),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'selection_binding_snapshot' },
    });
    expect(
      await readNativeSelectionCohortVersion(
        db(),
        'manager',
        'demo-cohort',
        clock,
      ),
    ).toEqual(binding);
  });
  it('default server clock supplies adoption time independently of historical baseline effectiveFrom', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    try {
      await initializeReviewedSelectionBaseline(db(), 'manager', input);
      const old = await bindExistingSelectionCohort(
        db(),
        'manager',
        'demo-cohort',
      );
      const fresh = await createSelectionCohort(db(), 'manager', {
        id: 'clock-cohort',
        name: '服务器时钟期次（演示）',
      });
      expect(old.boundAt).toBe(now);
      expect(fresh.boundAt).toBe(now);
      expect(
        await readNativeSelectionCohortVersion(db(), 'manager', 'clock-cohort'),
      ).toEqual(fresh);
      expect(
        (
          await db().select().from(ruleVersionApplicability)
        )[0]?.effectiveFrom.toISOString(),
      ).toBe(input.effectiveFrom);
    } finally {
      vi.useRealTimers();
    }
  });
  it('921 receives actual current922 metadata and immutable918 content, never a requested old-version fallback', async () => {
    expect(
      await db().transaction((tx) =>
        readCurrentSelectionStandard(tx, 'xe-select-v1', clock),
      ),
    ).toBeNull();
    await initialize();
    const value = await db().transaction((tx) =>
      readCurrentSelectionStandard(tx, 'xe-select-v1', clock),
    );
    expect(value?.content).toEqual(input.content);
    expect(value?.version).toMatchObject({
      versionId: input.versionId,
      provenance: 'demo_import_snapshot',
      effectiveFrom: input.effectiveFrom,
    });
    expect(
      await db().transaction((tx) =>
        readCurrentSelectionStandard(tx, 'xe-select-v2', clock),
      ),
    ).toBeNull();
    await db().delete(selectionCategoryHeads);
    await expect(
      db().transaction((tx) =>
        readCurrentSelectionStandard(tx, 'xe-select-v1', clock),
      ),
    ).rejects.toThrow('Selection persistence unavailable');
  });
});
