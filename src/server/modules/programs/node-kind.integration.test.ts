import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../db/client';
import { cohorts, evaluationNodes } from './schema';

// The node kind CHECK is enforced by the committed migrations only.
let admin: Pool;
let source: URL;
type Connection = ReturnType<typeof createDatabase>;
beforeAll(() => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error('Node kind tests require real PostgreSQL; no skips');
  source = new URL(raw);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) ||
    !source.pathname.endsWith('_test') ||
    source.port === '55432'
  )
    throw new Error(
      'Only the authorized loopback isolated test database is allowed',
    );
  admin = new Pool({ connectionString: raw, max: 2 });
});
afterAll(async () => {
  await admin?.end();
});
async function isolated(run: (connection: Connection) => Promise<void>) {
  const name = 'qtalent_nodekind_' + randomUUID().replaceAll('-', '') + '_test';
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(source);
  url.pathname = '/' + name;
  const connection = createDatabase(url.toString());
  try {
    await migrate(connection.db, {
      migrationsFolder: 'src/server/db/migrations',
    });
    await run(connection);
  } finally {
    await connection.pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
  }
}
const violation = (code: string, constraint: string) =>
  expect.objectContaining({
    cause: expect.objectContaining({ code, constraint }),
  });

it('accepts review nodes without a cohort and keeps the other kind rules', async () => {
  await isolated(async ({ db }) => {
    await db.insert(cohorts).values({ id: 'c1', name: '演示期次' });
    await db.insert(evaluationNodes).values([
      { id: 'xe6-select', name: '入营选拔（演示）', kind: 'review' },
      { id: 'xe6-end', name: '结营评审（演示）', kind: 'review' },
      {
        id: 'n-cohort',
        name: '演示期次节点',
        kind: 'program_cohort',
        cohortId: 'c1',
      },
    ]);
    const rows = await db.select().from(evaluationNodes);
    expect(rows.filter((row) => row.kind === 'review')).toHaveLength(2);

    await expect(
      db.execute(
        `insert into programs_evaluation_nodes (id, name, kind) values ('bad', '未知', 'unknown')`,
      ),
    ).rejects.toEqual(violation('23514', 'programs_node_kind'));
    await expect(
      db.insert(evaluationNodes).values({
        id: 'n-cohort-2',
        name: '同期次第二个节点',
        kind: 'program_cohort',
        cohortId: 'c1',
      }),
    ).rejects.toEqual(violation('23505', 'programs_one_cohort_node'));
    await expect(
      db.insert(evaluationNodes).values({
        id: 'n-cohort-3',
        name: '无期次的期次节点',
        kind: 'program_cohort',
      }),
    ).rejects.toEqual(violation('23514', 'programs_program_node_cohort'));
  });
});
