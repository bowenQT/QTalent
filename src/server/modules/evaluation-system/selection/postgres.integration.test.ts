import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
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
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, type Transaction } from '../../../db/client';
import { importDemo } from '../../../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../../../db/seed';
import { loadProjectContext } from '../../../usecases/project-context';
import {
  executeSelectionRevision,
  readSelectionCohortVersion,
} from '../../../usecases/selection-standard';
import { cohorts } from '../../programs';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../directory';
import { auditEvents } from '../../../platform/audit/schema';
import { ruleVersions, ruleVersionApplicability } from '../schema';
import { lockRuleCategory } from '../applicability';
import { readEffectiveRuleVersion } from '../effective-version';
import {
  selectionRevisionSchema,
  selectionPublicationReceiptSchema,
} from '../../../../contracts/selection-standard';
import {
  comparisonManagerFixture,
  selectionRevisionFixture,
  selectionImpactPreviewFixture,
  iterationDemoHr,
  iterationDemoManager,
  iterationDemoCohort,
  iterationDemoNextCohort,
} from '../../../../contracts/standard-iteration.fixtures';
import {
  createSelectionPostgresStore,
  initializeSelectionBaseline,
  SelectionPersistenceUnavailableError,
  type SelectionPostgresServices,
} from './postgres';
import {
  selectionRevisions,
  selectionVersionContents,
  selectionPublications,
  selectionCategoryHeads,
  selectionCohortBindings,
  selectionOperations,
} from './schema';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName = `qtalent_selection_${randomUUID().replaceAll('-', '')}_test`;
const db = () => {
  if (!connection) throw new Error('Real PG fixture not initialized');
  return connection.db;
};
const now = '2026-10-31T10:00:00.000Z';
const baselineAt = new Date('2026-07-01T00:00:00.000Z');
const hr = 'selection-demo-hr-account';
const manager = 'selection-demo-manager-account';
const otherManager = 'selection-demo-manager-two';
const eighth = { id: 'selection-demo-xe8', name: '第八期（演示）' };
const baselineContent = {
  reviewPoints: [
    { id: 'demo-basic', title: '作品来源', description: '演示：保留原始出处' },
  ],
};
const initial = {
  versionId: 'xe-select-v1',
  existingPeriodId: 'selection-demo-baseline',
  content: baselineContent,
  sourceReference: 'synthetic:selection-baseline-v1',
  nextVersionOrdinal: 2,
};
let clock = vi.fn(() => new Date(now));
let nextCohort = iterationDemoNextCohort;
let services: SelectionPostgresServices;
let store: ReturnType<typeof createSelectionPostgresStore>;

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
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = `/${databaseName}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder:
      process.env.BOW_918_TEST_MIGRATIONS_DIR ?? 'src/server/db/migrations',
  });
  // Real existing baseline data, all pinned pseudonyms. This is not a production
  // initialization of selection v1: the separate content below is authored test data.
  await importDemo(
    db(),
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'Synthetic-test-password-only',
  );
  await db()
    .insert(cohorts)
    .values([iterationDemoCohort, iterationDemoNextCohort, eighth]);
  await db()
    .insert(organizations)
    .values({ id: 'selection-demo-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values([
      {
        id: iterationDemoHr.id,
        name: iterationDemoHr.name,
        organizationId: 'selection-demo-org',
      },
      {
        id: iterationDemoManager.id,
        name: iterationDemoManager.name,
        organizationId: 'selection-demo-org',
      },
      {
        id: 'selection-demo-manager-two-person',
        name: '另一位管理者（演示）',
        organizationId: 'selection-demo-org',
      },
    ]);
  await db()
    .insert(accountBindings)
    .values([
      { accountId: hr, personId: iterationDemoHr.id },
      { accountId: manager, personId: iterationDemoManager.id },
      {
        accountId: otherManager,
        personId: 'selection-demo-manager-two-person',
      },
    ]);
  await db()
    .insert(grants)
    .values([
      ...[iterationDemoCohort.id, iterationDemoNextCohort.id, eighth.id].map(
        (cohortId) => ({
          id: 'selection-demo-hr-' + cohortId,
          accountId: hr,
          role: 'hr' as const,
          scope: 'cohort' as const,
          cohortId,
          validFrom: '2026-01-01',
        }),
      ),
      ...[manager, otherManager].map((accountId) => ({
        id: 'selection-demo-grant-' + accountId,
        accountId,
        role: 'manager' as const,
        scope: 'company' as const,
        validFrom: '2026-01-01',
      })),
    ]);
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

/** Fixture-only attribution/impact readers: native persistence and current grants
 * really use PG; this does not establish 919/921's production fact queries.
 */
function readers(): SelectionPostgresServices {
  async function impact(tx: Transaction, ids?: string[]) {
    const saved = await tx.select().from(selectionCohortBindings);
    return {
      nextCohort,
      existingResults: selectionImpactPreviewFixture().existingResults,
      preservedBindings: saved
        .filter((row) => ids === undefined || ids.includes(row.cohortId))
        .map((row) => row.binding),
    };
  }
  return {
    loadAuthority: vi.fn(async (tx, accountId, at) => {
      const current = await loadProjectContext(tx, accountId, at);
      const actor = current.directory.people.find(
        (person) => person.id === current.context.account.personId,
      );
      if (!actor) throw new Error('Synthetic actor is missing');
      return {
        context: current.context,
        actor: { id: actor.id, name: actor.name },
      };
    }),
    creationFacts: async (tx, _authority, input) => {
      void _authority;
      // A separately authored synthetic comparison per base version, not a
      // rewrite of prior batch facts and not expected-output data from 923.
      const basis = structuredClone(selectionRevisionFixture().basis);
      basis.id = input.attributionId;
      basis.batchId = 'selection-demo-comparison-' + input.baseVersionId;
      const managerBasis = structuredClone(comparisonManagerFixture().batches);
      for (const row of managerBasis) {
        row.batch.id = basis.batchId;
        row.batch.selectionStandardVersionId = input.baseVersionId;
      }
      return {
        scopeCohortId: iterationDemoCohort.id,
        basis,
        managerBasis,
        impact: await impact(tx),
      };
    },
    readImpact: async (tx, _authority, record) => {
      void _authority;
      const saved = record.revision.impactPreview;
      return impact(tx, [
        record.scopeCohortId,
        saved.nextCohort.id,
        ...saved.existingResults.map((row) => row.cohortId),
        ...saved.preservedBindings.map((row) => row.cohort.id),
      ]);
    },
    readCohort: async (tx, _authority, id) => {
      void _authority;
      return (
        (await tx.select().from(cohorts).where(eq(cohorts.id, id)))[0] ?? null
      );
    },
  };
}
beforeEach(async () => {
  await db().delete(selectionOperations);
  await db().delete(selectionCohortBindings);
  await db().delete(selectionCategoryHeads);
  await db().delete(selectionPublications);
  await db().delete(selectionRevisions);
  await db().delete(selectionVersionContents);
  await db()
    .delete(ruleVersionApplicability)
    .where(eq(ruleVersionApplicability.category, 'xe_selection'));
  await db()
    .delete(ruleVersions)
    .where(sql`${ruleVersions.id} like 'xe-select-v%'`);
  await db()
    .delete(auditEvents)
    .where(sql`${auditEvents.action} like 'selection_standard.%'`);
  await db()
    .update(grants)
    .set({ revokedAt: null })
    .where(sql`${grants.id} like 'selection-demo-%'`);
  await db().insert(cohorts).values(eighth).onConflictDoNothing();
  await db()
    .insert(ruleVersions)
    .values({ id: initial.versionId, provenance: 'published' });
  await db().insert(ruleVersionApplicability).values({
    periodId: initial.existingPeriodId,
    versionId: initial.versionId,
    category: 'xe_selection',
    effectiveFrom: baselineAt,
  });
  clock = vi.fn(() => new Date(now));
  nextCohort = iterationDemoNextCohort;
  await initializeSelectionBaseline(db(), initial, clock);
  services = readers();
  store = createSelectionPostgresStore(db(), services);
  await store.ports.transact(
    {
      category: 'xe_selection',
      accountId: manager,
      operationId: 'selection-demo-bind-six',
    },
    (tx) => store.bindCohort(tx, manager, iterationDemoCohort.id, clock),
  );
});
const execute = (accountId: string, action: string, input: unknown) =>
  executeSelectionRevision(store.ports, accountId, { action, input }, clock);
async function pending(key = 'one', baseVersionId = 'xe-select-v1') {
  const created = await execute(hr, 'create', {
    operationId: key + ':create',
    baseVersionId,
    attributionId: 'selection-demo-attribution-' + baseVersionId,
    expectedAttributionRevision: 1,
    reason: '演示：补齐贡献核验',
  });
  if (created.status !== 'success')
    throw new Error('Synthetic creation failed: ' + created.status);
  let record = selectionRevisionSchema.parse(created.result);
  const saved = await execute(hr, 'save', {
    operationId: key + ':save',
    draftId: record.id,
    expectedRevision: record.revision,
    reason: '演示：补齐贡献核验',
    changes: [
      {
        kind: 'add',
        after: {
          id: 'selection-demo-added-' + key,
          title: '贡献核验',
          description: '演示：保留可追溯来源',
        },
      },
    ],
  });
  if (saved.status !== 'success')
    throw new Error('Synthetic save failed: ' + saved.status);
  record = selectionRevisionSchema.parse(saved.result);
  const submitted = await execute(hr, 'submit', {
    operationId: key + ':submit',
    draftId: record.id,
    expectedRevision: record.revision,
    expectedPreviewId: record.impactPreview.id,
  });
  if (submitted.status !== 'success')
    throw new Error('Synthetic submit failed: ' + submitted.status);
  return selectionRevisionSchema.parse(submitted.result);
}
function publishInput(
  record: ReturnType<typeof selectionRevisionSchema.parse>,
  key = 'publish',
) {
  return {
    operationId: key,
    draftId: record.id,
    expectedRevision: record.revision,
    expectedPreviewId: record.impactPreview.id,
  };
}
async function publication(key = 'one', baseVersionId = 'xe-select-v1') {
  const record = await pending(key, baseVersionId);
  const result = await execute(
    manager,
    'publish',
    publishInput(record, key + ':publish'),
  );
  if (result.status !== 'success')
    throw new Error('Synthetic publish failed: ' + result.status);
  return selectionPublicationReceiptSchema.parse(result.result);
}
const head = async () => (await db().select().from(selectionCategoryHeads))[0];
async function snapshot() {
  return {
    heads: await db().select().from(selectionCategoryHeads),
    revisions: await db()
      .select()
      .from(selectionRevisions)
      .orderBy(selectionRevisions.id),
    content: await db()
      .select()
      .from(selectionVersionContents)
      .orderBy(selectionVersionContents.versionId),
    publications: await db()
      .select()
      .from(selectionPublications)
      .orderBy(selectionPublications.id),
    periods: await db()
      .select()
      .from(ruleVersionApplicability)
      .orderBy(ruleVersionApplicability.periodId),
    versions: await db().select().from(ruleVersions).orderBy(ruleVersions.id),
    operations: await db()
      .select()
      .from(selectionOperations)
      .orderBy(
        selectionOperations.actorAccountId,
        selectionOperations.operationId,
      ),
    audits: await db()
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.action} like 'selection_standard.%'`)
      .orderBy(auditEvents.id),
    bindings: await db()
      .select()
      .from(selectionCohortBindings)
      .orderBy(selectionCohortBindings.cohortId),
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waitForCategoryWaiter() {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await db().execute(
      sql`select count(*)::integer as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and wait_event = 'advisory'`,
    );
    if (Number(value.rows[0].n) > 0) return;
    await delay(10);
  }
  throw new Error('Real category lock waiter not observed');
}

