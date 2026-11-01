import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { and, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createDatabase, type Transaction } from '../../../db/client';
import { recordEvidenceScoreSchema } from '../../../../contracts/record';
import { grants, accountBindings, people } from '../../directory';
import { anchors } from '../../evaluation-system';
import { aiSuggestions } from '../schema';
import { recordSaves, eventParticipants } from '../../records';
import {
  confirmations,
  scoreReviews,
  scoreReviewCalibrations,
  scoreReviewOperations,
} from '../schema';
import { auditEvents } from '../../../platform/audit/schema';
import * as audit from '../../../platform/audit';
import { saveRecordDraft } from '../../../usecases/record-save';
import { readLockedRecordLedger } from '../../../usecases/record-ledger';
import {
  readScoreReviewAuthority,
  resolveNativeScoreReview,
  canReviewScoreTarget,
} from '../../../usecases/score-review';
import {
  businessNow,
  seedRecordCase,
  seedRecordRules,
} from '../../../../../tests/fixtures/bow-846/native';
import { createPostgresScoreReviewStore } from './postgres';
import { digest, scoreReviewFingerprint } from './service';
import {
  ScoreReviewStoreConflict,
  type CalibrationWrite,
  type ReviewItem,
} from './ports';

const database =
  'qtalent_b849_store_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let created = false;
const db = () => connection!.db;
const store = createPostgresScoreReviewStore();
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error('TEST_DATABASE_URL required; no fake/skip fallback');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Only isolated loopback _test database allowed');
  admin = new Pool({
    connectionString: source,
    max: 2,
    connectionTimeoutMillis: 3000,
  });
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  url.pathname = '/' + database;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW849_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  // No CREATE TABLE fallback: absent X1 migrations fail, never silently skip.
  await db().select().from(scoreReviewCalibrations).limit(1);
  await seedRecordRules(db());
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
      } finally {
        await admin.end();
      }
    }
  }
});

/** Actual 846 save rows and actual ledger; the test constructs a write plan to
 * verify private persistence. It is NOT the unfinished production review reader,
 * current full-source authority lock protocol, or effective-score projection. */
