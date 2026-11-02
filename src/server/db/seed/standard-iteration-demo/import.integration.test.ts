import { randomUUID } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
import { createDatabase } from '../../client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../../modules/directory';
import {
  cohorts,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../../../modules/programs';
import {
  comparisonMappings,
  lockCanonicalComparisonBatch,
} from '../../../modules/evaluation-system';
import {
  initializeReviewedSelectionBaseline,
  bindExistingSelectionCohort,
} from '../../../usecases/selection-standard-native';
import { readCanonicalComparisonBatch } from '../../../usecases/judgment-comparison-canonical';
import {
  originals,
  originalVersions,
  fragments,
} from '../../../modules/records';
import {
  prepareStandardIterationDemo,
  readStandardIterationFactFiles,
  type FactGeneration,
  type PreparedStandardIterationDemo,
} from './input';
import { generationFactRoot, releaseArtifact } from './fact-roots.test-support';
import { importStandardIterationDemo } from './import';
import {
  DEMO_GRADUATION_REVIEWER,
  DEMO_NODES,
  initializeStandardIterationDemo,
} from './init';

// Native PG rollback tests use the actual pinned 923 inputs, not injected plans.
// Positive tests use explicitly synthetic legal node/time facts in this isolated
// database, authorized for verification only. They are NOT approval of real 923
// mapping/history and never enter production defaults. 918 state is created only
// through its real authorized initialize/bind functions, never direct inserts.
// A full 93-case import with source checks can exceed the 5s default under load.
vi.setConfig({ testTimeout: 20_000 });
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
let isolatedUrl: string;
let plan: PreparedStandardIterationDemo;
let previous: PreparedStandardIterationDemo;
// The superseded generation is not in the tree; it is read from a root
// extracted from its pinned commit, like any packaged root without .git.
const v2Root = generationFactRoot('bow-923-v2');
const databaseName = `qtalent_iteration_${randomUUID().replaceAll('-', '')}_test`;
function db() {
  if (!connection) throw new Error('Isolated test database unavailable');
  return connection.db;
}
const apply = (generation?: FactGeneration) =>
  importStandardIterationDemo(
    db(),
    generation === 'bow-923-v2' ? v2Root : process.cwd(),
    generation,
  );
async function countFacts() {
  return (
    await db().execute<{
      records: number;
      canonical: number;
      grants: number;
    }>(sql`
    select
      ((select count(*) from records_originals) +
       (select count(*) from records_original_versions) +
       (select count(*) from records_fragments))::integer records,
      ((select count(*) from evaluation_comparison_batches) +
       (select count(*) from evaluation_comparison_mappings) +
       (select count(*) from evaluation_comparison_cases) +
       (select count(*) from evaluation_comparison_stages) +
       (select count(*) from evaluation_comparison_manual_marks))::integer canonical,
      (select count(*)::integer from directory_grants) grants`)
  ).rows[0];
}
beforeAll(async () => {
  plan = await prepareStandardIterationDemo(
    await readStandardIterationFactFiles(process.cwd()),
  );
  previous = await prepareStandardIterationDemo(
    await readStandardIterationFactFiles(v2Root, 'bow-923-v2'),
    'bow-923-v2',
  );
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no skip or fake');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Isolated loopback _test database required');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  url.pathname = '/' + databaseName;
  isolatedUrl = url.toString();
  connection = createDatabase(isolatedUrl);
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  await countFacts();
}, 30_000);
afterAll(async () => {
  rmSync(v2Root, { recursive: true, force: true });
  await connection?.pool.end();
  if (admin) {
    try {
      if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
    } finally {
      await admin.end();
    }
  }
});
beforeEach(async () => {
  await db().execute(sql`delete from evaluation_comparison_manual_marks`);
  await db().execute(sql`delete from evaluation_comparison_stages`);
  await db().execute(sql`delete from evaluation_comparison_cases`);
  await db().execute(sql`delete from evaluation_comparison_batches`);
  await db().execute(sql`delete from evaluation_comparison_mappings`);
  await db().delete(evaluationNodeSubjects);
  await db().delete(evaluationNodes);
  await db().execute(sql`delete from evaluation_selection_cohort_bindings`);
  await db().execute(sql`delete from evaluation_selection_category_head`);
  await db().execute(sql`delete from evaluation_selection_version_content`);
  await db().execute(sql`delete from evaluation_rule_version_applicability`);
  await db().execute(sql`delete from evaluation_rule_versions`);
  await db().delete(grants);
  await db().delete(accountBindings);
  await db().delete(fragments);
  await db().delete(originalVersions);
  await db().delete(originals);
  await db().delete(people);
  await db().delete(organizations);
  await db().delete(cohorts);
  await db().insert(organizations).values({
    id: 'iteration-test-org',
    name: '测试组织（演示）',
    shortName: '测试',
  });
  // Both generations name the same directory; a shared ID keeps one name.
  const directory = new Map(
    [...previous.requiredPeople, ...plan.requiredPeople].map((p) => [p.id, p]),
  );
  // s-29 is held in the exact form init registers, under its real organization.
  directory.delete(DEMO_GRADUATION_REVIEWER.id);
  await db()
    .insert(organizations)
    .values({ id: 'tdc', name: '测试评审组织（演示）', shortName: '评审' });
  await db()
    .insert(people)
    .values([
      ...[...directory.values()].map((p) => ({
        ...p,
        organizationId: 'iteration-test-org',
        demo: true,
      })),
      DEMO_GRADUATION_REVIEWER,
    ]);
  await db().insert(cohorts).values(plan.cohort);
});
async function runCli(
  args = ['--apply'],
  { root = process.cwd(), path = process.env.PATH, timeout = 10_000 } = {},
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (done) => {
      execFile(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          resolve(root, 'src/server/db/seed/standard-iteration-demo/run.ts'),
          ...args,
        ],
        {
          cwd: root,
          timeout,
          maxBuffer: 20_000,
          env: {
            PATH: path,
            NODE_ENV: 'test',
            APP_ENV: 'test',
            DATABASE_URL: isolatedUrl,
            BETTER_AUTH_SECRET: 'synthetic-test-only-secret-00000000',
            BETTER_AUTH_URL: 'http://localhost:3000',
          },
        },
        (error, stdout, stderr) =>
          done({ code: error ? Number(error.code) : 0, stdout, stderr }),
      );
    },
  );
}
async function activeConnections() {
  if (!admin) throw new Error('Test admin unavailable');
  const result = await admin.query<{ count: number }>(
    'select count(*)::integer count from pg_stat_activity where datname=$1',
    [databaseName],
  );
  return result.rows[0].count;
}
describe('923 native fixed-source import rollback', () => {
  it('actual CLI fails closed with only a stable missing-binding code, then closes its connection', async () => {
    const before = await activeConnections();
    const result = await runCli();
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr:
        JSON.stringify({
          status: 'failed',
          code: 'selection_binding_unavailable',
        }) + '\n',
    });
    expect(await activeConnections()).toBe(before);
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 0 });
  }, 15_000);
  it('actual CLI does not expose raw conflict details and leaves the original untouched', async () => {
    const original = {
      ...plan.records.originals[1],
      title: '既有独立原件（演示）',
    };
    await db().insert(originals).values(original);
    const result = await runCli();
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr:
        JSON.stringify({ status: 'failed', code: 'import_failed' }) + '\n',
    });
    expect(await db().select().from(originals)).toEqual([original]);
    expect(await countFacts()).toEqual({ records: 1, canonical: 0, grants: 0 });
  }, 15_000);
  it('missing 918 binding rolls back all 190 original/version/fragment inserts and all canonical facts', async () => {
    await expect(apply()).rejects.toMatchObject({
      code: 'selection_binding_unavailable',
    });
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 0 });
  });
  it('concurrent same-batch attempts both fail without a binding; retry cannot leave partial facts', async () => {
    const results = await Promise.allSettled([apply(), apply()]);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({
          code: 'selection_binding_unavailable',
        });
    }
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 0 });
  });
  it.each(['missing', 'wrong-name', 'not-demo'] as const)(
    'rejects directory %s before registering originals',
    async (mode) => {
      const id = plan.requiredPeople[0].id;
      if (mode === 'missing')
        await db().delete(people).where(eq(people.id, id));
      else
        await db()
          .update(people)
          .set(
            mode === 'wrong-name'
              ? { name: '另一人（演示）' }
              : { demo: false },
          )
          .where(eq(people.id, id));
      await expect(apply()).rejects.toMatchObject({
        code: 'directory_mismatch',
      });
      expect(await countFacts()).toEqual({
        records: 0,
        canonical: 0,
        grants: 0,
      });
    },
  );
  it.each(['missing', 'wrong-name'] as const)(
    'rejects cohort %s without creating or changing it',
    async (mode) => {
      if (mode === 'missing') await db().delete(cohorts);
      else await db().update(cohorts).set({ name: '其他期次（演示）' });
      await expect(apply()).rejects.toMatchObject({ code: 'cohort_mismatch' });
      expect(await countFacts()).toEqual({
        records: 0,
        canonical: 0,
        grants: 0,
      });
    },
  );
  it('accepts the existing directory demo display annotation without mapping names to new identities', async () => {
    for (const p of plan.requiredPeople)
      await db()
        .update(people)
        .set({ name: p.name.slice(0, -4) })
        .where(eq(people.id, p.id));
    await db()
      .update(cohorts)
      .set({ name: plan.cohort.name.replace(/（演示）$/, '') });
    await expect(apply()).rejects.toMatchObject({
      code: 'selection_binding_unavailable',
    });
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 0 });
  });
  it('original ID conflict preserves its exact old facts and rolls back newly inserted siblings', async () => {
    const original = {
      ...plan.records.originals[1],
      title: '另一份原件（演示）',
    };
    await db().insert(originals).values(original);
    await expect(apply()).rejects.toThrow('Import identity collision');
    expect(await db().select().from(originals)).toEqual([original]);
    expect(await countFacts()).toEqual({ records: 1, canonical: 0, grants: 0 });
  });
  it('same version ID with different byte digest is not silently accepted', async () => {
    await db().insert(originals).values(plan.records.originals);
    const version = {
      ...plan.records.originalVersions[1],
      contentDigest: 'f'.repeat(64),
    };
    await db().insert(originalVersions).values(version);
    await expect(apply()).rejects.toThrow('Import identity collision');
    expect(await db().select().from(originalVersions)).toEqual([version]);
    expect(await countFacts()).toEqual({ records: 3, canonical: 0, grants: 0 });
  });
  it('late fragment conflict leaves no earlier sibling fragments or new canonical rows', async () => {
    await db().insert(originals).values(plan.records.originals);
    await db().insert(originalVersions).values(plan.records.originalVersions);
    const fragment = {
      ...plan.records.fragments.at(-1)!,
      excerpt: '原先另一段原文（演示）',
    };
    await db().insert(fragments).values(fragment);
    await expect(apply()).rejects.toThrow('Import identity collision');
    expect(await db().select().from(fragments)).toEqual([fragment]);
    expect(await countFacts()).toEqual({ records: 5, canonical: 0, grants: 0 });
  });
  it('same existing records survive downstream rejection unchanged and are not duplicated', async () => {
    await db().insert(originals).values(plan.records.originals);
    await db().insert(originalVersions).values(plan.records.originalVersions);
    await db().insert(fragments).values(plan.records.fragments);
    await expect(apply()).rejects.toMatchObject({
      code: 'selection_binding_unavailable',
    });
    expect(await db().select().from(fragments).orderBy(fragments.id)).toEqual(
      [...plan.records.fragments].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await countFacts()).toEqual({
      records: 190,
      canonical: 0,
      grants: 0,
    });
  });
});