describe('918 原生事务持久适配（真实PG）', () => {
  it('起草仅预留versionId，发布才写不可变目录/内容并原子记录审计和ledger', async () => {
    const record = await pending();
    expect(record.versionId).toBe('xe-select-v2');
    expect(
      await db()
        .select()
        .from(ruleVersions)
        .where(eq(ruleVersions.id, record.versionId)),
    ).toEqual([]);
    const result = await execute(manager, 'publish', publishInput(record));
    expect(result.status).toBe('success');
    expect(await head()).toMatchObject({
      versionId: record.versionId,
      currentRevisionId: record.id,
      generation: 2,
    });
    expect(await db().select().from(selectionPublications)).toHaveLength(1);
    expect(await db().select().from(selectionOperations)).toHaveLength(4);
    expect(
      (await db().select().from(selectionOperations)).every(
        (row) => row.actorPersonId.length > 0,
      ),
    ).toBe(true);
    expect((await db().select().from(selectionRevisions))[0]).toMatchObject({
      state: 'active',
      contentWasPublished: true,
    });
  });
  it('真实并发两个管理者发布，只有一个成功和一条发布记录', async () => {
    const record = await pending();
    const input = publishInput(record);
    const outcomes = await Promise.all([
      execute(manager, 'publish', input),
      execute(otherManager, 'publish', {
        ...input,
        operationId: 'other:publish',
      }),
    ]);
    expect(outcomes.map((row) => row.status).sort()).toEqual([
      'conflict',
      'success',
    ]);
    expect(await db().select().from(selectionPublications)).toHaveLength(1);
    expect((await head()).generation).toBe(2);
  });
  it('相同操作键并发重放只提交一次，不重复发布/审计/版本分配', async () => {
    const record = await pending();
    const input = publishInput(record);
    const outcomes = await Promise.all([
      execute(manager, 'publish', input),
      execute(manager, 'publish', input),
    ]);
    expect(outcomes.every((row) => row.status === 'success')).toBe(true);
    expect(
      outcomes.map((row) => row.status === 'success' && row.replayed).sort(),
    ).toEqual([false, true]);
    expect(await db().select().from(selectionPublications)).toHaveLength(1);
    expect(await db().select().from(selectionOperations)).toHaveLength(4);
  });
  it('等待类别锁期间撤权后，锁后加载的权限拒绝发布且未写回执', async () => {
    const record = await pending();
    const locked = deferred();
    const release = deferred();
    const holder = db().transaction(async (tx) => {
      await lockRuleCategory(tx, 'xe_selection');
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    clock.mockClear();
    vi.mocked(services.loadAuthority).mockClear();
    const request = execute(manager, 'publish', publishInput(record));
    try {
      await waitForCategoryWaiter();
      expect(clock).not.toHaveBeenCalled();
      expect(services.loadAuthority).not.toHaveBeenCalled();
      await db()
        .update(grants)
        .set({ revokedAt: '2026-10-31' })
        .where(eq(grants.id, 'selection-demo-grant-' + manager));
    } finally {
      release.resolve();
      await holder;
    }
    expect(await request).toMatchObject({ status: 'forbidden' });
    expect(await db().select().from(selectionPublications)).toEqual([]);
  }, 10_000);
  it.each(['audit', 'ledger'] as const)(
    '%s迟发失败令目录/内容/区段/两侧/审计/ledger全部回滚',
    async (point) => {
      const record = await pending();
      const before = await snapshot();
      const table =
        point === 'audit' ? 'audit_events' : 'evaluation_selection_operations';
      const predicate =
        point === 'audit'
          ? "NEW.action = 'selection_standard.publish'"
          : "NEW.action = 'publish'";
      await db().execute(
        sql.raw(
          `CREATE FUNCTION selection_demo_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END; $$`,
        ),
      );
      await db().execute(
        sql.raw(
          `CREATE TRIGGER selection_demo_reject BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION selection_demo_fail()`,
        ),
      );
      try {
        await expect(
          execute(manager, 'publish', publishInput(record)),
        ).rejects.toBeInstanceOf(SelectionPersistenceUnavailableError);
      } finally {
        await db().execute(
          sql.raw(`DROP TRIGGER selection_demo_reject ON ${table}`),
        );
        await db().execute(sql.raw('DROP FUNCTION selection_demo_fail()'));
      }
      expect(await snapshot()).toEqual(before);
    },
  );
  it('同毫秒发布/撤回保留空段，恢复新段且不回拨head身份', async () => {
    const receipt = await publication();
    expect(
      await execute(manager, 'undo', {
        operationId: 'undo',
        publicationId: receipt.publicationId,
        expectedRevision: receipt.revision,
      }),
    ).toMatchObject({ status: 'success' });
    expect(await head()).toMatchObject({
      versionId: 'xe-select-v1',
      currentPublicationId: null,
      currentRevisionId: null,
      generation: 3,
    });
    const periods = await db()
      .select()
      .from(ruleVersionApplicability)
      .where(eq(ruleVersionApplicability.category, 'xe_selection'));
    expect(periods).toHaveLength(3);
    expect(
      periods.find((row) => row.versionId === 'xe-select-v2'),
    ).toMatchObject({
      effectiveFrom: new Date(now),
      effectiveUntil: new Date(now),
    });
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'xe_selection',
        at: now,
      }),
    ).toMatchObject({
      status: 'success',
      version: { versionId: 'xe-select-v1', effectiveFrom: now },
    });
  });
  it('第六/七期持久绑定在重建store和撤销后不变，新建第八期同事务采用恢复版', async () => {
    const receipt = await publication();
    await store.ports.transact(
      {
        category: 'xe_selection',
        accountId: manager,
        operationId: 'bind-seven',
      },
      (tx) => store.bindCohort(tx, manager, iterationDemoNextCohort.id, clock),
    );
    expect(
      await execute(manager, 'undo', {
        operationId: 'undo',
        publicationId: receipt.publicationId,
        expectedRevision: receipt.revision,
      }),
    ).toMatchObject({ status: 'success' });
    store = createSelectionPostgresStore(db(), services);
    for (const [cohortId, version] of [
      [iterationDemoCohort.id, 'xe-select-v1'],
      [iterationDemoNextCohort.id, 'xe-select-v2'],
    ] as const)
      expect(
        await readSelectionCohortVersion(
          store.ports,
          manager,
          { cohortId },
          clock,
        ),
      ).toMatchObject({
        status: 'success',
        binding: { standardVersionId: version },
      });
    await db().delete(cohorts).where(eq(cohorts.id, eighth.id));
    const bound = await store.ports.transact(
      {
        category: 'xe_selection',
        accountId: manager,
        operationId: 'create-eight',
      },
      async (tx) => {
        await tx.db.insert(cohorts).values(eighth); // category lock is already held before creation
        return store.bindCohort(tx, manager, eighth.id, clock);
      },
    );
    expect(bound.standardVersionId).toBe('xe-select-v1');
    const before = await snapshot();
    expect(
      await store.ports.transact(
        {
          category: 'xe_selection',
          accountId: manager,
          operationId: 'retry-eight',
        },
        (tx) => store.bindCohort(tx, manager, eighth.id, clock),
      ),
    ).toEqual(bound);
    expect(await snapshot()).toEqual(before);
  });
  it('有旧修订时配对恢复用当前superseded revision+1，旧receipt不会因恢复而复活', async () => {
    const first = await publication('first');
    const second = await publication('second', 'xe-select-v2');
    expect(
      await execute(manager, 'undo', {
        operationId: 'undo-second',
        publicationId: second.publicationId,
        expectedRevision: second.revision,
      }),
    ).toMatchObject({ status: 'success' });
    const restored = (
      await db()
        .select()
        .from(selectionRevisions)
        .where(eq(selectionRevisions.versionId, first.versionId))
    )[0];
    expect(restored).toMatchObject({
      state: 'active',
      revision: first.revision + 2,
    });
    expect(await head()).toMatchObject({
      currentPublicationId: null,
      generation: 4,
      currentRevisionId: restored.id,
    });
    const before = await snapshot();
    expect(
      await execute(manager, 'undo', {
        operationId: 'stale-first-undo',
        publicationId: first.publicationId,
        expectedRevision: restored.revision,
      }),
    ).toMatchObject({ status: 'conflict' });
    expect(await snapshot()).toEqual(before);
  });
  it('撤销后同版可重发但不可重写内容或来源，旧发布身份保持失效', async () => {
    const receipt = await publication();
    const content = await db()
      .select()
      .from(selectionVersionContents)
      .orderBy(selectionVersionContents.versionId);
    await execute(manager, 'undo', {
      operationId: 'undo',
      publicationId: receipt.publicationId,
      expectedRevision: receipt.revision,
    });
    const row = (
      await db()
        .select()
        .from(selectionRevisions)
        .where(eq(selectionRevisions.versionId, receipt.versionId))
    )[0];
    const result = await execute(
      manager,
      'publish',
      publishInput(row.record.revision, 'republish'),
    );
    expect(result.status).toBe('success');
    expect(
      await db()
        .select()
        .from(selectionVersionContents)
        .orderBy(selectionVersionContents.versionId),
    ).toEqual(content);
    expect(await db().select().from(selectionPublications)).toHaveLength(2);
    expect((await head()).currentPublicationId).not.toBe(receipt.publicationId);
  });
  it('幂等回执重放前重查每个HR可见期次，局部撤权不返回旧私有依据', async () => {
    const input = {
      operationId: 'replay-create',
      baseVersionId: 'xe-select-v1',
      attributionId: 'selection-demo-attribution-xe-select-v1',
      expectedAttributionRevision: 1,
      reason: '演示',
    };
    expect(await execute(hr, 'create', input)).toMatchObject({
      status: 'success',
    });
    const before = await snapshot();
    await db()
      .update(grants)
      .set({ revokedAt: '2026-10-31' })
      .where(eq(grants.id, 'selection-demo-hr-' + iterationDemoNextCohort.id));
    const result = await execute(hr, 'create', input);
    expect(result).toMatchObject({ status: 'forbidden' });
    expect(result).not.toHaveProperty('result');
    expect(await snapshot()).toEqual(before);
  });
  it('迟发head CAS不匹配整体回滚，不把已切区段或发布内容部分提交', async () => {
    const record = await pending();
    const before = await snapshot();
    const reader = services.readImpact;
    services.readImpact = async (tx, authority, saved) => {
      const facts = await reader(tx, authority, saved);
      await tx
        .update(selectionCategoryHeads)
        .set({ generation: (await head()).generation + 1 });
      return facts;
    };
    expect(
      await execute(manager, 'publish', publishInput(record)),
    ).toMatchObject({ status: 'conflict' });
    expect(await snapshot()).toEqual(before);
  });
  it('缺明确基线时拒绝起草，不凭版本名字或空内容补发布状态', async () => {
    await db().delete(selectionCohortBindings);
    await db().delete(selectionCategoryHeads);
    await db().delete(selectionVersionContents);
    const input = {
      operationId: 'no-baseline',
      baseVersionId: 'xe-select-v1',
      attributionId: 'selection-demo-attribution-xe-select-v1',
      expectedAttributionRevision: 1,
      reason: '演示',
    };
    expect(await execute(hr, 'create', input)).toMatchObject({
      status: 'conflict',
    });
    expect(await db().select().from(selectionRevisions)).toEqual([]);
    await expect(
      initializeSelectionBaseline(
        db(),
        { ...initial, sourceReference: '' },
        clock,
      ),
    ).rejects.toBeInstanceOf(SelectionPersistenceUnavailableError);
    expect(await db().select().from(selectionCategoryHeads)).toEqual([]);
  });
  it('发布/撤回后现有记录、来源、分数与档案依赖表指纹保持不变', async () => {
    async function protectedFacts() {
      const names = [
        'records_events',
        'records_statements',
        'records_fragments',
        'records_historical_evaluations',
        'talent_confirmations',
        'talent_score_reviews',
        'directory_people',
      ];
      const fingerprints: Record<string, unknown> = {};
      for (const name of names) {
        const result = await db().execute(
          sql`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text, '[]')) as hash from ${sql.identifier(name)} t`,
        );
        fingerprints[name] = result.rows[0].hash;
      }
      const otherPeriods = await db()
        .select()
        .from(ruleVersionApplicability)
        .where(sql`${ruleVersionApplicability.category} <> 'xe_selection'`)
        .orderBy(ruleVersionApplicability.periodId);
      return { fingerprints, otherPeriods };
    }
    const before = await protectedFacts();
    const receipt = await publication();
    await execute(manager, 'undo', {
      operationId: 'undo',
      publicationId: receipt.publicationId,
      expectedRevision: receipt.revision,
    });
    expect(await protectedFacts()).toEqual(before);
    expect(
      await readEffectiveRuleVersion(db(), {
        category: 'dimension_anchors',
        at: now,
      }),
    ).toMatchObject({ status: 'success', version: { versionId: 'rubric-v1' } });
  });
});