async function fixture(kind: ReviewItem['kind'] = 'rater_gap') {
  const f = await seedRecordCase(db());
  await db()
    .insert(grants)
    .values({
      id: f.id + '-hr-grant',
      accountId: f.account.manager,
      role: 'hr',
      scope: 'company',
      validFrom: '2026-01-01',
    });
  const first = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const second = await saveRecordDraft(
    db(),
    f.account.two,
    {
      ...f.input,
      operation_id: f.id + '-second',
      expected_revision: first.result.revision,
      decisions: [
        {
          ...f.input.decisions[0],
          action: 'edit',
          value: 1,
          reason: kind === 'ai_gap' ? '' : '演示不同判断',
        },
      ],
    },
    f.clock,
  );
  const [review] = await db()
    .select()
    .from(scoreReviews)
    .where(
      and(
        eq(scoreReviews.saveId, second.result.saveId),
        eq(
          scoreReviews.reason,
          kind === 'ai_gap' ? 'ai_changed_without_reason' : 'score_gap',
        ),
      ),
    );
  if (!review?.confirmationId) throw new Error('Expected real review');
  const [human] = await db()
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, review.confirmationId));
  const [saved] = await db()
    .select()
    .from(recordSaves)
    .where(eq(recordSaves.saveId, review.saveId!));
  const [anchor] = await db()
    .select()
    .from(anchors)
    .where(eq(anchors.id, human.anchorId!));
  const citation = f.draft.scores[0];
  if (citation.state !== 'suggested')
    throw new Error('Expected actual suggested citation');
  const citations = recordEvidenceScoreSchema.parse({
    value: citation.value,
    anchor: citation.anchor,
    citations: citation.citations,
  }).citations;
  const score = (
    row: typeof human,
    ruleAnchor: typeof anchor,
    reason: string,
  ) => ({
    value: row.value!,
    anchor: {
      id: ruleAnchor.id,
      text: ruleAnchor.text,
      ruleVersion: ruleAnchor.ruleVersionId,
    },
    citations: structuredClone(citations),
    raterId: row.evaluatorId!,
    confirmedAt: row.confirmedAt!.toISOString(),
    reason,
  });
  const decision = saved.input.decisions.find(
    (value) =>
      value.personId === f.person.one && value.dimensionId === 'native-prof',
  );
  const reason = decision?.action === 'edit' ? decision.reason : '';
  const base = {
    id: review.id,
    revision: review.revision,
    eventId: review.eventId,
    personId: f.person.one,
    dimensionId: review.dimensionId,
  };
  let original: ReviewItem;
  if (kind === 'rater_gap') {
    const [other] = await db()
      .select()
      .from(confirmations)
      .where(eq(confirmations.id, review.counterpartConfirmationId!));
    const [otherAnchor] = await db()
      .select()
      .from(anchors)
      .where(eq(anchors.id, other.anchorId!));
    original = {
      ...base,
      kind,
      sides: [score(human, anchor, reason), score(other, otherAnchor, '')],
    };
  } else {
    const [ai] = await db()
      .select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.id, human.suggestionId!));
    const [aiAnchor] = await db()
      .select()
      .from(anchors)
      .where(eq(anchors.id, ai.anchorId!));
    original = {
      ...base,
      kind,
      human: score(human, anchor, reason),
      ai: {
        value: ai.value!,
        anchor: {
          id: aiAnchor.id,
          text: aiAnchor.text,
          ruleVersion: aiAnchor.ruleVersionId,
        },
        citations: structuredClone(citations),
      },
    };
  }
  const target = {
    itemId: review.id,
    eventId: review.eventId,
    personId: f.person.one,
    evaluationNodeId: f.node,
    dimensionId: review.dimensionId,
    ruleVersion: 'rubric-v1',
    revision: review.revision,
    status: 'open' as const,
  };
  const { revision: _revision, status: _status, ...scope } = target;
  void _revision;
  void _status;
  const write: CalibrationWrite = {
    target,
    accountId: f.account.manager,
    actorPersonId: f.person.manager,
    operationId: f.id + '-calibrate',
    fingerprint: scoreReviewFingerprint({
      action: 'calibrate',
      kind,
      itemId: review.id,
      expected_revision: review.revision,
      operation_id: f.id + '-calibrate',
      value: 2,
      reason: '演示HR人工复核理由',
    }),
    scopeFingerprint: digest(scope),
    originalFingerprint: digest(original),
    result: {
      itemId: review.id,
      revision: review.revision + 1,
      original,
      score: {
        value: 2,
        anchor: {
          id: 'native-v1-2',
          text: '演示旧版锚点 2',
          ruleVersion: 'rubric-v1',
        },
        citations: structuredClone(citations),
        raterId: f.person.manager,
        reason: '演示HR人工复核理由',
        confirmedAt: '2026-11-01T11:00:00.000Z',
      },
    },
  };
  const ledger = await db().transaction((tx) =>
    readLockedRecordLedger(
      tx,
      {
        evaluationNodeId: f.node,
        personId: f.person.one,
      },
      { accountId: f.account.manager, now: () => businessNow },
    ),
  );
  return {
    f,
    write,
    bindings: {
      sourceFactRevision: ledger.revision,
      confirmationId: review.confirmationId,
      counterpartConfirmationId: review.counterpartConfirmationId,
      suggestionId: kind === 'ai_gap' ? human.suggestionId : null,
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function apply(f: Fixture, tx?: Transaction) {
  const work = async (transaction: Transaction) => {
    const ledger = await readLockedRecordLedger(
      transaction,
      {
        evaluationNodeId: f.f.node,
        personId: f.f.person.one,
      },
      { accountId: f.f.account.manager, now: () => businessNow },
    );
    const authority = await readScoreReviewAuthority(
      transaction,
      f.f.account.manager,
      businessNow,
    );
    if (
      !(await canReviewScoreTarget(
        transaction,
        authority,
        f.write.target,
        businessNow,
      ))
    )
      throw new Error('Test current scope denied');
    await store.lockOperation(
      transaction,
      f.write.accountId,
      f.write.operationId,
    );
    return store.applyCalibration(transaction, f.write, {
      ...f.bindings,
      sourceFactRevision: ledger.revision,
    });
  };
  return tx ? work(tx) : db().transaction(work);
}
async function counts(f: Fixture) {
  const predicate = eq(scoreReviewCalibrations.itemId, f.write.target.itemId);
  const [review] = await db()
    .select()
    .from(scoreReviews)
    .where(eq(scoreReviews.id, f.write.target.itemId));
  return {
    calibration: await db()
      .select()
      .from(scoreReviewCalibrations)
      .where(predicate),
    operations: await db()
      .select()
      .from(scoreReviewOperations)
      .where(eq(scoreReviewOperations.itemId, f.write.target.itemId)),
    audits: await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, f.write.target.itemId)),
    review,
  };
}
it.each(['rater_gap', 'ai_gap'] as const)(
  'persists actual %s calibration/closure/receipt/audit without a third rater',
  async (kind) => {
    const f = await fixture(kind);
    const before = await db()
      .select()
      .from(confirmations)
      .where(eq(confirmations.eventId, f.write.target.eventId))
      .orderBy(confirmations.id);
    expect(await apply(f)).toEqual(f.write.result);
    const rows = await counts(f);
    expect(rows.calibration).toHaveLength(1);
    expect(rows.operations).toHaveLength(1);
    expect(rows.audits).toHaveLength(1);
    expect(rows.review).toMatchObject({ status: 'resolved', revision: 2 });
    expect(rows.calibration[0]).toMatchObject({
      payload: f.write.result,
      actorPersonId: f.write.actorPersonId,
    });
    expect(
      await db()
        .select()
        .from(confirmations)
        .where(eq(confirmations.eventId, f.write.target.eventId))
        .orderBy(confirmations.id),
    ).toEqual(before);
    expect(
      await db().transaction((tx) =>
        store.calibration(tx, f.write.target.itemId),
      ),
    ).toEqual(f.write.result);
    expect(
      await db().transaction((tx) =>
        store.operation(tx, f.write.accountId, f.write.operationId),
      ),
    ).toEqual({
      accountId: f.write.accountId,
      operationId: f.write.operationId,
      fingerprint: f.write.fingerprint,
      scopeFingerprint: f.write.scopeFingerprint,
      result: f.write.result,
    });
    const afterLedger = await db().transaction((tx) =>
      readLockedRecordLedger(
        tx,
        {
          evaluationNodeId: f.f.node,
          personId: f.f.person.one,
        },
        { accountId: f.f.account.manager, now: () => businessNow },
      ),
    );
    expect(afterLedger.revision).not.toBe(
      rows.calibration[0].sourceFactRevision,
    );
    expect(
      await db().transaction((tx) =>
        store.calibration(tx, f.write.target.itemId),
      ),
    ).toEqual(f.write.result);
  },
);
it('has persistent single-winner CAS and cannot overwrite by another operation', async () => {
  const f = await fixture();
  const result = await Promise.allSettled([apply(f), apply(f)]);
  expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter((row) => row.status === 'rejected')).toHaveLength(1);
  const before = await counts(f);
  f.write.operationId += '-other';
  await expect(apply(f)).rejects.toBeInstanceOf(ScoreReviewStoreConflict);
  expect(await counts(f)).toEqual(before);
});
it('rolls the whole result back with the caller transaction', async () => {
  const f = await fixture();
  const before = await counts(f);
  await expect(
    db().transaction(async (tx) => {
      await apply(f, tx);
      throw new Error('synthetic rollback');
    }),
  ).rejects.toThrow('synthetic rollback');
  expect(await counts(f)).toEqual(before);
});
it('audit failure rolls back its savepoint even if an outer caller catches the safe error', async () => {
  const f = await fixture();
  const before = await counts(f);
  const real = audit.recordAudit;
  vi.spyOn(audit, 'recordAudit').mockImplementationOnce(async (...args) => {
    await real(...args);
    throw new Error('synthetic-private-score-and-signature');
  });
  await db().transaction(async (tx) => {
    await expect(apply(f, tx)).rejects.toThrow('评分复核存储不可用');
  });
  expect(await counts(f)).toEqual(before);
});
it.each([
  'revision',
  'withdrawn',
  'inactive',
  'actor',
  'anchor',
  'binding',
] as const)(
  'rejects changed native %s facts without partial writes',
  async (mode) => {
    const f = await fixture();
    if (mode === 'revision')
      await db()
        .update(scoreReviews)
        .set({ revision: 2 })
        .where(eq(scoreReviews.id, f.write.target.itemId));
    if (mode === 'withdrawn')
      await db()
        .update(scoreReviews)
        .set({ withdrawnAt: new Date() })
        .where(eq(scoreReviews.id, f.write.target.itemId));
    if (mode === 'inactive')
      await db()
        .update(confirmations)
        .set({ active: false })
        .where(eq(confirmations.id, f.bindings.confirmationId));
    if (mode === 'actor')
      f.write.actorPersonId = f.write.result.score.raterId =
        f.f.person.outsider;
    if (mode === 'anchor') f.write.result.score.anchor.text = '伪造的合成锚点';
    if (mode === 'binding')
      f.bindings.confirmationId = f.bindings.counterpartConfirmationId!;
    const before = await counts(f);
    await expect(apply(f)).rejects.toThrow();
    expect(await counts(f)).toEqual(before);
  },
);
it('an operation cannot reference a calibration signed by a different account/person', async () => {
  const f = await fixture();
  await apply(f);
  await expect(
    db()
      .insert(scoreReviewOperations)
      .values({
        actorAccountId: f.f.account.outsider,
        actorPersonId: f.f.person.outsider,
        operationId: f.f.id + '-forged-op',
        fingerprint: f.write.fingerprint,
        scopeFingerprint: f.write.scopeFingerprint,
        itemId: f.write.target.itemId,
        calibrationRevision: 2,
        createdAt: new Date(),
      }),
  ).rejects.toThrow();
  expect((await counts(f)).operations).toHaveLength(1);
});
it('returns no receipt for an unrelated operation and keeps historical signer after rebind', async () => {
  const f = await fixture();
  expect(
    await db().transaction((tx) =>
      store.operation(tx, f.write.accountId, 'absent'),
    ),
  ).toBeNull();
  expect(
    await db().transaction((tx) => store.calibration(tx, 'absent')),
  ).toBeNull();
  await apply(f);
  await db()
    .update(accountBindings)
    .set({ personId: f.f.person.outsider })
    .where(eq(accountBindings.accountId, f.write.accountId));
  // Internal read preserves history; service #319 must authorize/reject replay.
  const result = await db().transaction((tx) =>
    store.operation(tx, f.write.accountId, f.write.operationId),
  );
  expect(result?.result.score.raterId).toBe(f.f.person.manager);
});

