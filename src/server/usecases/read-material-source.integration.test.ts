import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi, afterEach } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import {
  materialSourceReadResultSchema,
  type MaterialSourceLocation,
} from '../../contracts/sources';
import {
  originals,
  originalVersions,
  eventSources,
  eventParticipants,
  events,
  historicalEvaluations,
  statements,
  arrangeInputs,
} from '../modules/records';
import { accountBindings } from '../modules/directory';
import { evaluationRelations } from '../modules/programs';
import { writeMaterialParse } from '../modules/records/material-sources/store';
import { jobSnapshots } from '../jobs/schema';
import { newJob } from '../jobs/state';
import { auditEvents } from '../platform/audit/schema';
import * as audit from '../platform/audit';
import {
  seedRecordCase,
  seedRecordRules,
  businessNow,
} from '../../../tests/fixtures/bow-846/native';
import { readMaterialSource } from './read-material-source';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase>;
const database =
  'qtalent_material_reader_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection.db;
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('TEST_DATABASE_URL required; no skip or fake PG');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Dedicated test database required');
  admin = new Pool({ connectionString: raw, max: 2 });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.QTALENT_926_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  await seedRecordRules(db());
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
}, 30000);
const locations: MaterialSourceLocation[] = [
  { kind: 'pdf', page: 1, textRange: { start: 1, end: 3 } },
  { kind: 'presentation', slide: 2 },
  { kind: 'video', startMs: 10, endMs: 20 },
  { kind: 'image', region: { left: 0, top: 0.2, right: 0.8, bottom: 1 } },
  {
    kind: 'code',
    repository: '演示仓库',
    commit: 'a'.repeat(40),
    path: 'src/demo.ts',
    startLine: 1,
    endLine: 2,
  },
];
async function setup(location = locations[0]) {
  const f = await seedRecordCase(db());
  const originalId = f.id + '-material-original';
  const originalVersionId = f.id + '-material-version';
  const fragmentId = f.id + '-material-fragment';
  const contentDigest = createHash('sha256')
    .update('synthetic bytes')
    .digest('hex');
  await db()
    .insert(originals)
    .values({ id: originalId, title: '演示材料', kind: 'original' });
  await db()
    .insert(originalVersions)
    .values({ id: originalVersionId, originalId, version: 1, contentDigest });
  const job = {
    ...newJob(
      {
        jobId: f.id + '-parse-job',
        kind: 'media',
        resourceId: originalId,
        inputVersion: originalVersionId,
      },
      businessNow,
    ),
    status: 'running' as const,
  };
  await db().insert(jobSnapshots).values(job);
  const source = {
    fragmentId,
    originalVersionId,
    location,
    excerpt: location.kind === 'pdf' ? '😀' : '演示原文',
    demo: true,
    sourceCategory:
      location.kind === 'code' ? 'submitted_code_snapshot' : 'original',
    ...(location.kind === 'code' ? { displayNotice: '提交的代码快照' } : {}),
  };
  await db().transaction((tx) =>
    writeMaterialParse(
      tx,
      {
        binding: {
          parseVersionId: f.id + '-parse',
          originalVersionId,
          contentDigest,
          parserVersion: 'synthetic-v1',
          projectionVersion: 'synthetic-location-v1',
        },
        pages:
          location.kind === 'pdf'
            ? [
                { page: 1, text: '演😀示' },
                { page: 2, text: '' },
              ]
            : [],
        fragments: [source],
      },
      {
        jobId: job.jobId,
        attempt: job.attempt,
        expectedRevision: job.revision,
        inputVersion: originalVersionId,
      },
    ),
  );
  const reference = { fragmentId, originalVersionId };
  await db()
    .insert(eventSources)
    .values({ eventId: f.sourceEventId, ...reference });
  return { ...f, source, reference, originalId, job };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const read = (f: Fixture, account = f.account.one, now = businessNow) =>
  readMaterialSource(db(), account, f.reference, () => now);
async function expectHidden(f: Fixture) {
  const result = await read(f);
  expect(result).toEqual({
    status: 'not_found',
    message: '来源不存在或不可见',
  });
  expect(result).not.toHaveProperty('source');
}
it.each(locations)(
  'reads canonical $kind through current full graph and records exact reference audit',
  async (location) => {
    const f = await setup(location);
    expect(await read(f)).toEqual(
      materialSourceReadResultSchema.parse({
        status: 'success',
        source: f.source,
      }),
    );
    const rows = await db()
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.resourceId,
          JSON.stringify([
            f.reference.fragmentId,
            f.reference.originalVersionId,
          ]),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBe(f.account.one);
  },
);
it('hidden shared subject, including a withdrawn event, suppresses all content', async () => {
  const f = await setup();
  expect((await read(f)).status).toBe('success');
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.sourceEventId, personId: f.person.two });
  await db()
    .update(events)
    .set({ withdrawnAt: new Date(businessNow) })
    .where(eq(events.id, f.sourceEventId));
  await expectHidden(f);
});
it('unknown historical classification cannot be rescued by a readable event', async () => {
  const f = await setup();
  await db()
    .insert(historicalEvaluations)
    .values({
      id: f.id + '-history',
      personId: f.person.one,
      evaluationNodeId: f.node,
      kind: '未知材料类别',
      sourceCategory: 'prototype_baseline',
      sourceRecordId: f.id + '-history-record',
      recorderId: f.person.manager,
      occurredOn: '2026-10-01',
      scale: [['演示维度', '原始尺度']],
      ...f.reference,
    });
  await expectHidden(f);
});
it('unlinked material is not authorized by its existence, requester or original title', async () => {
  const f = await setup();
  await db()
    .delete(eventSources)
    .where(eq(eventSources.fragmentId, f.reference.fragmentId));
  await expectHidden(f);
});
it.each(['revoke', 'expire', 'rebind'] as const)(
  'reloads current authority on repeated reads after %s',
  async (mode) => {
    const f = await setup();
    expect((await read(f)).status).toBe('success');
    if (mode === 'revoke')
      await db()
        .update(evaluationRelations)
        .set({ revokedAt: businessNow })
        .where(eq(evaluationRelations.id, f.relationOne));
    if (mode === 'expire')
      await db()
        .update(evaluationRelations)
        .set({ validTo: businessNow })
        .where(eq(evaluationRelations.id, f.relationOne));
    if (mode === 'rebind')
      await db()
        .update(accountBindings)
        .set({ personId: f.person.outsider })
        .where(eq(accountBindings.accountId, f.account.one));
    await expectHidden(f);
  },
);
it('a required management-observation restriction is retained', async () => {
  const f = await setup();
  await db()
    .insert(statements)
    .values({
      id: f.id + '-observation',
      eventId: f.sourceEventId,
      kind: 'management_observation',
      text: '演示观察',
      ...f.reference,
    });
  await expectHidden(f);
});
it('unknown identity and admin-only identity do not read sources', async () => {
  const f = await setup();
  for (const account of ['unknown-account', f.account.admin])
    expect((await read(f, account)).status).toBe('forbidden');
});
it('mismatched original version and corrupt stored binding fail closed', async () => {
  const f = await setup();
  expect(
    (
      await readMaterialSource(
        db(),
        f.account.one,
        { ...f.reference, originalVersionId: f.versionId },
        () => businessNow,
      )
    ).status,
  ).toBe('not_found');
  await db()
    .update(originalVersions)
    .set({ contentDigest: 'b'.repeat(64) })
    .where(eq(originalVersions.id, f.reference.originalVersionId));
  await expectHidden(f);
});
it('audit failure rolls back and never returns material or raw SQL errors', async () => {
  const f = await setup();
  vi.spyOn(audit, 'recordAudit').mockRejectedValue(
    new Error('private SQL details'),
  );
  expect(await read(f)).toEqual({
    status: 'conflict',
    message: '来源暂时不可用，请稍后重试',
  });
  expect(
    await db()
      .select()
      .from(auditEvents)
      .where(
        eq(
          auditEvents.resourceId,
          JSON.stringify([
            f.reference.fragmentId,
            f.reference.originalVersionId,
          ]),
        ),
      ),
  ).toHaveLength(0);
});
it('invalid extra locator is rejected before opening a transaction', async () => {
  const f = await setup();
  const spy = vi.spyOn(db(), 'transaction');
  expect(
    (
      await readMaterialSource(db(), f.account.one, {
        ...f.reference,
        location: locations[0],
      })
    ).status,
  ).toBe('validation_error');
  expect(spy).not.toHaveBeenCalled();
});