const TEST_ONLY_EFFECTIVE_FROM = '2026-01-01T00:00:00.000Z';
const TEST_ONLY_CLOCK = () => new Date('2026-11-01T00:00:00.000Z');
const MANAGER = 'iteration-test-manager';
async function managerAccount() {
  await db().insert(accountBindings).values({
    accountId: MANAGER,
    personId: plan.requiredPeople[0].id,
    isSystemAdmin: false,
  });
  await db().insert(grants).values({
    id: 'iteration-test-manager-grant',
    accountId: MANAGER,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
}
async function nodesFor(target: PreparedStandardIterationDemo) {
  const nodeIds = [
    ...new Set(
      target.canonical.cases.flatMap((c) => [c.frontNodeId, c.backNodeId]),
    ),
  ];
  await db()
    .insert(evaluationNodes)
    .values(
      nodeIds.map((id) => ({
        id,
        name: '独立事务测试节点（非演示映射裁决）',
        kind: 'review' as const,
        cohortId: target.cohort.id,
      })),
    );
  const subjects = new Map(
    target.canonical.cases.flatMap((c) =>
      [c.frontNodeId, c.backNodeId].map(
        (evaluationNodeId) =>
          [
            evaluationNodeId + ':' + c.personId,
            { evaluationNodeId, personId: c.personId },
          ] as const,
      ),
    ),
  );
  await db()
    .insert(evaluationNodeSubjects)
    .values([...subjects.values()]);
}
async function nativeFixture(
  versionId = plan.selectionStandard.versionId,
  content = plan.selectionStandard.content,
) {
  const accountId = MANAGER;
  await managerAccount();
  await initializeReviewedSelectionBaseline(
    db(),
    accountId,
    {
      versionId,
      periodId: 'iteration-test-only-period',
      effectiveFrom: TEST_ONLY_EFFECTIVE_FROM,
      nextVersionOrdinal: 3,
      sourceCommit: plan.canonical.batch.sourceCommit,
      sourceReference:
        'synthetic-test-only:923-transaction-not-approved-demo-history',
      content,
    },
    TEST_ONLY_CLOCK,
  );
  await bindExistingSelectionCohort(
    db(),
    accountId,
    plan.cohort.id,
    TEST_ONLY_CLOCK,
  );
  await nodesFor(plan);
}
const readBatch = () =>
  db().transaction((tx) =>
    readCanonicalComparisonBatch(tx, plan.canonical.batch.id),
  );
async function waitForTwoImporters() {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const result = await db().execute<{ count: number }>(
      sql`select count(*)::integer count from pg_locks where locktype='advisory' and not granted and database=(select oid from pg_database where datname=current_database())`,
    );
    if (result.rows[0].count >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Two native importers did not wait on the actual batch lock');
}

describe('923 native success with explicitly synthetic test-only prerequisites', () => {
  it('imports all 93 cases/186 real source rows and reads identical facts from a new connection', async () => {
    await nativeFixture();
    const result = await apply();
    expect(result).toMatchObject({
      status: 'inserted',
      batchId: plan.canonical.batch.id,
      sourceCommit: plan.canonical.batch.sourceCommit,
      inputCases: 93,
      sourceRows: 186,
    });
    expect(await countFacts()).toEqual({
      records: 190,
      canonical: 282,
      grants: 1,
    });
    const reader = createDatabase(isolatedUrl);
    try {
      const saved = await reader.db.transaction((tx) =>
        readCanonicalComparisonBatch(tx, plan.canonical.batch.id),
      );
      expect(saved?.facts).toEqual(plan.canonical);
      expect(saved?.factsDigest).toBe(result.factsDigest);
      expect(saved?.selectionStandardVersionId).toBe('xe-select-v1');
      expect(
        saved?.facts.cases.filter((c) => c.front.state === 'present'),
      ).toHaveLength(83);
      expect(
        saved?.facts.cases.filter((c) => c.back.state === 'present'),
      ).toHaveLength(89);
      expect(saved?.facts.manualMarks).toHaveLength(1);
    } finally {
      await reader.pool.end();
    }
    expect(await db().select().from(fragments).orderBy(fragments.id)).toEqual(
      [...plan.records.fragments].sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
  it('successful same-fact replay keeps digest, import time, every row and current grants unchanged', async () => {
    await nativeFixture();
    const first = await apply();
    const snapshot = await readBatch();
    const counts = await countFacts();
    const again = await apply();
    expect(again).toEqual({ ...first, status: 'unchanged' });
    expect(await readBatch()).toEqual(snapshot);
    expect(await countFacts()).toEqual(counts);
  });
  it('two importers demonstrably wait on the same native lock and commit only one full batch', async () => {
    await nativeFixture();
    let unlock!: () => void;
    let acquired!: () => void;
    const hold = new Promise<void>((r) => {
      unlock = r;
    });
    const ready = new Promise<void>((r) => {
      acquired = r;
    });
    const blocker = db().transaction(async (tx) => {
      await lockCanonicalComparisonBatch(tx, plan.canonical.batch.id);
      acquired();
      await hold;
    });
    await ready;
    const work = Promise.all([apply(), apply()]);
    try {
      await waitForTwoImporters();
    } finally {
      unlock();
      await blocker;
    }
    const results = await work;
    expect(results.map((r) => r.status).sort()).toEqual([
      'inserted',
      'unchanged',
    ]);
    expect(results[0].factsDigest).toBe(results[1].factsDigest);
    expect(await countFacts()).toEqual({
      records: 190,
      canonical: 282,
      grants: 1,
    });
    expect((await readBatch())?.facts).toEqual(plan.canonical);
  }, 15_000);
  it.each(['version', 'content'] as const)(
    'rejects a genuine existing binding with wrong %s and rolls back originals',
    async (mode) => {
      const content = structuredClone(plan.selectionStandard.content);
      if (mode === 'content')
        content.reviewPoints[0].description += '（测试差异）';
      await nativeFixture(
        mode === 'version' ? 'xe-select-v2' : 'xe-select-v1',
        content,
      );
      await expect(apply()).rejects.toMatchObject({
        code: 'selection_binding_mismatch',
      });
      expect(await countFacts()).toEqual({
        records: 0,
        canonical: 0,
        grants: 1,
      });
    },
  );
  it('missing actual node-subject membership is not inferred from cohort and rolls back source registration', async () => {
    await nativeFixture();
    await db()
      .delete(evaluationNodeSubjects)
      .where(
        eq(evaluationNodeSubjects.personId, plan.canonical.cases[0].personId),
      );
    await expect(apply()).rejects.toMatchObject({ code: 'invalid_reference' });
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 1 });
  });
  it('a conflicting canonical mapping fails after records registration and rolls that registration back', async () => {
    await nativeFixture();
    const conflicting = {
      ...plan.canonical.mapping,
      sourceFileSha256: 'f'.repeat(64),
    };
    await db().insert(comparisonMappings).values(conflicting);
    await expect(apply()).rejects.toMatchObject({ code: 'conflict' });
    expect(await countFacts()).toEqual({ records: 0, canonical: 1, grants: 1 });
    expect(await db().select().from(comparisonMappings)).toEqual([conflicting]);
  });
  it('replay cannot replace changed persisted source bytes or silently repair a conflicting fact', async () => {
    await nativeFixture();
    await apply();
    const target = plan.records.fragments[0];
    await db()
      .update(fragments)
      .set({ excerpt: '已变更事实（测试）' })
      .where(eq(fragments.id, target.id));
    await expect(apply()).rejects.toThrow('Import identity collision');
    expect(await countFacts()).toEqual({
      records: 190,
      canonical: 282,
      grants: 1,
    });
    expect(
      (
        await db().select().from(fragments).where(eq(fragments.id, target.id))
      )[0].excerpt,
    ).toBe('已变更事实（测试）');
  });
  it('actual CLI inserts then replays successfully, emits only the receipt and closes its connections', async () => {
    await nativeFixture();
    const before = await activeConnections();
    const result = await runCli();
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const receipt: unknown = JSON.parse(result.stdout);
    expect(receipt).toMatchObject({
      status: 'inserted',
      batchId: plan.canonical.batch.id,
      inputCases: 93,
      sourceRows: 186,
    });
    const replay = await runCli();
    expect(replay.code).toBe(0);
    expect(replay.stderr).toBe('');
    expect(JSON.parse(replay.stdout)).toEqual({
      ...JSON.parse(result.stdout),
      status: 'unchanged',
    });
    expect(await activeConnections()).toBe(before);
    expect(await countFacts()).toEqual({
      records: 190,
      canonical: 282,
      grants: 1,
    });
  }, 15_000);
});

describe('923 generations coexist and demo initialization is idempotent', () => {
  async function batchSnapshot(target: PreparedStandardIterationDemo) {
    return db().transaction((tx) =>
      readCanonicalComparisonBatch(tx, target.canonical.batch.id),
    );
  }
  async function recordRows() {
    return {
      originals: await db().select().from(originals).orderBy(originals.id),
      versions: await db()
        .select()
        .from(originalVersions)
        .orderBy(originalVersions.id),
      fragments: await db().select().from(fragments).orderBy(fragments.id),
    };
  }
  it('imports the superseded generation, then the current one beside it, then replays the current one', async () => {
    await nativeFixture();
    await nodesFor(previous);
    const old = await apply('bow-923-v2');
    expect(old).toMatchObject({
      status: 'inserted',
      batchId: previous.canonical.batch.id,
    });
    const oldBatch = await batchSnapshot(previous);
    const oldRecords = await recordRows();
    const current = await apply();
    expect(current).toMatchObject({
      status: 'inserted',
      batchId: plan.canonical.batch.id,
    });
    expect(await apply()).toEqual({ ...current, status: 'unchanged' });
    // The older generation's rows are byte-for-byte what it imported.
    expect(await batchSnapshot(previous)).toEqual(oldBatch);
    const both = await recordRows();
    for (const kind of ['originals', 'versions', 'fragments'] as const)
      for (const row of oldRecords[kind])
        expect(both[kind]).toContainEqual(row);
    expect((await batchSnapshot(plan))?.facts).toEqual(plan.canonical);
    expect(await countFacts()).toEqual({
      records: 380,
      canonical: 285 + 282,
      grants: 1,
    });
  });
  it('init establishes nodes, baseline, binding and import once; a re-run changes nothing', async () => {
    await managerAccount();
    const first = await initializeStandardIterationDemo(
      db(),
      process.cwd(),
      MANAGER,
      TEST_ONLY_CLOCK,
    );
    expect(first).toMatchObject({
      generation: 'bow-923-v3',
      nodes: 'created',
      baseline: 'created',
      binding: 'created',
      import: { status: 'inserted', batchId: plan.canonical.batch.id },
      nextCohortExists: false,
    });
    const nodes = await db()
      .select()
      .from(evaluationNodes)
      .orderBy(evaluationNodes.id);
    expect(nodes.map((n) => [n.id, n.kind, n.cohortId])).toEqual(
      [...DEMO_NODES]
        .map((n) => [n.id, 'review', plan.cohort.id])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
    const counts = await countFacts();
    const subjects = await db().select().from(evaluationNodeSubjects);
    expect(subjects).toHaveLength(2 * 93);
    const second = await initializeStandardIterationDemo(
      db(),
      process.cwd(),
      MANAGER,
      TEST_ONLY_CLOCK,
    );
    expect(second).toEqual({
      ...first,
      directory: 'unchanged',
      nodes: 'unchanged',
      baseline: 'unchanged',
      binding: 'unchanged',
      import: { ...first.import, status: 'unchanged' },
    });
    expect(await countFacts()).toEqual(counts);
    expect(await db().select().from(evaluationNodeSubjects)).toHaveLength(
      2 * 93,
    );
    expect(
      (
        await db().execute<{ n: number }>(
          sql`select count(*)::integer n from evaluation_rule_version_applicability`,
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('actual CLI init runs as the named manager, then a re-run reports every step unchanged', async () => {
    await managerAccount();
    const before = await activeConnections();
    const first = await runCli(['--init', '--as', MANAGER]);
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      nodes: 'created',
      baseline: 'created',
      binding: 'created',
      import: { status: 'inserted' },
    });
    const again = await runCli(['--init', '--as', MANAGER]);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({
      nodes: 'unchanged',
      baseline: 'unchanged',
      binding: 'unchanged',
      import: { status: 'unchanged' },
    });
    const denied = await runCli(['--init', '--as', 'no-such-account']);
    expect(denied).toEqual({
      code: 1,
      stdout: '',
      stderr:
        JSON.stringify({ status: 'failed', code: 'selection_forbidden' }) +
        '\n',
    });
    // Idle pool connections of this test process may close meanwhile; the
    // CLI must not leave any of its own behind.
    expect(await activeConnections()).toBeLessThanOrEqual(before);
  }, 30_000);
  it('actual CLI init names the differing s-29 columns, never their values', async () => {
    await managerAccount();
    await db()
      .update(people)
      .set({ hue: 220, name: '另一人' })
      .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
    expect(await runCli(['--init', '--as', MANAGER])).toEqual({
      code: 1,
      stdout: '',
      stderr:
        JSON.stringify({
          status: 'failed',
          code: 'directory_mismatch',
          fields: ['name', 'hue'],
        }) + '\n',
    });
  }, 30_000);
  it('init registers the missing graduation reviewer once, then keeps it', async () => {
    await managerAccount();
    await db().delete(people).where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
    const first = await initializeStandardIterationDemo(
      db(),
      process.cwd(),
      MANAGER,
      TEST_ONLY_CLOCK,
    );
    expect(first).toMatchObject({
      directory: 'created',
      import: { status: 'inserted' },
    });
    const stored = await db()
      .select()
      .from(people)
      .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
    // Init writes only the reviewed fields; the nullable profile columns
    // (job title/level) stay unknown, like the other demo staff.
    expect(stored).toEqual([
      { ...DEMO_GRADUATION_REVIEWER, jobTitle: null, jobLevel: null },
    ]);
    const again = await initializeStandardIterationDemo(
      db(),
      process.cwd(),
      MANAGER,
      TEST_ONLY_CLOCK,
    );
    expect(again).toMatchObject({ directory: 'unchanged' });
    expect(
      await db()
        .select()
        .from(people)
        .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id)),
    ).toEqual(stored);
  });
  it.each([
    ['name', { name: '另一人' }],
    ['organizationId', { organizationId: 'iteration-test-org' }],
    ['hue', { hue: 220 }],
    ['noReview', { noReview: false }],
  ] as const)(
    'init refuses an existing s-29 with a different %s and changes nothing',
    async (field, change) => {
      await managerAccount();
      await db()
        .update(people)
        .set(change)
        .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
      const before = await db()
        .select()
        .from(people)
        .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
      await expect(
        initializeStandardIterationDemo(
          db(),
          process.cwd(),
          MANAGER,
          TEST_ONLY_CLOCK,
        ),
      ).rejects.toMatchObject({
        code: 'directory_mismatch',
        fields: [field],
      });
      expect(
        await db()
          .select()
          .from(people)
          .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id)),
      ).toEqual(before);
      expect((await countFacts()).canonical).toBe(0);
      expect(await db().select().from(evaluationNodes)).toEqual([]);
    },
  );
  it('init keeps the previous generation nodes and adds the current ones', async () => {
    await managerAccount();
    await nodesFor(previous);
    const before = await db()
      .select()
      .from(evaluationNodes)
      .orderBy(evaluationNodes.id);
    await initializeStandardIterationDemo(
      db(),
      process.cwd(),
      MANAGER,
      TEST_ONLY_CLOCK,
    );
    const after = await db()
      .select()
      .from(evaluationNodes)
      .orderBy(evaluationNodes.id);
    for (const node of before) expect(after).toContainEqual(node);
    expect(after.map((n) => n.id)).toEqual(
      expect.arrayContaining(DEMO_NODES.map((n) => n.id)),
    );
  });
  it('init refuses an existing demo node with a different kind and creates nothing else', async () => {
    await managerAccount();
    await db().insert(evaluationNodes).values({
      id: DEMO_NODES[0].id,
      name: DEMO_NODES[0].name,
      kind: 'interview',
      cohortId: plan.cohort.id,
    });
    await expect(
      initializeStandardIterationDemo(
        db(),
        process.cwd(),
        MANAGER,
        TEST_ONLY_CLOCK,
      ),
    ).rejects.toMatchObject({ code: 'node_mismatch' });
    expect(await db().select().from(evaluationNodes)).toHaveLength(1);
    expect(await countFacts()).toEqual({ records: 0, canonical: 0, grants: 1 });
    expect(
      await db().execute(sql`select 1 from evaluation_selection_category_head`),
    ).toMatchObject({ rows: [] });
  });
  it.each(['version', 'content'] as const)(
    'init refuses an existing incompatible baseline (%s) and leaves no binding or audit',
    async (mode) => {
      await managerAccount();
      const content = structuredClone(plan.selectionStandard.content);
      if (mode === 'content')
        content.reviewPoints[0].description += '（测试差异）';
      await initializeReviewedSelectionBaseline(
        db(),
        MANAGER,
        {
          versionId: mode === 'version' ? 'xe-select-v2' : 'xe-select-v1',
          periodId: 'iteration-test-only-period',
          effectiveFrom: TEST_ONLY_EFFECTIVE_FROM,
          nextVersionOrdinal: 3,
          sourceCommit: plan.canonical.batch.sourceCommit,
          sourceReference:
            'synthetic-test-only:923-transaction-not-approved-demo-history',
          content,
        },
        TEST_ONLY_CLOCK,
      );
      const bindAudits = async () =>
        (
          await db().execute<{ n: number }>(
            sql`select count(*)::integer n from audit_events where action = 'selection_standard.bind_cohort'`,
          )
        ).rows[0].n;
      const auditsBefore = await bindAudits();
      await expect(
        initializeStandardIterationDemo(
          db(),
          process.cwd(),
          MANAGER,
          TEST_ONLY_CLOCK,
        ),
      ).rejects.toMatchObject({ code: 'selection_binding_mismatch' });
      expect(
        await db().execute(
          sql`select 1 from evaluation_selection_cohort_bindings`,
        ),
      ).toMatchObject({ rows: [] });
      expect(await bindAudits()).toBe(auditsBefore);
      expect((await countFacts()).canonical).toBe(0);
      // Once the baseline is the reviewed one, the same command recovers.
      await db().execute(sql`delete from evaluation_selection_category_head`);
      await db().execute(sql`delete from evaluation_selection_version_content`);
      await db().execute(
        sql`delete from evaluation_rule_version_applicability`,
      );
      await db().execute(sql`delete from evaluation_rule_versions`);
      await expect(
        initializeStandardIterationDemo(
          db(),
          process.cwd(),
          MANAGER,
          TEST_ONLY_CLOCK,
        ),
      ).resolves.toMatchObject({
        baseline: 'created',
        binding: 'created',
        import: { status: 'inserted' },
      });
      expect(await bindAudits()).toBe(auditsBefore + 1);
    },
  );
  it('init refuses an account without a current manager grant before any baseline', async () => {
    await managerAccount();
    await db().delete(grants);
    await expect(
      initializeStandardIterationDemo(
        db(),
        process.cwd(),
        MANAGER,
        TEST_ONLY_CLOCK,
      ),
    ).rejects.toMatchObject({ status: 'forbidden' });
    expect(
      await db().execute(sql`select 1 from evaluation_selection_category_head`),
    ).toMatchObject({ rows: [] });
    expect(await db().select().from(evaluationNodes)).toEqual([]);
  });
});
describe('923 init from the release artifact (no .git, no git on PATH)', () => {
  // Same mechanism as deploy/release.mjs prepare: `git archive` of the
  // commit, extracted without .git. This PR leaves the facts unchanged, so the
  // committed HEAD carries the pinned files. Dependencies are installed by
  // prepare; here the artifact links this checkout's node_modules.
  let artifact: string;
  let bin: string;
  const facts = () => join(artifact, 'tests/fixtures/bow-923');
  beforeAll(() => {
    artifact = releaseArtifact();
    symlinkSync(resolve('node_modules'), join(artifact, 'node_modules'));
    bin = mkdtempSync(join(tmpdir(), 'artifact-bin-'));
    symlinkSync(process.execPath, join(bin, 'node'));
    symlinkSync(
      execFileSync('sh', ['-c', 'command -v python3']).toString().trim(),
      join(bin, 'python3'),
    );
  });
  afterAll(() => {
    for (const dir of [artifact, bin])
      if (dir) rmSync(dir, { recursive: true, force: true });
  });
  const run = (args: string[]) =>
    runCli(args, { root: artifact, path: bin, timeout: 30_000 });
  async function nothingWritten() {
    expect(await db().select().from(evaluationNodes)).toEqual([]);
    expect(
      await db().execute(sql`select 1 from evaluation_selection_category_head`),
    ).toMatchObject({ rows: [] });
    expect(
      await db().execute(
        sql`select 1 from evaluation_selection_cohort_bindings`,
      ),
    ).toMatchObject({ rows: [] });
    expect(await countFacts()).toMatchObject({ records: 0, canonical: 0 });
    // Proof the reader ran before the s-29 transaction too.
    expect(
      await db()
        .select()
        .from(people)
        .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id)),
    ).toEqual([]);
  }
  it('initializes from the artifact, then a replay is unchanged', async () => {
    await managerAccount();
    // No .git in the artifact and no git executable on the CLI's PATH.
    expect(existsSync(join(artifact, '.git'))).toBe(false);
    expect(readdirSync(bin).sort()).toEqual(['node', 'python3']);
    const first = await run(['--init', '--as', MANAGER]);
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      generation: 'bow-923-v3',
      nodes: 'created',
      baseline: 'created',
      binding: 'created',
      import: { status: 'inserted' },
    });
    const again = await run(['--init', '--as', MANAGER]);
    expect(again.code).toBe(0);
    expect(JSON.parse(again.stdout)).toMatchObject({
      directory: 'unchanged',
      nodes: 'unchanged',
      baseline: 'unchanged',
      binding: 'unchanged',
      import: { status: 'unchanged' },
    });
  }, 90_000);
  it('without python3 on PATH the artifact init fails before any read or transaction', async () => {
    await managerAccount();
    await db().delete(people).where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
    const nodeOnly = mkdtempSync(join(tmpdir(), 'artifact-bin-node-'));
    try {
      symlinkSync(process.execPath, join(nodeOnly, 'node'));
      expect(
        await runCli(['--init', '--as', MANAGER], {
          root: artifact,
          path: nodeOnly,
          timeout: 30_000,
        }),
      ).toEqual({
        code: 1,
        stdout: '',
        stderr:
          JSON.stringify({ status: 'failed', code: 'python_unavailable' }) +
          '\n',
      });
      await nothingWritten();
    } finally {
      rmSync(nodeOnly, { recursive: true, force: true });
    }
  }, 60_000);
  it.each([
    ['tampered', 'fixture_digest_mismatch'],
    ['missing', 'fixture_missing'],
  ] as const)(
    'a %s packaged fact fails before any transaction',
    async (mode, code) => {
      await managerAccount();
      await db()
        .delete(people)
        .where(eq(people.id, DEMO_GRADUATION_REVIEWER.id));
      const path = join(facts(), 'source-rows.json');
      const original = readFileSync(path);
      try {
        if (mode === 'missing') renameSync(path, path + '.away');
        else writeFileSync(path, Buffer.concat([original, Buffer.from(' ')]));
        expect(await run(['--init', '--as', MANAGER])).toEqual({
          code: 1,
          stdout: '',
          stderr:
            JSON.stringify({
              status: 'failed',
              code,
              file: 'source-rows.json',
            }) + '\n',
        });
        await nothingWritten();
      } finally {
        rmSync(path + '.away', { force: true });
        writeFileSync(path, original);
      }
    },
    60_000,
  );
});
