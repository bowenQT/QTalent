import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../../src/server/db/client';
import { grants } from '../../../src/server/modules/directory';
import { auditEvents } from '../../../src/server/platform/audit/schema';
import {
  historicalEvaluations,
  fragments,
  events,
} from '../../../src/server/modules/records';
import { confirmations } from '../../../src/server/modules/talent';
import {
  interviewImportRows,
  interviewImportOperations,
} from '../../../src/server/modules/records/interview-import/schema';
import { confirmInterviewImportRow } from '../../../src/server/usecases/interview-import/store';
import { readMaterialSource } from '../../../src/server/usecases/read-material-source';
import { loadPersonData } from '../../../src/server/queries/person-data';
import { personFromData } from '../../../src/server/queries/person-projection';
import { personInterviewArchiveFromData } from '../../../src/server/queries/person-interviews';
import { nativeDatabase } from '../../fixtures/bow-845/native';
import { seedInterviewBusinessCase } from './business-fixtures';

const now = '2026-11-01T12:00:00.000Z';
let connection: Awaited<ReturnType<typeof nativeDatabase>>;
let facts: Awaited<ReturnType<typeof seedInterviewBusinessCase>>;
const pools: ReturnType<typeof createDatabase>[] = [];
beforeEach(async () => {
  connection = await nativeDatabase();
  facts = await seedInterviewBusinessCase(connection.db);
}, 60_000);
afterEach(async () => {
  for (const extra of pools.splice(0)) await extra.pool.end();
  await connection?.close();
}, 30_000);

const command = (expectedRevision: number, ok: boolean) => ({
  batchId: facts.batchId,
  rowId: facts.rowId,
  expectedRevision,
  ok,
});
async function snapshot() {
  const db = connection.db;
  return {
    historical: await db
      .select()
      .from(historicalEvaluations)
      .where(eq(historicalEvaluations.personId, facts.personId))
      .orderBy(historicalEvaluations.id),
    rows: await db
      .select()
      .from(interviewImportRows)
      .where(eq(interviewImportRows.batchId, facts.batchId))
      .orderBy(interviewImportRows.rowId),
    operations: await db
      .select()
      .from(interviewImportOperations)
      .where(eq(interviewImportOperations.batchId, facts.batchId))
      .orderBy(interviewImportOperations.id),
    audit: await db
      .select()
      .from(auditEvents)
      .where(sql`${auditEvents.action} like 'interview_import.%'`)
      .orderBy(auditEvents.id),
    fragments: await db.select().from(fragments).orderBy(fragments.id),
    events: await db.select().from(events).orderBy(events.id),
    confirmations: await db
      .select()
      .from(confirmations)
      .orderBy(confirmations.id),
  };
}
async function reconstructed(accountId = facts.hr) {
  const fresh = createDatabase(connection.testUrl);
  pools.push(fresh);
  const data = await loadPersonData(fresh.db, accountId, now);
  return {
    db: fresh.db,
    person: await personFromData(data, facts.personId),
    interviewArchive: await personInterviewArchiveFromData(
      data,
      facts.personId,
    ),
  };
}

