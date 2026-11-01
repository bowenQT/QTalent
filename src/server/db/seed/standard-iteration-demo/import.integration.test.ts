import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../../client';
import { organizations, people } from '../../../modules/directory';
import { cohorts } from '../../../modules/programs';
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
// No guessed 923 node kinds, synthetic 918 effectiveFrom, or direct head/binding
// inserts. Positive full-batch execution needs those approved native facts.
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
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
  connection = createDatabase(url.toString());
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
describe('923 native fixed-source import rollback', () => {
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
