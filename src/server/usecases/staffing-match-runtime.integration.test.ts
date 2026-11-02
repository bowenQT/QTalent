import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client';
import { importDemo } from '../db/import';
import { mapPrototypeSeed, readPrototypeSeed } from '../db/seed';
import { events } from '../modules/records';
import { createStaffingMatchEvidenceLoader } from './staffing-match';
import { readStaffingMatchConfirmations } from './staffing-match-confirmations';
import { projectReadableSources } from './source-projection';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name =
  'qtalent_match_runtime_' + randomUUID().replaceAll('-', '') + '_test';
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL requires TEST_DATABASE_URL');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Integration database must be loopback and end _test');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  await importDemo(
    connection.db,
    mapPrototypeSeed(readPrototypeSeed(process.cwd())),
    'Synthetic-test-password-only',
  );
}, 60_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});

it('the real loader confirms every seed event and projects their sources in one snapshot', async () => {
  const db = connection!.db;
  const load = createStaffingMatchEvidenceLoader({
    db,
    readConfirmations: readStaffingMatchConfirmations,
    projectSources: projectReadableSources,
  });
  const hr = await load('demo-hrbp', '2026-10-25');
  // #341: every seed statement quotes a sheet cell, so all 277 events are facts.
  expect(hr.confirmations).toHaveLength(277);
  expect(
    hr.confirmations.every(
      (fact) =>
        fact.active &&
        fact.state === 'confirmed' &&
        fact.nature === 'original_fact' &&
        fact.confirmation.kind === 'prototype_baseline',
    ),
  ).toBe(true);
  expect(new Set(hr.confirmations.map((fact) => fact.personId)).size).toBe(93);
  expect(hr.sources.length).toBeGreaterThan(0);
  expect(
    hr.sources.every(
      (source) => source.sourceCategory === 'prototype_baseline' && source.demo,
    ),
  ).toBe(true);
  // A withdrawn event keeps its fact but is no longer active.
  const [first] = hr.confirmations;
  await db
    .update(events)
    .set({ withdrawnAt: new Date('2026-10-20T00:00:00.000Z') })
    .where(eq(events.id, first!.recordId));
  const after = await load('demo-hrbp', '2026-10-25');
  expect(
    after.confirmations.find((fact) => fact.recordId === first!.recordId),
  ).toMatchObject({ active: false });
}, 60_000);