const command = (f: Fixture) => ({
  action: 'calibrate' as const,
  kind: f.write.result.original.kind,
  itemId: f.write.target.itemId,
  expected_revision: f.write.target.revision,
  operation_id: f.write.operationId,
  value: 2,
  reason: '演示HR人工复核理由',
});
it.each(['rater_gap', 'ai_gap'] as const)(
  'native command consumes real %s ledger, preserves original reason, and replays after its own closure',
  async (kind) => {
    const f = await fixture(kind);
    const result = await resolveNativeScoreReview(
      db(),
      f.write.accountId,
      command(f),
      f.f.clock,
    );
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected native success');
    expect(result.replayed).toBe(false);
    expect(result.result.original).toEqual(f.write.result.original);
    expect(result.result.score.raterId).toBe(f.f.person.manager);
    const before = await counts(f);
    const replay = await resolveNativeScoreReview(
      db(),
      f.write.accountId,
      command(f),
      f.f.clock,
    );
    expect(replay).toMatchObject({
      status: 'success',
      replayed: true,
      result: result.result,
    });
    expect(await counts(f)).toEqual(before);
  },
);
it('native command rejects current rebind and revocation on historical operation replay', async () => {
  const f = await fixture();
  expect(
    (
      await resolveNativeScoreReview(
        db(),
        f.write.accountId,
        command(f),
        f.f.clock,
      )
    ).status,
  ).toBe('success');
  const before = await counts(f);
  await db()
    .update(accountBindings)
    .set({ personId: f.f.person.outsider })
    .where(eq(accountBindings.accountId, f.write.accountId));
  expect(
    (
      await resolveNativeScoreReview(
        db(),
        f.write.accountId,
        command(f),
        f.f.clock,
      )
    ).status,
  ).toBe('forbidden');
  await db()
    .update(accountBindings)
    .set({ personId: f.f.person.manager })
    .where(eq(accountBindings.accountId, f.write.accountId));
  await db()
    .delete(grants)
    .where(eq(grants.id, f.f.id + '-hr-grant'));
  expect(
    (
      await resolveNativeScoreReview(
        db(),
        f.write.accountId,
        command(f),
        f.f.clock,
      )
    ).status,
  ).toBe('forbidden');
  expect(await counts(f)).toEqual(before);
});
it('complete shared-source permission suppresses the whole native score and replay after a co-subject is denied', async () => {
  const f = await fixture();
  expect(
    (
      await resolveNativeScoreReview(
        db(),
        f.write.accountId,
        command(f),
        f.f.clock,
      )
    ).status,
  ).toBe('success');
  const before = await counts(f);
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.f.sourceEventId, personId: f.f.person.outsider });
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, f.f.person.outsider));
  const replay = await resolveNativeScoreReview(
    db(),
    f.write.accountId,
    command(f),
    f.f.clock,
  );
  expect(replay.status).toBe('not_found');
  expect(JSON.stringify(replay)).not.toContain('演示：完成任务');
  expect(await counts(f)).toEqual(before);
});

