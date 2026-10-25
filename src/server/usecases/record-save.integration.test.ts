import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDatabase } from '../db/client';
import { people, organizations, accountBindings, grants } from '../modules/directory';
import { cohorts, assignments } from '../modules/programs';
import { originals, originalVersions, fragments, events } from '../modules/records';
import { recordDrafts, recordSaves, recordOperations } from '../modules/records/save-state/schema';
import { dimensions, ruleVersions, anchors } from '../modules/evaluation-system';
import { confirmations, scoreReviews } from '../modules/talent';
import { createRecordSaveService } from './record-save';
import type { RecordSaveInput } from '../../contracts/record';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const name = `qtalent_confirm_${randomUUID().replaceAll('-', '')}_test`;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('Real PostgreSQL integration requires TEST_DATABASE_URL; no skip or fake fallback');
  const url = new URL(source);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('Integration database must be loopback and end _test');
  }
  admin = new Pool({ connectionString: source });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  connection = createDatabase(url.toString());
  await migrate(connection.db, { migrationsFolder: 'src/server/db/migrations' });
}, 30_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.end();
  }
});
async function fixture() {
  const db = connection!.db;
  const id = randomUUID();
  const org = id + '-org', cohort = id + '-cohort', rule = id + '-rule', dimension = id + '-dimension';
  const personIds = [id + '-student-a', id + '-student-b'];
  const mentors = [id + '-mentor-a', id + '-mentor-b'];
  const accounts = [id + '-account-a', id + '-account-b'];
  const version = id + '-version', fragment = id + '-fragment';
  await db.insert(organizations).values({ id: org, name: 'Synthetic organization', shortName: 'Test' });
  await db.insert(people).values([...personIds, ...mentors].map((person) => ({
    id: person, name: 'Synthetic person', organizationId: org, demo: true,
  })));
  await db.insert(cohorts).values({ id: cohort, name: 'Synthetic cohort' });
  for (let index = 0; index < accounts.length; index++) {
    await db.insert(accountBindings).values({ accountId: accounts[index], personId: mentors[index] });
    await db.insert(grants).values({
      id: id + '-grant-' + index, accountId: accounts[index], role: 'mentor',
      scope: 'cohort', cohortId: cohort, validFrom: '2026-01-01',
    });
    await db.insert(assignments).values(personIds.map((studentId) => ({
      id: randomUUID(), cohortId: cohort, personId: mentors[index], studentId,
      kind: 'mentor' as const, validFrom: '2026-01-01',
    })));
  }
  await db.insert(dimensions).values({ id: dimension, name: 'Synthetic dimension', axis: 'prof', core: true });
  await db.insert(ruleVersions).values({ id: rule, provenance: 'published' });
  await db.insert(anchors).values([1, 2, 3, 4, 5].map((value) => ({
    id: id + '-anchor-' + value, dimensionId: dimension, ruleVersionId: rule, value,
    text: 'Synthetic behavior ' + value,
  })));
  await db.insert(originals).values({ id, title: 'Synthetic input' });
  await db.insert(originalVersions).values({ id: version, originalId: id, version: 1, contentDigest: 'synthetic-digest' });
  const quote = 'Synthetic observation';
  await db.insert(fragments).values({
    id: fragment, originalVersionId: version, excerpt: quote,
    location: { kind: 'document', paragraph: 'P1' },
  });
  const originalInput = { operation_id: id + '-organize', text: quote, attachmentIds: [], personId: null, projectId: null };
  const sbi = { title: 'Synthetic event', situation: '', behavior: 'Synthetic behavior', impact: '' };
  await db.insert(recordDrafts).values({
    id, creatorAccountId: accounts[0], revision: 1, ruleVersionId: rule,
    draft: {
      draftId: id, origin: 'text', originalInput, sbi,
      people: personIds.map((personId) => ({ state: 'resolved' as const, id: personId })),
      project: { state: 'none' },
      scores: personIds.map((personId) => ({
        personId, dimensionId: dimension, state: 'suggested' as const, value: 1,
        anchor: { id: id + '-anchor-1', text: 'Synthetic behavior 1', ruleVersion: rule },
        citations: [{ kind: 'input' as const, quote, start: 0, end: quote.length }],
      })),
    },
    sources: [{ fragmentId: fragment, originalVersionId: version,
      subjects: personIds.map((personId) => ({ personId, cohortId: cohort })) }],
    evidence: personIds.map((personId) => ({
      personId, dimensionId: dimension, fragmentId: fragment, originalVersionId: version,
      modelVersion: 'synthetic-model', rationale: 'Synthetic source-supported suggestion', suggestedValue: 1,
    })),
  });
  let wall = Date.parse('2026-10-25T00:00:00.000Z');
  const service = createRecordSaveService({ db, businessDate: () => '2026-09-04', now: () => new Date(wall) });
  const input: RecordSaveInput = {
    operation_id: randomUUID(), expected_revision: 1, draftId: id, personIds, projectId: null, sbi,
    decisions: personIds.map((personId) => ({ personId, dimensionId: dimension, action: 'edit', value: 3, reason: '' })),
  };
  return { db, id, accounts, personIds, dimension, fragment, originalInput, input, service,
    advance: (ms: number) => { wall += ms; } };
}
it('replays concurrent same operation, rejects changed payload, business duplicate and stale revision', async () => {
  const f = await fixture();
  const results = await Promise.all([f.service.save(f.accounts[0], f.input), f.service.save(f.accounts[0], f.input)]);
  expect(results.every((result) => result.status === 'success')).toBe(true);
  if (results[0].status !== 'success' || results[1].status !== 'success') throw new Error('save failed');
  expect(results[0].result).toEqual(results[1].result);
  expect([results[0].replayed, results[1].replayed].sort()).toEqual([false, true]);
  expect(await f.db.select().from(recordSaves).where(eq(recordSaves.draftId, f.id))).toHaveLength(1);
  expect(await f.service.save(f.accounts[0], { ...f.input, sbi: { ...f.input.sbi, title: 'Different' } })).toMatchObject({ status: 'conflict' });
  const staleInput = { ...f.input, operation_id: randomUUID() };
  expect(await f.service.save(f.accounts[0], staleInput)).toMatchObject({ status: 'conflict', input: staleInput });
  expect(await f.service.save(f.accounts[0], { ...f.input, operation_id: randomUUID(), expected_revision: 2 })).toMatchObject({ status: 'conflict' });
});
it('uses real wall time for whole-batch undo while retaining original evidence and event history', async () => {
  const f = await fixture();
  const saved = await f.service.save(f.accounts[0], f.input);
  if (saved.status !== 'success') throw new Error('save failed');
  expect(saved.result.events).toHaveLength(2);
  expect(saved.result.reviewItemIds).toHaveLength(2);
  f.advance(4999);
  const undo = { operation_id: randomUUID(), saveId: saved.result.saveId };
  const result = await f.service.undo(f.accounts[0], undo);
  expect(result).toMatchObject({ status: 'success', result: {
    withdrawnEvents: saved.result.events, originalInput: f.originalInput,
  } });
  for (const id of saved.result.confirmationIds) {
    expect(await f.db.select().from(confirmations).where(eq(confirmations.id, id))).toMatchObject([{ active: false }]);
  }
  expect(await f.db.select().from(fragments).where(eq(fragments.id, f.fragment))).toHaveLength(1);
  for (const event of saved.result.events) {
    expect(await f.db.select().from(events).where(eq(events.id, event.eventId))).toHaveLength(1);
  }
  f.advance(100_000);
  expect(await f.service.undo(f.accounts[0], undo)).toMatchObject({ status: 'success', replayed: true });
});
it.each([5000, 5001])('rejects undo at elapsed %s without using frozen business time', async (elapsed) => {
  const f = await fixture();
  const saved = await f.service.save(f.accounts[0], f.input);
  if (saved.status !== 'success') throw new Error('save failed');
  f.advance(elapsed);
  expect(await f.service.undo(f.accounts[0], { operation_id: randomUUID(), saveId: saved.result.saveId })).toMatchObject({ status: 'conflict' });
});
it('rejects another person and revoked permission even on replay', async () => {
  const f = await fixture();
  const saved = await f.service.save(f.accounts[0], f.input);
  if (saved.status !== 'success') throw new Error('save failed');
  expect(await f.service.undo(f.accounts[1], { operation_id: randomUUID(), saveId: saved.result.saveId })).toMatchObject({ status: 'forbidden' });
  await f.db.update(grants).set({ revokedAt: '2026-09-01' }).where(eq(grants.accountId, f.accounts[0]));
  expect(await f.service.save(f.accounts[0], f.input)).toMatchObject({ status: 'forbidden' });
});
it('reuses the event for a second evaluator, creates rater gaps and withdraws no other actor events', async () => {
  const f = await fixture();
  const first = await f.service.save(f.accounts[0], f.input);
  if (first.status !== 'success') throw new Error('save failed');
  const second = await f.service.save(f.accounts[1], {
    ...f.input, operation_id: randomUUID(), expected_revision: first.result.revision,
    decisions: f.input.decisions.map((decision) => ({ ...decision, action: 'edit', value: 5, reason: 'Observed behavior' })),
  });
  if (second.status !== 'success') throw new Error('second save failed');
  expect(second.result.events).toEqual(first.result.events);
  expect(second.result.reviewItemIds).toHaveLength(2);
  expect(await f.service.undo(f.accounts[0], { operation_id: randomUUID(), saveId: first.result.saveId })).toMatchObject({ status: 'conflict' });
  expect(await f.service.undo(f.accounts[1], { operation_id: randomUUID(), saveId: second.result.saveId })).toMatchObject({ status: 'success', result: { withdrawnEvents: [] } });
});
it('does not undo an HR-processed review', async () => {
  const f = await fixture();
  const saved = await f.service.save(f.accounts[0], f.input);
  if (saved.status !== 'success') throw new Error('save failed');
  await f.db.update(scoreReviews).set({ status: 'resolved', revision: 2 }).where(eq(scoreReviews.id, saved.result.reviewItemIds[0]));
  expect(await f.service.undo(f.accounts[0], { operation_id: randomUUID(), saveId: saved.result.saveId })).toMatchObject({ status: 'conflict' });
  expect((await f.db.select().from(recordSaves).where(eq(recordSaves.id, saved.result.saveId)))[0].withdrawnAt).toBeNull();
});
it('rolls back events, scores, reviews and operation receipt when audit persistence fails', async () => {
  const f = await fixture();
  await f.db.execute(sql`CREATE FUNCTION fail_record_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`);
  await f.db.execute(sql`CREATE TRIGGER fail_record_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_record_audit()`);
  try {
    await expect(f.service.save(f.accounts[0], f.input)).rejects.toThrow();
    expect(await f.db.select().from(recordSaves).where(eq(recordSaves.draftId, f.id))).toHaveLength(0);
    expect(await f.db.select().from(recordOperations).where(eq(recordOperations.draftId, f.id))).toHaveLength(0);
    expect(await f.db.select().from(events).where(eq(events.personId, f.personIds[0]))).toHaveLength(0);
  } finally {
    await f.db.execute(sql`DROP TRIGGER fail_record_audit ON audit_events`);
    await f.db.execute(sql`DROP FUNCTION fail_record_audit()`);
  }
});

it('serializes different operation IDs and different evaluators against the same draft revision', async () => {
  const f = await fixture();
  const results = await Promise.all([
    f.service.save(f.accounts[0], f.input),
    f.service.save(f.accounts[1], { ...f.input, operation_id: randomUUID() }),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'success']);
  expect(await f.db.select().from(recordSaves).where(eq(recordSaves.draftId, f.id))).toHaveLength(1);
});
it('allows truly empty situation but rejects empty formal behavior at the database boundary', async () => {
  const f = await fixture();
  const saved = await f.service.save(f.accounts[0], f.input);
  if (saved.status !== 'success') throw new Error('save failed');
  const [event] = await f.db.select().from(events).where(eq(events.id, saved.result.events[0].eventId));
  expect(event.situation).toBe('');
  await expect(f.db.insert(events).values({ ...event, id: randomUUID(), behavior: '' })).rejects.toThrow();
  await expect(f.db.insert(events).values({ ...event, id: randomUUID(), behavior: '', demo: true })).resolves.toBeDefined();
});
