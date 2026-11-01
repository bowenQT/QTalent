import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../../db/client';
import {
  anchors,
  dimensions,
  ruleVersionApplicability,
  ruleVersions,
} from '../../evaluation-system';
import { readBatchArrangeRules } from './batch-rules';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_arrange_rules_${randomUUID().replaceAll('-', '')}_test`;
const january = new Date('2026-01-01T00:00:00Z');
const october = new Date('2026-10-01T00:00:00Z');
function db() {
  if (!connection)
    throw new Error('Real PostgreSQL fixture is not initialized');
  return connection.db;
}
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(
      'Integration database must use the approved local test source',
    );
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
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
async function version(
  id: string,
  category: 'dimension_anchors' | 'xe_selection',
  from = january,
  until: Date | null = null,
) {
  await db().insert(ruleVersions).values({ id, provenance: 'published' });
  await db()
    .insert(ruleVersionApplicability)
    .values({
      periodId: `demo-period:${id}`,
      versionId: id,
      category,
      effectiveFrom: from,
      effectiveUntil: until,
    });
}
async function content(versionId: string, id: string, value: number) {
  await db()
    .insert(anchors)
    .values({
      id,
      dimensionId: 'demo-prof',
      ruleVersionId: versionId,
      value,
      text: `演示：版本${versionId}的原始锚点`,
    });
}
async function setup() {
  await db()
    .insert(dimensions)
    .values([
      { id: 'demo-prof', name: '演示专业度', axis: 'prof', core: true },
      { id: 'demo-unused', name: '演示未采用维度', axis: 'pot', core: false },
    ]);
  await version('rubric-v1', 'dimension_anchors', january, october);
  await version('rubric-v2', 'dimension_anchors', october);
  await version('xe-select-v1', 'xe_selection');
  await content('rubric-v1', 'demo-old-anchor', 3);
  await content('rubric-v2', 'demo-new-anchor', 4);
  await content('xe-select-v1', 'demo-selection-anchor', 5);
}
describe('845 consumes the actual922 category/time reader and stored content', () => {
  it.each([
    ['2026-09-30T23:59:59.999Z', 'rubric-v1', 'demo-old-anchor', 3],
    ['2026-10-01T00:00:00.000Z', 'rubric-v2', 'demo-new-anchor', 4],
  ] as const)(
    'freezes the saved-time content and both version fields at %s',
    async (at, expectedVersion, expectedAnchor, expectedValue) => {
      await setup();
      const result = await db().transaction((tx) =>
        readBatchArrangeRules(tx, at),
      );
      expect(result).toEqual({
        effective: {
          category: 'dimension_anchors',
          versionId: expectedVersion,
          provenance: 'published',
          effectiveFrom:
            expectedVersion === 'rubric-v1'
              ? january.toISOString()
              : october.toISOString(),
          effectiveUntil:
            expectedVersion === 'rubric-v1' ? october.toISOString() : null,
        },
        contentVersionId: expectedVersion,
        dimensionVersionId: expectedVersion,
        anchorVersionId: expectedVersion,
        dimensions: ['demo-prof'],
        anchors: [
          {
            id: expectedAnchor,
            dimensionId: 'demo-prof',
            versionId: expectedVersion,
            value: expectedValue,
            text: `演示：版本${expectedVersion}的原始锚点`,
          },
        ],
      });
    },
  );
  it('does not fall back to a published selection version before the rubric period', async () => {
    await setup();
    expect(
      await readBatchArrangeRules(db(), '2025-12-31T23:59:59.999Z'),
    ).toBeNull();
  });
  it('freezes deterministic anchor content independent of database row order', async () => {
    await setup();
    await content('rubric-v1', 'aaa-second-anchor', 4);
    const result = await readBatchArrangeRules(db(), '2026-09-03T00:00:00Z');
    expect(result?.anchors.map((anchor) => anchor.id)).toEqual([
      'aaa-second-anchor',
      'demo-old-anchor',
    ]);
    expect(result?.dimensionVersionId).toBe('rubric-v1');
    expect(result?.anchorVersionId).toBe('rubric-v1');
  });
  it('keeps an effective rule with missing anchor content unavailable', async () => {
    await version('rubric-v1', 'dimension_anchors');
    expect(await readBatchArrangeRules(db(), october.toISOString())).toBeNull();
  });
  it('does not choose one overlapping rubric interval arbitrarily', async () => {
    await setup();
    await db().insert(ruleVersionApplicability).values({
      periodId: 'demo-overlap',
      versionId: 'rubric-v1',
      category: 'dimension_anchors',
      effectiveFrom: october,
      effectiveUntil: null,
    });
    expect(await readBatchArrangeRules(db(), october.toISOString())).toBeNull();
  });
});
