import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exampleQueue, registerExampleJob } from './example';
let admin: Pool;
let boss: PgBoss;
const database = `qtalent_jobs_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection)
    throw new Error('TEST_DATABASE_URL required for real pg-boss integration');
  const url = new URL(connection);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Only isolated local test databases are allowed');
  admin = new Pool({
    connectionString: connection,
    connectionTimeoutMillis: 3000,
  });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = `/${database}`;
  boss = new PgBoss({ connectionString: url.toString() });
  await boss.start();
  await registerExampleJob(boss);
}, 30000);
afterAll(async () => {
  if (boss) await boss.stop();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
it('persists and executes an actual PostgreSQL-backed job', async () => {
  const id = await boss.send(exampleQueue, { message: 'isolated-integration' });
  expect(id).toBeTruthy();
  await expect
    .poll(async () => (await boss.getJobById(exampleQueue, id!))?.state, {
      timeout: 15000,
      interval: 200,
    })
    .toBe('completed');
}, 20000);
