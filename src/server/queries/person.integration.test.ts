import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import { cohorts, enrollments, assignments } from '../modules/programs';
import {
  originals,
  originalVersions,
  fragments,
  events,
  eventSources,
  eventParticipants,
  statements,
} from '../modules/records';
import { dimensions, anchors, ruleVersions } from '../modules/evaluation-system';
import { confirmations, aiSuggestions } from '../modules/talent';
import { loadPersonData } from './person-data';
import { personFromData } from './person-projection';
import { peopleFromData } from './people';
import { sourceFromData } from './sources';
import { fixture } from './person-test-helpers';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = 'qtalent_reads_' + randomUUID().replaceAll('-', '') + '_test';
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
  const db = connection.db;
  const data = fixture();
  await db.insert(organizations).values(data.directory.organizations);
  await db.insert(people).values(data.directory.people);
  await db.insert(cohorts).values({ id: 'cohort', name: 'Synthetic cohort' });
  await db.insert(enrollments).values({
    ...data.context.enrollments[0],
    id: 'enrollment',
  });
  await db.insert(assignments).values({
    ...data.context.assignments[0],
    id: 'assignment',
  });
  for (const role of ['manager', 'hr', 'mentor', 'admin'] as const) {
    await db.insert(accountBindings).values({
      accountId: role,
      personId: 'actor',
      isSystemAdmin: role === 'admin',
    });
    const grant = fixture(role).context.grants[0];
    await db.insert(grants).values({
      ...grant,
      id: role,
      accountId: role,
    });
  }
  await db.insert(ruleVersions).values({
    id: 'rubric-v1',
    provenance: 'demo_import_snapshot',
    sourceCommit: '2e51b50',
  });
  await db.insert(dimensions).values(data.dimensions);
  await db.insert(anchors).values(data.anchors);
  await db.insert(originals).values(data.originals);
  await db.insert(originalVersions).values(data.versions);
  await db.insert(fragments).values(data.fragments);
  await db.insert(events).values(data.events);
  await db.insert(eventSources).values(data.eventSources);
  await db.insert(statements).values(data.statements);
  await db.insert(confirmations).values(data.confirmations);
  await db.insert(aiSuggestions).values({
    id: 'ai-only',
    eventId: 'event-0',
    dimensionId: 'grit',
    ruleVersionId: 'rubric-v1',
    sourceCategory: 'prototype_baseline',
    modelVersion: 'synthetic-model',
    status: 'scored',
    value: 4,
    anchorId: 'grit',
    fragmentId: 'fragment-0',
    originalVersionId: 'version',
    rationale: 'Synthetic suggestion, never a confirmed score',
  });
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
it('reads actual PostgreSQL confirmation and evidence tables for four accounts', async () => {
  const db = connection!.db;
  for (const role of ['manager', 'hr', 'mentor']) {
    const data = await loadPersonData(db, role, '2026-07-01');
    const result = await personFromData(data, 'one');
    expect(result?.capabilityProfile).toHaveProperty('data.length', 4);
    const list = await peopleFromData(data);
    expect(list.total).toBe(role === 'manager' ? 3 : 1);
    if (role === 'mentor') {
      expect(result).not.toHaveProperty('referencePosition');
      expect(result).not.toHaveProperty('managementObservations');
    } else {
      expect(result).toHaveProperty('referencePosition.status', 'ready');
      expect(result).toHaveProperty('versionsAndChanges.status', 'not_connected');
    }
  }
  await expect(loadPersonData(db, 'admin', '2026-07-01')).rejects.toThrow('无权限');
  await expect(loadPersonData(db, 'missing', '2026-07-01')).rejects.toThrow('无权限');
});
it('re-reads authorization and complete source relationships', async () => {
  const db = connection!.db;
  await db.insert(eventParticipants).values({
    eventId: 'event-0',
    personId: 'two',
  });
  const data = await loadPersonData(db, 'mentor', '2026-07-01');
  const source = await sourceFromData(data, {
    fragmentId: 'fragment-0',
    originalVersionId: 'version',
  });
  expect(source.status).toBe('not_found');
  const result = await personFromData(data, 'one');
  expect(result?.capabilityProfile).toHaveProperty('data.length', 2);
  await db.update(grants).set({ revokedAt: '2026-07-01' }).where(eq(grants.id, 'mentor'));
  const revoked = await loadPersonData(db, 'mentor', '2026-07-01');
  expect(await personFromData(revoked, 'one')).toBeNull();
});
