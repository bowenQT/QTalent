import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client';
import * as directory from '../modules/directory/schema';
import * as programs from '../modules/programs/schema';
import * as rules from '../modules/evaluation-system/schema';
import * as records from '../modules/records/schema';
import * as talent from '../modules/talent/schema';
import {
  loadPersonData,
  eventSubject,
  historicalSubject,
  talentSources,
} from './person-data';
import { sourceFromData } from './sources';
import { personFromData } from './person-projection';
import { buildAuthorizedModelInput, type TalentSubject } from '../authz/talent';
import { nodeFixture } from './person-test-helpers';

const database = `qtalent_node_reads_${randomUUID().replaceAll('-', '')}_test`;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const db = () => connection!.db;
const ref = { fragmentId: 'fragment-0', originalVersionId: 'version' };
const time = '2026-07-01T11:59:59.999Z';
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'BOW-899 real node reads require TEST_DATABASE_URL; no skips',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error(
      'Only the authorized loopback isolated test database is allowed',
    );
  admin = new Pool({ connectionString: source, max: 3 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      await admin.end();
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql.raw(
      'TRUNCATE directory_organizations, programs_cohorts, evaluation_rule_versions, evaluation_dimensions, records_originals, audit_events CASCADE',
    ),
  );
  const data = nodeFixture();
  await db()
    .insert(directory.organizations)
    .values(data.directory.organizations);
  await db().insert(directory.people).values(data.directory.people);
  await db().insert(directory.accountBindings).values({
    accountId: data.context.account.id,
    personId: data.context.account.personId,
    isSystemAdmin: false,
  });
  await db().insert(programs.cohorts).values(data.cohorts);
  await db().insert(directory.grants).values(data.directory.grants);
  await db()
    .insert(programs.enrollments)
    .values(
      data.context.enrollments.map((row, i) => ({ ...row, id: 'enrol-' + i })),
    );
  await db()
    .insert(programs.assignments)
    .values(
      data.context.assignments.map((row, i) => ({
        ...row,
        id: 'assignment-' + i,
      })),
    );
  await db()
    .insert(programs.evaluationNodes)
    .values(
      data.context.evaluationNodes!.map((node) => ({
        ...node,
        name: '演示：' + node.id,
      })),
    );
  await db()
    .insert(programs.evaluationNodeSubjects)
    .values(data.context.evaluationNodeSubjects!);
  await db()
    .insert(programs.evaluationRelations)
    .values(data.context.evaluationRelations!);
  await db().insert(rules.ruleVersions).values({
    id: 'rubric-v1',
    provenance: 'demo_import_snapshot',
    sourceCommit: '2e51b50',
  });
  await db().insert(rules.dimensions).values(data.dimensions);
  await db().insert(rules.anchors).values(data.anchors);
  await db().insert(records.originals).values(data.originals);
  await db().insert(records.originalVersions).values(data.versions);
  await db().insert(records.fragments).values(data.fragments);
  await db().insert(records.events).values(data.events);
  await db().insert(records.eventSources).values(data.eventSources);
  await db().insert(records.statements).values(data.statements);
  await db().insert(talent.confirmations).values(data.confirmations);
});
const read = (now = time) => loadPersonData(db(), 'account', now);
async function model(
  data: Awaited<ReturnType<typeof read>>,
  subject: TalentSubject,
  source = ref,
) {
  return buildAuthorizedModelInput(async () => ({
    context: data.context,
    sources: talentSources(data),
    records: [
      {
        id: 'derived',
        subject,
        kind: 'evaluation',
        fields: [
          {
            name: 'text',
            kind: 'evaluation',
            value: '演示：当前原文',
            subjects: [],
            sources: [source],
          },
        ],
      },
    ],
  }));
}
it('loads all three current node arrays and keeps the project-less event node through profile, source and model', async () => {
  const data = await read();
  expect(data.context.evaluationNodes).toHaveLength(2);
  expect(data.context.evaluationNodeSubjects).toHaveLength(2);
  expect(data.context.evaluationRelations).toHaveLength(1);
  const subject = eventSubject(data, data.events[0]);
  expect(subject).toMatchObject({
    evaluationNodeId: 'node-current',
    cohortId: 'cohort',
  });
  expect(await sourceFromData(data, ref)).toHaveProperty('status', 'success');
  expect(await personFromData(data, 'one')).toHaveProperty(
    'capabilityProfile.data.scores.length',
    4,
  );
  expect(await personFromData(data, 'one')).toHaveProperty(
    'asOf',
    '2026-07-01',
  );
  expect(await model(data, subject)).toHaveProperty('items.length', 1);
});
it('re-reads exact expiry and revocation instead of falling back to the still-current cohort assignment', async () => {
  const end = '2026-07-01T12:00:00.000Z';
  await db()
    .update(programs.evaluationRelations)
    .set({ validTo: end })
    .where(eq(programs.evaluationRelations.id, 'relation-current'));
  expect(await sourceFromData(await read(), ref)).toHaveProperty(
    'status',
    'success',
  );
  const expired = await read(end);
  expect(expired.context.assignments).toHaveLength(1);
  expect(await personFromData(expired, 'one')).toBeNull();
  expect(await sourceFromData(expired, ref)).toHaveProperty(
    'status',
    'not_found',
  );
  expect(
    await model(expired, eventSubject(expired, expired.events[0])),
  ).toEqual({ items: [] });
  await db()
    .update(programs.evaluationRelations)
    .set({ validTo: null, revokedAt: time })
    .where(eq(programs.evaluationRelations.id, 'relation-current'));
  expect(await sourceFromData(await read(), ref)).toHaveProperty(
    'status',
    'not_found',
  );
});
it('authorizes every contributor of a shared source against its own persisted node', async () => {
  await db()
    .update(records.events)
    .set({ evaluationNodeId: 'node-other' })
    .where(eq(records.events.id, 'event-1'));
  await db()
    .insert(records.eventSources)
    .values({ eventId: 'event-1', ...ref });
  const hidden = await read();
  expect(await sourceFromData(hidden, ref)).toHaveProperty(
    'status',
    'not_found',
  );
  expect(await model(hidden, eventSubject(hidden, hidden.events[0]))).toEqual({
    items: [],
  });
  expect(JSON.stringify(await personFromData(hidden, 'one'))).not.toContain(
    'fragment-0',
  );
  await db().insert(programs.evaluationRelations).values({
    id: 'other',
    evaluationNodeId: 'node-other',
    personId: 'one',
    evaluatorId: 'actor',
    kind: 'judge',
    validFrom: '2026-01-01T00:00:00.000Z',
  });
  expect(await sourceFromData(await read(), ref)).toHaveProperty(
    'status',
    'success',
  );
});
it('keeps unknown history closed and permits an explicit restricted review only for its current exact judge', async () => {
  const historyRef = {
    fragmentId: 'review-fragment',
    originalVersionId: 'version',
  };
  await db()
    .insert(records.fragments)
    .values({
      id: historyRef.fragmentId,
      originalVersionId: historyRef.originalVersionId,
      excerpt: '演示：原量表',
      location: { kind: 'snapshot_field', fieldPath: 'review.scale' },
    });
  await db()
    .insert(records.historicalEvaluations)
    .values({
      id: 'review',
      sourceRecordId: 'review',
      personId: 'one',
      recorderId: 'actor',
      occurredOn: '2026-06-01',
      kind: '结营评审',
      scale: [['结论', '演示：原值不改']],
      sourceCategory: 'prototype_baseline',
      ...historyRef,
    });
  await db()
    .insert(records.historicalParticipants)
    .values({ evaluationId: 'review', personId: 'one' });
  expect(await sourceFromData(await read(), historyRef)).toHaveProperty(
    'status',
    'not_found',
  );
  await db()
    .update(records.historicalEvaluations)
    .set({ evaluationNodeId: 'node-other' })
    .where(eq(records.historicalEvaluations.id, 'review'));
  expect(await sourceFromData(await read(), historyRef)).toHaveProperty(
    'status',
    'not_found',
  );
  await db().insert(programs.evaluationRelations).values({
    id: 'reviewer',
    evaluationNodeId: 'node-other',
    personId: 'one',
    evaluatorId: 'actor',
    kind: 'judge',
    validFrom: '2026-01-01T00:00:00.000Z',
  });
  const visible = await read();
  expect(await sourceFromData(visible, historyRef)).toHaveProperty(
    'status',
    'success',
  );
  expect((await personFromData(visible, 'one'))?.timeline).toMatchObject({
    status: 'ready',
    data: expect.arrayContaining([
      {
        kind: 'history',
        id: 'review',
        title: '结营评审',
        occurredOn: '2026-06-01',
        label: 'history',
        category: 'restricted-evaluation',
        sources: expect.any(Array),
        scale: [['结论', '演示：原值不改']],
      },
    ]),
  });
  expect(
    await model(
      visible,
      historicalSubject(visible, visible.historical[0], 'one'),
      historyRef,
    ),
  ).toHaveProperty('items.length', 1);
  await db()
    .update(programs.evaluationRelations)
    .set({ revokedAt: time })
    .where(eq(programs.evaluationRelations.id, 'reviewer'));
  const revoked = await read();
  expect(await sourceFromData(revoked, historyRef)).toHaveProperty(
    'status',
    'not_found',
  );
  expect(
    await model(
      revoked,
      historicalSubject(revoked, revoked.historical[0], 'one'),
      historyRef,
    ),
  ).toEqual({ items: [] });
  expect(revoked.historical[0].scale).toEqual([['结论', '演示：原值不改']]);
});