it("another creator's attachment intake remains a restriction even when another creator linked a readable event", async () => {
  const f = await setup();
  await db()
    .insert(arrangeInputs)
    .values({
      id: f.id + '-attachment-intake',
      creatorAccountId: f.account.outsider,
      jobId: f.job.jobId,
      inputVersion: f.reference.originalVersionId,
      batchId: f.id + '-attachment-batch',
      evaluationNodeId: f.node,
      boundAt: new Date(businessNow),
      occurredOn: '2026-10-01',
      origin: 'attachment',
      originalInput: {
        operation_id: f.id + '-input-operation',
        personId: null,
        projectId: null,
        text: '演示附件输入',
        attachmentIds: [f.originalId],
      },
      inputSource: f.reference,
      sourceContexts: [
        {
          ...f.reference,
          subjects: [
            {
              personId: f.person.two,
              evaluationNodeId: f.node,
              cohortId: f.id + '-cohort',
            },
          ],
          attributedPersonIds: [f.person.one],
          kind: 'evaluation',
          requiredKinds: [],
        },
      ],
      personIds: [f.person.one],
      projectMode: 'none',
      projectId: null,
      projectCandidateIds: [],
      createdAt: new Date(businessNow),
    });
  // The new reader does not filter intake by actor or AI attributedPersonIds.
  // Unknown media provenance remains unavailable until its native producer lands.
  await expectHidden(f);
});
