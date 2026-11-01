import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  type PreparedStandardIterationDemo,
} from './input';
import { importStandardIterationDemo } from './import';

// Native PG rollback tests use the actual pinned 923 inputs, not injected plans.
// Positive tests use explicitly synthetic legal node/time facts in this isolated
// database, authorized for verification only. They are NOT approval of real 923
// mapping/history and never enter production defaults. 918 state is created only
// through its real authorized initialize/bind functions, never direct inserts.
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
let isolatedUrl: string;
let plan: PreparedStandardIterationDemo;
const databaseName = `qtalent_iteration_${randomUUID().replaceAll('-', '')}_test`;
function db() {
  if (!connection) throw new Error('Isolated test database unavailable');
  return connection.db;
}
const apply = () => importStandardIterationDemo(db(), process.cwd());
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
  await migrate(db(), {
    migrationsFolder:
      process.env.QTALENT_COMPARISON_TEST_MIGRATIONS ??
      'src/server/db/migrations',
  });
  await countFacts();
}, 30_000);
afterAll(async () => {
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
  await db()
    .insert(people)
    .values(
      plan.requiredPeople.map((p) => ({
        ...p,
        organizationId: 'iteration-test-org',
        demo: true,
      })),
    );
  await db().insert(cohorts).values(plan.cohort);
});
async function runCli() {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (done) => {
      execFile(
        process.execPath,
        [
          '--conditions=react-server',
          '--import',
          'tsx',
          resolve('src/server/db/seed/standard-iteration-demo/run.ts'),
          '--apply',
        ],
        {
          timeout: 10_000,
          maxBuffer: 20_000,
          env: {
            PATH: process.env.PATH,
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
async function nativeFixture(
  versionId = plan.selectionStandard.versionId,
  content = plan.selectionStandard.content,
) {
  const accountId = 'iteration-test-manager';
  await db().insert(accountBindings).values({
    accountId,
    personId: plan.requiredPeople[0].id,
    isSystemAdmin: false,
  });
  await db().insert(grants).values({
    id: 'iteration-test-manager-grant',
    accountId,
    role: 'manager',
    scope: 'company',
    validFrom: '2026-01-01',
  });
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
  const nodeIds = [
    ...new Set(
      plan.canonical.cases.flatMap((c) => [c.frontNodeId, c.backNodeId]),
    ),
  ];
  await db()
    .insert(evaluationNodes)
    .values(
      nodeIds.map((id) => ({
        id,
        name: '独立事务测试节点（非演示映射裁决）',
        kind: 'defense' as const,
        cohortId: plan.cohort.id,
      })),
    );
  const subjects = new Map(
    plan.canonical.cases.flatMap((c) =>
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
      canonical: 285,
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
      ).toHaveLength(87);
      expect(
        saved?.facts.cases.filter((c) => c.back.state === 'present'),
      ).toHaveLength(86);
      expect(saved?.facts.manualMarks).toHaveLength(4);
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
      canonical: 285,
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
      canonical: 285,
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
      canonical: 285,
      grants: 1,
    });
  }, 15_000);
});