it('HR confirmation persists a distinct interview archive and readable PDF source across new DB pools; undo hides it without erasing history', async () => {
  const before = await snapshot();
  expect(before.historical).toEqual([]);
  const initialProfile = await reconstructed();
  expect(initialProfile.interviewArchive).toEqual({ status: 'empty' });
  expect(initialProfile.person).not.toBeNull();
  const confirmed = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(1, true),
    { now, at: now },
  );
  expect(confirmed.status).toBe('ok');
  if (confirmed.status !== 'ok')
    throw new Error('HR confirmation must archive');
  const written = await snapshot();
  expect(written.historical).toHaveLength(1);
  expect(written.operations).toHaveLength(1);
  expect(written.operations[0]).toMatchObject({
    actorAccountId: facts.hr,
    action: 'confirm',
  });
  expect(written.events).toEqual(before.events);
  expect(written.confirmations).toEqual(before.confirmations);
  expect(written.rows.map((row) => row.parsed)).toEqual(
    before.rows.map((row) => row.parsed),
  );
  const reloaded = await reconstructed();
  expect(reloaded.interviewArchive).toMatchObject({ status: 'ready' });
  if (reloaded.interviewArchive?.status !== 'ready')
    throw new Error('Persisted interview absent from profile projection');
  expect(reloaded.interviewArchive.data).toHaveLength(1);
  const entry = reloaded.interviewArchive.data[0]!;
  expect(entry).toMatchObject({
    kind: 'interview',
    interviewerName: '任辞远（演示）',
    importedByName: '苏晚（演示）',
    importedAt: now,
    interviewerConfirmedInSystem: false,
  });
  expect(entry.scale).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        item: '专业能力',
        value: '2',
        origin: 'parser',
      }),
      expect.objectContaining({ item: '潜力', value: '4', origin: 'parser' }),
      expect.objectContaining({
        item: '沟通协作',
        value: '3',
        origin: 'parser',
      }),
    ]),
  );
  expect(entry.sources.length).toBeGreaterThan(0);
  expect(
    entry.sources.every((reference) => reference.location.kind === 'pdf'),
  ).toBe(true);
  expect(reloaded.person?.capabilityProfile).toEqual(
    initialProfile.person?.capabilityProfile,
  );
  expect(reloaded.person?.role).toBe('hr');
  if (reloaded.person?.role === 'hr' && initialProfile.person?.role === 'hr')
    expect(reloaded.person.referencePosition).toEqual(
      initialProfile.person.referencePosition,
    );
  const historical = written.historical[0]!;
  expect(historical.recorderId).toBe('s-01');
  expect(entry.id).toBe(historical.id);
  expect(entry.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        fragmentId: historical.fragmentId,
        originalVersionId: historical.originalVersionId,
      }),
    ]),
  );
  expect(historical.scale).toEqual(
    expect.arrayContaining([
      ['专业能力', '2'],
      ['潜力', '4'],
      ['沟通协作', '3'],
    ]),
  );
  const source = await readMaterialSource(
    reloaded.db,
    facts.hr,
    {
      fragmentId: historical.fragmentId,
      originalVersionId: historical.originalVersionId,
    },
    () => now,
  );
  expect(source.status).toBe('success');
  if (source.status !== 'success')
    throw new Error('Archive must resolve its canonical source');
  expect(JSON.stringify(source)).toContain(historical.fragmentId);

  const same = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(1, true),
    { now, at: now },
  );
  expect(same).toEqual(confirmed);
  expect(await snapshot()).toEqual(written);
  const undone = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(confirmed.revision, false),
    { now, at: now },
  );
  expect(undone.status).toBe('ok');
  expect((await reconstructed()).interviewArchive).toEqual({ status: 'empty' });
  const after = await snapshot();
  expect(after.historical).toEqual(written.historical);
  expect(after.fragments).toEqual(written.fragments);
  expect(after.operations).toHaveLength(written.operations.length + 1);
  expect(after.rows.map((row) => row.parsed)).toEqual(
    before.rows.map((row) => row.parsed),
  );
  expect(after.events).toEqual(before.events);
  expect(after.confirmations).toEqual(before.confirmations);
}, 60_000);

it('a genuine same-node evaluator and the employee cannot inherit HR import or interview visibility', async () => {
  const confirmed = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(1, true),
    { now, at: now },
  );
  expect(confirmed.status).toBe('ok');
  const before = await snapshot();
  const historical = before.historical[0]!;
  for (const accountId of [facts.evaluator, facts.employee]) {
    const result = await confirmInterviewImportRow(
      connection.db,
      accountId,
      command(1, true),
      { now, at: now },
    );
    expect(result.status).toBe('forbidden');
    const view = await reconstructed(accountId);
    expect(view.interviewArchive).toBeUndefined();
    const source = await readMaterialSource(
      view.db,
      accountId,
      {
        fragmentId: historical.fragmentId,
        originalVersionId: historical.originalVersionId,
      },
      () => now,
    );
    expect(source.status).not.toBe('success');
    expect(JSON.stringify(source)).not.toContain(
      before.fragments.find(
        (fragment) => fragment.id === historical.fragmentId,
      )!.excerpt,
    );
  }
  expect(await snapshot()).toEqual(before);
}, 60_000);

it('revoked HR authority is re-read for stale confirmation and source access after reconstruction, without rewriting the original archive', async () => {
  const confirmed = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(1, true),
    { now, at: now },
  );
  expect(confirmed.status).toBe('ok');
  const before = await snapshot();
  await connection.db
    .update(grants)
    .set({ revokedAt: now })
    .where(eq(grants.id, facts.hrGrantId));
  const denied = await confirmInterviewImportRow(
    connection.db,
    facts.hr,
    command(1, true),
    { now, at: now },
  );
  expect(denied.status).toBe('forbidden');
  const reloaded = await reconstructed();
  expect(reloaded.interviewArchive).toBeUndefined();
  const historical = before.historical[0]!;
  const source = await readMaterialSource(
    reloaded.db,
    facts.hr,
    {
      fragmentId: historical.fragmentId,
      originalVersionId: historical.originalVersionId,
    },
    () => now,
  );
  expect(source.status).not.toBe('success');
  expect(JSON.stringify(source)).not.toContain(
    before.fragments.find((fragment) => fragment.id === historical.fragmentId)!
      .excerpt,
  );
  expect(await snapshot()).toEqual(before);
}, 60_000);