it('rejects malformed native bindings without exposing input or making partial changes', async () => {
  const f = await fixture();
  const before = await counts(f);
  await expect(
    db().transaction((tx) =>
      store.applyCalibration(tx, f.write, {
        ...f.bindings,
        sourceFactRevision: 'synthetic-private-input',
      }),
    ),
  ).rejects.toBeInstanceOf(ScoreReviewStoreConflict);
  await expect(
    db().transaction((tx) =>
      store.applyCalibration(tx, f.write, {
        get sourceFactRevision() {
          throw new Error('synthetic-private-input');
        },
      }),
    ),
  ).rejects.toBeInstanceOf(ScoreReviewStoreConflict);
  expect(await counts(f)).toEqual(before);
});
it('does not return a corrupted historical digest as a valid receipt', async () => {
  const f = await fixture();
  await apply(f);
  await db()
    .update(scoreReviewCalibrations)
    .set({ originalFingerprint: '0'.repeat(64) })
    .where(eq(scoreReviewCalibrations.itemId, f.write.target.itemId));
  await expect(
    db().transaction((tx) => store.calibration(tx, f.write.target.itemId)),
  ).rejects.toBeInstanceOf(ScoreReviewStoreConflict);
  await expect(
    db().transaction((tx) =>
      store.operation(tx, f.write.accountId, f.write.operationId),
    ),
  ).rejects.toBeInstanceOf(ScoreReviewStoreConflict);
});
