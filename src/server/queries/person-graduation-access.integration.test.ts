import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import { importDemo } from '../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
import { assignments } from '../modules/programs';
import { loadPersonData } from './person-data';
import { sourceFromData } from './sources';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const database = `qtalent_graduation_${randomUUID().replaceAll('-', '')}_test`;
const target = 'p-x07';
const current = '2026-11-01T00:00:00.000Z';
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'TEST_DATABASE_URL required for real PostgreSQL; no fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error(
      'Only the authorized isolated loopback test database is allowed',
    );
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  await importDemo(
    connection.db,
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'synthetic-test-password-only',
  );
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
async function historical(accountId: string, kind: string, now = current) {
  const data = await loadPersonData(connection!.db, accountId, now);
  const history = data.historical.find(
    (row) => row.personId === target && row.kind === kind,
  );
  if (!history) throw new Error('Expected pinned demo historical fixture');
  return { data, history, result: await sourceFromData(data, history) };
}

it('the fixed seed cohort mentor cannot read the restricted p-x07 graduation source', async () => {
  const { data, result } = await historical('demo-mentor', '结营评审');
  expect(
    data.context.assignments.some(
      (row) =>
        row.personId === data.context.account.personId &&
        row.studentId === target,
    ),
  ).toBe(true);
  expect(result.status).toBe('not_found');
  expect(JSON.stringify(result)).not.toContain('结营结论');
});
it.each(['demo-ceo', 'demo-hrbp'])(
  'keeps the current authorized %s historical scale and exact source reference',
  async (account) => {
    const { history, result } = await historical(account, '结营评审');
    expect(result).toMatchObject({
      status: 'success',
      source: {
        sourceType: 'prototype_snapshot',
        sourceCategory: 'prototype_baseline',
        demo: true,
        fragmentId: history.fragmentId,
        originalVersionId: history.originalVersionId,
        excerpt: JSON.stringify(history.scale),
      },
    });
    expect(history.kind).toBe('结营评审');
    expect(history.scale.some(([label]) => label === '结营结论')).toBe(true);
  },
);
it('reloads real relationship revocation without granting a review from the same cohort', async () => {
  const { data, result } = await historical('demo-mentor', '训练营周评');
  expect(result.status).toBe('success');
  await connection!.db
    .update(assignments)
    .set({ revokedAt: '2026-11-01' })
    .where(
      and(
        eq(assignments.personId, data.context.account.personId),
        eq(assignments.studentId, target),
      ),
    );
  expect((await historical('demo-mentor', '训练营周评')).result.status).toBe(
    'not_found',
  );
  expect((await historical('demo-mentor', '结营评审')).result.status).toBe(
    'not_found',
  );
});
