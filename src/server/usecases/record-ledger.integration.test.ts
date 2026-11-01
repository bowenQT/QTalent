import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase, type Transaction } from '../db/client';
import {
  recordOperations,
  recordSaves,
  events,
  statements,
  eventParticipants,
  arrangeInputs,
  fragments,
  originalVersions,
} from '../modules/records';
import { confirmations, scoreReviews } from '../modules/talent';
import { evaluationRelations } from '../modules/programs';
import { jobSnapshots } from '../jobs/schema';
import * as audit from '../platform/audit';
import { buildAuthorizedModelInput } from '../authz/talent';
import { readLockedRecordLedger } from './record-ledger';
import { saveRecordDraft, undoRecordSave } from './record-save';
import {
  seedRecordRules,
  seedRecordCase,
  businessNow,
} from '../../../tests/fixtures/bow-846/native';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const database =
  'qtalent_record_ledger_' + randomUUID().replaceAll('-', '') + '_test';
const db = () => connection!.db;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL is required; no skips');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Only the dedicated local test database is allowed');
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${database}"`);
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });
  await seedRecordRules(db());
}, 30000);
afterEach(() => vi.restoreAllMocks());
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
type Fixture = Awaited<ReturnType<typeof seedRecordCase>>;
const read = (f: Fixture, tx?: Transaction) => {
  const query = (transaction: Transaction) =>
    readLockedRecordLedger(
      transaction,
      { evaluationNodeId: f.node, personId: f.person.one },
      { accountId: f.account.one, now: () => businessNow },
    );
  return tx ? query(tx) : db().transaction(query);
};
async function saved() {
  const f = await seedRecordCase(db());
  const result = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  return { f, result };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function waiting(name: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await connection!.pool.query<{ waiting: boolean }>(
      "select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=$1 and wait_event_type='Lock') as waiting",
      [name],
    );
    if (result.rows[0].waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected real PostgreSQL lock wait');
}
async function namedRead(f: Fixture, name: string) {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select set_config('application_name', ${name}, true)`);
    return read(f, tx);
  });
}
// The actual save/undo transaction performs all SQL and audit writes. Only its
// last pre-commit scheduling point is held; no permissions or facts are mocked.
function holdAudit() {
  const reached = gate(),
    release = gate();
  const real = audit.recordAudit;
  vi.spyOn(audit, 'recordAudit').mockImplementationOnce(async (...args) => {
    await real(...args);
    reached.resolve();
    await release.promise;
  });
  return { reached, release };
}

it('reads actual save, exact actor/operation/score identity and current mapping without inventing nature or readiness', async () => {
  const { f, result } = await saved();
  const ledger = await read(f);
  const item = ledger.events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(item.provenance).toEqual({
    availability: 'available',
    fact: 'native_save_ledger',
  });
  expect(item.mapping).toMatchObject({
    batchId: f.draft.batchId,
    draftId: f.draft.draftId,
    personId: f.person.one,
  });
  expect(item.saves[0].proof).toMatchObject({
    availability: 'available',
    fact: {
      acceptedRevision: 1,
      actorAccountId: f.account.one,
      actorPersonId: f.person['rater-one'],
      operationId: f.input.operation_id,
      confirmationIds: result.result.confirmationIds,
    },
  });
  expect(item.confirmations[0]).toMatchObject({
    row: {
      id: result.result.confirmationIds[0],
      evaluatorId: f.person['rater-one'],
      revision: 1,
      confirmedAt: new Date(result.result.savedAt),
      active: true,
      value: 3,
    },
    ownership: { availability: 'available', fact: result.result.saveId },
  });
  expect(item.sources.availability).toBe('available');
  expect(item.nature).toEqual({
    availability: 'unavailable',
    reason: 'nature_not_recorded',
  });
  expect(ledger).not.toHaveProperty('ready');
  expect(ledger.revision).toBe((await read(f)).revision);
  // A pre-existing source event is not a verified human save just because it
  // is active and shares the same person/node/fragment.
  expect(
    ledger.events.find((row) => row.event.id === f.sourceEventId)!.provenance
      .availability,
  ).toBe('unavailable');
  expect(
    (
      await db().transaction((tx) =>
        readLockedRecordLedger(
          tx,
          { evaluationNodeId: f.id + '-other-node', personId: f.person.one },
          { accountId: f.account.one, now: () => businessNow },
        ),
      )
    ).events,
  ).toEqual([]);
});
it('keeps genuine unknown confirmations unknown and explicit nature statements separate', async () => {
  const f = await seedRecordCase(db(), { unknown: true });
  const result = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const eventId = result.result.events[0].eventId;
  await db()
    .insert(statements)
    .values({
      id: f.id + '-statement',
      eventId,
      kind: 'management_observation',
      text: '演示：管理观察',
      authorId: f.person.manager,
      fragmentId: f.fragmentId,
      originalVersionId: f.versionId,
    });
  const item = (await read(f)).events.find((row) => row.event.id === eventId)!;
  expect(item.confirmations[0]).toMatchObject({
    row: { status: 'unknown', value: null, anchorId: null },
    ownership: { availability: 'available' },
  });
  expect(item.nature).toMatchObject({
    availability: 'available',
    fact: [{ kind: 'management_observation', authorId: f.person.manager }],
  });
});
it('invalidates damaged save-operation proof rather than trusting active score or receipt counts', async () => {
  const { f, result } = await saved();
  await db()
    .update(recordOperations)
    .set({ createdAt: new Date('2026-01-01T00:00:00Z') })
    .where(eq(recordOperations.saveId, result.result.saveId));
  const item = (await read(f)).events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(item.provenance.availability).toBe('unavailable');
  expect(item.confirmations[0].ownership.availability).toBe('unavailable');
});
it('preserves immutable signed actor after account rebinding; never rewrites it to the current reader', async () => {
  const { f, result } = await saved();
  const { accountBindings } = await import('../modules/directory');
  await db()
    .update(accountBindings)
    .set({ personId: f.person.outsider })
    .where(eq(accountBindings.accountId, f.account.one));
  const ledger = await read(f);
  expect(ledger.context.account?.personId).toBe(f.person.outsider);
  const item = ledger.events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(item.saves[0].proof).toMatchObject({
    availability: 'available',
    fact: { actorPersonId: f.person['rater-one'] },
  });
});
it('retains shared withdrawn source subjects and does not turn raw facts into model permission', async () => {
  const { f, result } = await saved();
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.sourceEventId, personId: f.person.two });
  await db()
    .update(events)
    .set({ withdrawnAt: new Date(businessNow) })
    .where(eq(events.id, f.sourceEventId));
  const ledger = await read(f);
  const item = ledger.events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  if (item.sources.availability !== 'available')
    throw new Error('Complete provenance expected');
  expect(item.sources.fact[0].subjects.map((s) => s.personId)).toContain(
    f.person.two,
  );
  expect(
    await buildAuthorizedModelInput(async () => ({
      context: ledger.context,
      sources:
        item.sources.availability === 'available' ? item.sources.fact : [],
      records: [
        {
          id: 'demo-internal',
          subject: {
            personId: f.person.one,
            evaluationNodeId: f.node,
            cohortId: null,
          },
          kind: 'evaluation',
          fields: [
            {
              name: 'text',
              kind: 'evaluation',
              value: '演示事实',
              subjects: [],
              sources: [
                { fragmentId: f.fragmentId, originalVersionId: f.versionId },
              ],
            },
          ],
        },
      ],
    })),
  ).toEqual({ items: [] });
});
it('waits for a real save commit, then discovers new events and their complete committed ledger', async () => {
  const f = await seedRecordCase(db());
  const hold = holdAudit();
  const writing = saveRecordDraft(db(), f.account.one, f.input, f.clock);
  await hold.reached.promise;
  const label = f.id + '-reader';
  const reading = namedRead(f, label);
  try {
    await waiting(label);
  } finally {
    hold.release.resolve();
  }
  const result = await writing;
  const item = (await reading).events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(item.provenance.availability).toBe('available');
  expect(item.confirmations[0].row.active).toBe(true);
});
it('waits for actual undo and rechecks withdrawn state, active scores, exact undo proof and revision', async () => {
  const { f, result } = await saved();
  const before = await read(f);
  f.setWall(1000);
  const hold = holdAudit();
  const writing = undoRecordSave(
    db(),
    f.account.one,
    { operation_id: f.id + '-undo', saveId: result.result.saveId },
    f.clock,
  );
  await hold.reached.promise;
  const label = f.id + '-reader';
  const reading = namedRead(f, label);
  try {
    await waiting(label);
  } finally {
    hold.release.resolve();
  }
  await writing;
  const after = await reading;
  const item = after.events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(after.revision).not.toBe(before.revision);
  expect(item.event.withdrawnAt).toEqual(new Date(f.clock.wallNow()));
  expect(item.confirmations[0]).toMatchObject({
    row: { active: false },
    ownership: { availability: 'available' },
  });
  expect(item.saves[0].proof).toMatchObject({
    availability: 'available',
    fact: {
      undoOperationId: f.id + '-undo',
      withdrawnAt: new Date(f.clock.wallNow()),
    },
  });
});
async function withReview() {
  const { f, result } = await saved();
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: result.result.revision,
      decisions: [
        {
          ...f.input.decisions[0],
          action: 'edit',
          value: 1,
          reason: '演示不同判断',
        },
      ],
    },
    f.clock,
  );
  return { f, result: second, reviewId: second.result.reviewItemIds[0] };
}
it('waits for competing review DML and returns resolved as a fact, not as an HR signature or ready score', async () => {
  const { f, result, reviewId } = await withReview();
  const before = await read(f);
  const reached = gate(),
    release = gate();
  const writing = db().transaction(async (tx) => {
    await tx
      .update(scoreReviews)
      .set({ status: 'resolved' })
      .where(eq(scoreReviews.id, reviewId));
    reached.resolve();
    await release.promise;
  });
  await reached.promise;
  const label = f.id + '-review-reader';
  const reading = namedRead(f, label);
  try {
    await waiting(label);
  } finally {
    release.resolve();
  }
  await writing;
  const after = await reading;
  expect(after.revision).not.toBe(before.revision);
  const item = after.events.find(
    (row) => row.event.id === result.result.events[0].eventId,
  )!;
  expect(item.reviews[0]).toMatchObject({
    row: { id: reviewId, status: 'resolved' },
    ownership: { availability: 'available', fact: result.result.saveId },
  });
  expect(item.reviews[0]).not.toHaveProperty('signedBy');
});
it('holds review writes until the consuming transaction commits and releases fences on rollback', async () => {
  const { f, reviewId } = await withReview();
  const reached = gate(),
    release = gate();
  const reading = db().transaction(async (tx) => {
    await read(f, tx);
    reached.resolve();
    await release.promise;
    throw new Error('synthetic rollback');
  });
  // Attach rejection handling before deliberately scheduling a rollback.
  const rollback = expect(reading).rejects.toThrow('synthetic rollback');
  await reached.promise;
  const label = f.id + '-review-writer';
  const writing = db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('application_name', ${label}, true)`,
    );
    await tx
      .update(scoreReviews)
      .set({ status: 'resolved' })
      .where(eq(scoreReviews.id, reviewId));
  });
  try {
    await waiting(label);
  } finally {
    release.resolve();
  }
  await rollback;
  await writing;
  expect(
    (await read(f)).events
      .flatMap((e) => e.reviews)
      .find((r) => r.row.id === reviewId)?.row.status,
  ).toBe('resolved');
});
it('blocks a new native save while facts are consumed, without deadlock or phantom event', async () => {
  const f = await seedRecordCase(db());
  const reached = gate(),
    release = gate();
  const reading = db().transaction(async (tx) => {
    const first = await read(f, tx);
    reached.resolve();
    await release.promise;
    expect((await read(f, tx)).revision).toBe(first.revision);
  });
  await reached.promise;
  const writing = saveRecordDraft(db(), f.account.one, f.input, f.clock);
  try {
    const deadline = Date.now() + 5000;
    let blocked = false;
    while (Date.now() < deadline) {
      const found = await connection!.pool.query<{ n: number }>(
        "select count(*)::int n from pg_locks where relation='records_draft_batches'::regclass and not granted",
      );
      if (found.rows[0].n > 0) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
  } finally {
    release.resolve();
  }
  await reading;
  expect((await writing).result.events).toHaveLength(1);
});
it('rejects an old repeatable-read snapshot instead of falsely refreshing it after a wait', async () => {
  const f = await seedRecordCase(db());
  await expect(
    db().transaction((tx) => read(f, tx), {
      isolationLevel: 'repeatable read',
    }),
  ).rejects.toThrow('READ COMMITTED');
});
it('reloads current authorization after the ledger wait instead of retaining a pre-wait grant', async () => {
  const { f } = await saved();
  const reached = gate(),
    release = gate();
  const holding = db().transaction(async (tx) => {
    await tx.execute(sql`lock table records_draft_batches in exclusive mode`);
    reached.resolve();
    await release.promise;
  });
  await reached.promise;
  const label = f.id + '-authority-reader';
  const reading = namedRead(f, label);
  try {
    await waiting(label);
    await db()
      .update(evaluationRelations)
      .set({ revokedAt: businessNow })
      .where(eq(evaluationRelations.id, f.relationOne));
  } finally {
    release.resolve();
  }
  await holding;
  const latest = await reading;
  expect(
    new Date(
      latest.context.evaluationRelations!.find((r) => r.id === f.relationOne)!
        .revokedAt!,
    ).toISOString(),
  ).toBe(businessNow);
});

it('retains every intake restriction including other creators and superseded input; corrupt context is unavailable', async () => {
  const { f, result } = await saved();
  const text = '演示：完整原始输入';
  await db()
    .update(fragments)
    .set({ excerpt: text, location: { kind: 'document', paragraph: 'input' } })
    .where(eq(fragments.id, f.fragmentId));
  await db()
    .update(originalVersions)
    .set({ contentDigest: createHash('sha256').update(text).digest('hex') })
    .where(eq(originalVersions.id, f.versionId));
  for (const suffix of ['old', 'current']) {
    await db()
      .insert(jobSnapshots)
      .values({
        jobId: f.id + suffix,
        kind: 'record_arrange',
        resourceId: f.draft.batchId,
        inputVersion: suffix,
        status: 'awaiting_manual',
        attempt: 1,
        revision: 1,
        updatedAt: businessNow,
      });
    await db()
      .insert(arrangeInputs)
      .values({
        id: f.id + suffix,
        creatorAccountId: suffix === 'old' ? f.account.two : f.account.one,
        jobId: f.id + suffix,
        inputVersion: suffix,
        batchId: f.draft.batchId,
        evaluationNodeId: f.node,
        boundAt: new Date(businessNow),
        occurredOn: '2026-09-01',
        origin: 'text',
        originalInput: { ...f.originalInput, text },
        inputSource: {
          fragmentId: f.fragmentId,
          originalVersionId: f.versionId,
        },
        sourceContexts: [
          {
            fragmentId: f.fragmentId,
            originalVersionId: f.versionId,
            kind: 'evaluation',
            requiredKinds: suffix === 'old' ? ['management-observation'] : [],
            attributedPersonIds: [f.person.one],
            subjects: [
              {
                personId: suffix === 'old' ? f.person.two : f.person.one,
                evaluationNodeId: f.node,
                cohortId: f.id + '-cohort',
              },
            ],
          },
        ],
        personIds: [f.person.one],
        projectMode: 'none',
        projectCandidateIds: [],
        createdAt: new Date(businessNow),
      });
  }
  await db()
    .update(arrangeInputs)
    .set({ supersededByInputId: f.id + 'current' })
    .where(eq(arrangeInputs.id, f.id + 'old'));
  const item = (await read(f)).events.find(
    (e) => e.event.id === result.result.events[0].eventId,
  )!;
  if (item.sources.availability !== 'available')
    throw new Error('Complete intake expected');
  expect(item.sources.fact[0].subjects.map((s) => s.personId)).toContain(
    f.person.two,
  );
  expect(item.sources.fact[0].requiredKinds).toContain(
    'management-observation',
  );
  await db()
    .update(arrangeInputs)
    .set({ sourceContexts: [] })
    .where(eq(arrangeInputs.id, f.id + 'old'));
  expect(
    (await read(f)).events.find(
      (e) => e.event.id === result.result.events[0].eventId,
    )!.sources,
  ).toEqual({
    availability: 'unavailable',
    reason: 'incomplete_source_provenance',
  });
});
it('leaves legacy confirmation and unowned review unavailable even on a native active event', async () => {
  const { f, result, reviewId } = await withReview();
  await db()
    .update(confirmations)
    .set({
      sourceCategory: 'prototype_baseline',
      confirmedAt: null,
      modifiedBy: null,
    })
    .where(eq(confirmations.id, result.result.confirmationIds[0]));
  await db()
    .update(scoreReviews)
    .set({ saveId: null })
    .where(eq(scoreReviews.id, reviewId));
  const item = (await read(f)).events.find(
    (e) => e.event.id === result.result.events[0].eventId,
  )!;
  expect(
    item.confirmations.find(
      (c) => c.row.id === result.result.confirmationIds[0],
    )!.ownership.availability,
  ).toBe('unavailable');
  expect(item.reviews[0].ownership.availability).toBe('unavailable');
});

it('permits the owning native transaction to write and reread review state while holding the fence', async () => {
  const { f, reviewId } = await withReview();
  await db().transaction(async (tx) => {
    const before = await read(f, tx);
    await tx
      .update(scoreReviews)
      .set({ status: 'resolved' })
      .where(eq(scoreReviews.id, reviewId));
    const after = await read(f, tx);
    expect(after.revision).not.toBe(before.revision);
    expect(
      after.events.flatMap((e) => e.reviews).find((r) => r.row.id === reviewId)
        ?.row.status,
    ).toBe('resolved');
  });
});
it('reports malformed native receipt as unavailable instead of hiding its save via a receipt-only lookup', async () => {
  const { f, result } = await saved();
  await db()
    .update(recordSaves)
    .set({ receipt: sql`'{}'::jsonb` })
    .where(eq(recordSaves.saveId, result.result.saveId));
  const item = (await read(f)).events.find(
    (e) => e.event.id === result.result.events[0].eventId,
  )!;
  expect(item.saves).toHaveLength(1);
  expect(item.provenance.availability).toBe('unavailable');
  expect(item.confirmations[0].ownership.availability).toBe('unavailable');
});

it('takes the trusted current clock after waiting, not the request-start timestamp', async () => {
  const { f } = await saved();
  const reached = gate(),
    release = gate();
  const holding = db().transaction(async (tx) => {
    await tx.execute(sql`lock table records_draft_batches in exclusive mode`);
    reached.resolve();
    await release.promise;
  });
  await reached.promise;
  let at = businessNow;
  const label = f.id + '-clock-reader';
  const reading = db().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('application_name', ${label}, true)`,
    );
    return readLockedRecordLedger(
      tx,
      { evaluationNodeId: f.node, personId: f.person.one },
      { accountId: f.account.one, now: () => at },
    );
  });
  try {
    await waiting(label);
    at = '2027-01-01T00:00:00.000Z';
  } finally {
    release.resolve();
  }
  await holding;
  expect((await reading).context.now).toBe(at);
});
