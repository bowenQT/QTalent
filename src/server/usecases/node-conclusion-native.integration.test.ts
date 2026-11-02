import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { beforeAll, afterAll, afterEach, it, expect, vi } from 'vitest';
import { createDatabase } from '../db/client';
import { grants, accountBindings, people } from '../modules/directory';
import {
  evaluationNodes,
  evaluationRelations,
  enrollments,
} from '../modules/programs';
import { confirmations, scoreReviews, aiSuggestions } from '../modules/talent';
import {
  recordOperations,
  eventParticipants,
  events,
  fragments,
} from '../modules/records';
import {
  nodeConclusions,
  nodeConclusionVersions,
  nodeConclusionOperations,
} from '../modules/programs/node-conclusions/schema';
import { createPostgresNodeConclusionStore } from '../modules/programs/node-conclusions/store';
import {
  nodeConclusionFingerprint,
  type NodeConclusionVersion,
} from '../modules/programs/node-conclusion';
import { saveRecordDraft, undoRecordSave } from './record-save';
import { createNativeNodeConclusionUsecase } from './node-conclusion-native';
import {
  seedRecordCase,
  seedRecordRules,
  businessNow,
} from '../../../tests/fixtures/bow-846/native';
const name =
  'qtalent_b902_native_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined,
  connection: ReturnType<typeof createDatabase> | undefined,
  created = false;
const db = () => connection!.db;
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no skips');
  const url = new URL(source);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Only dedicated loopback test database');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW902_TEST_MIGRATIONS ?? 'src/server/db/migrations',
  });
  await db().select().from(nodeConclusions).limit(1);
  await seedRecordRules(db());
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      } finally {
        await admin.end();
      }
    }
  }
});
async function fixture() {
  const f = await seedRecordCase(db());
  const score = f.draft.scores[0];
  if (score.state !== 'suggested')
    throw new Error('Expected synthetic suggested score');
  const reference = score.citations[0].reference;
  await db()
    .update(evaluationNodes)
    .set({ kind: 'defense' })
    .where(eq(evaluationNodes.id, f.node));
  await db()
    .update(evaluationRelations)
    .set({ kind: 'judge' })
    .where(eq(evaluationRelations.evaluationNodeId, f.node));
  await db()
    .insert(grants)
    .values({
      id: f.id + '-hr',
      accountId: f.account.manager,
      role: 'hr',
      scope: 'cohort',
      cohortId: f.id + '-cohort',
      validFrom: '2026-01-01',
    });
  await db()
    .insert(enrollments)
    .values({
      id: f.id + '-enrollment',
      personId: f.person.one,
      cohortId: f.id + '-cohort',
      confirmed: true,
      validFrom: '2026-01-01',
    });
  const saved = await saveRecordDraft(db(), f.account.one, f.input, f.clock);
  const identity = { evaluationNodeId: f.node, personId: f.person.one };
  let now = businessNow;
  const usecase = createNativeNodeConclusionUsecase(db(), {
    environment: 'production',
    wallNow: () => new Date(now),
  });
  return {
    f,
    reference,
    saved,
    identity,
    usecase,
    setNow: (value: string) => {
      now = value;
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const inspect = (f: Fixture) =>
  f.usecase.inspect(f.f.account.manager, f.identity);
async function counts() {
  return {
    roots: (await db().select().from(nodeConclusions)).length,
    versions: (await db().select().from(nodeConclusionVersions)).length,
    operations: (await db().select().from(nodeConclusionOperations)).length,
    events: (await db().select().from(events)).length,
  };
}
async function input(f: Fixture) {
  const facts = await inspect(f);
  return {
    ...f.identity,
    operationId: f.f.id + '-conclude',
    expectedVersion: 0,
    expectedScoreRevision: facts.revision,
    conclusion: '演示：HR人工答辩结论',
    basisReferences: [f.reference],
  };
}
it('real 846 save yields exact human identity/version/time and stable digest, never invented completion', async () => {
  const f = await fixture();
  const first = await inspect(f);
  expect(await inspect(f)).toEqual(first);
  const [row] = await db()
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, f.saved.result.confirmationIds[0]));
  expect(first.confirmations).toEqual([
    {
      confirmationId: row.id,
      evaluatorId: row.evaluatorId,
      version: row.revision,
      confirmedAt: row.confirmedAt!.toISOString(),
    },
  ]);
  expect(first.status).toBe('unavailable');
  expect(first.issues).toEqual([{ code: 'confirmation_scope_not_recorded' }]);
  const before = await counts();
  expect(
    await f.usecase.confirm(f.f.account.manager, await input(f)),
  ).toMatchObject({ status: 'conflict', message: '权威评分确认尚未就绪' });
  expect(await counts()).toEqual(before);
});
it('real withdrawal changes fact revision and removes active authority while preserving history rows', async () => {
  const f = await fixture();
  const before = await inspect(f);
  await undoRecordSave(
    db(),
    f.f.account.one,
    { operation_id: f.f.id + '-undo', saveId: f.saved.result.saveId },
    f.f.clock,
  );
  const after = await inspect(f);
  expect(after.revision).not.toBe(before.revision);
  expect(after.confirmations).toEqual([]);
  expect(after.status).toBe('unavailable');
  const rows = await db()
    .select()
    .from(confirmations)
    .where(eq(confirmations.id, f.saved.result.confirmationIds[0]));
  expect(rows).toHaveLength(1);
  expect(rows[0].active).toBe(false);
});
it('actual second score creates a pending review; flipping status alone cannot prove resolution', async () => {
  const f = await fixture();
  const before = await inspect(f);
  const second = await saveRecordDraft(
    db(),
    f.f.account.two,
    {
      ...f.f.input,
      operation_id: f.f.id + '-second',
      expected_revision: f.saved.result.revision,
      decisions: [
        {
          ...f.f.input.decisions[0],
          action: 'edit',
          value: 1,
          reason: '演示不同判断',
        },
      ],
    },
    f.f.clock,
  );
  const pending = await inspect(f);
  expect(pending.status).toBe('pending');
  expect(pending.revision).not.toBe(before.revision);
  expect(pending.issues.some((issue) => issue.code === 'review_pending')).toBe(
    true,
  );
  await db()
    .update(scoreReviews)
    .set({ status: 'resolved' })
    .where(eq(scoreReviews.id, second.result.reviewItemIds[0]));
  const changed = await inspect(f);
  expect(
    changed.issues.some(
      (issue) => issue.code === 'review_resolution_unverified',
    ),
  ).toBe(true);
  expect(changed.status).toBe('unavailable');
});
it.each(['save', 'suggestion', 'source'] as const)(
  'corrupt %s native facts fail closed with a precise reason',
  async (mode) => {
    const f = await fixture();
    if (mode === 'save')
      await db()
        .update(recordOperations)
        .set({ operationId: f.f.id + '-wrong-operation' })
        .where(eq(recordOperations.saveId, f.saved.result.saveId));
    if (mode === 'suggestion')
      await db()
        .update(aiSuggestions)
        .set({ rationale: '合成不同原文' })
        .where(eq(aiSuggestions.eventId, f.saved.result.events[0].eventId));
    if (mode === 'source')
      await db()
        .update(fragments)
        .set({ excerpt: '合成替换原文' })
        .where(eq(fragments.id, f.reference.fragmentId));
    const facts = await inspect(f);
    expect(facts.confirmations).toEqual([]);
    expect(
      facts.issues.some(
        (issue) =>
          issue.code ===
          (
            {
              save: 'native_ownership_unverified',
              suggestion: 'suggestion_unverified',
              source: 'source_unavailable',
            } as const
          )[mode],
      ),
    ).toBe(true);
  },
);
it('full co-subject permission removes the whole confirmation instead of only its citation', async () => {
  const f = await fixture();
  expect((await inspect(f)).confirmations).toHaveLength(1);
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.f.sourceEventId, personId: f.f.person.outsider });
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, f.f.person.outsider));
  const facts = await inspect(f);
  expect(facts.confirmations).toEqual([]);
  expect(
    facts.issues.some((issue) => issue.code === 'source_unavailable'),
  ).toBe(true);
});
it.each(['judge', 'manager', 'admin'] as const)(
  '%s cannot use HR-only confirmation inspection',
  async (role) => {
    const f = await fixture();
    if (role === 'manager')
      await db()
        .delete(grants)
        .where(eq(grants.id, f.f.id + '-hr'));
    const account =
      role === 'judge'
        ? f.f.account.one
        : role === 'admin'
          ? f.f.account.admin
          : f.f.account.manager;
    await expect(f.usecase.inspect(account, f.identity)).rejects.toMatchObject({
      code: 'forbidden',
    });
  },
);
/** Explicit pre-existing historical conclusion fixture, NOT production confirmation.
 * The actual 846 facts supply its basis; no ready callback enters the native API. */
async function history(f: Fixture) {
  const facts = await inspect(f);
  const command = await input(f);
  const record: NodeConclusionVersion = {
    id: f.f.id + '-conclusion',
    ...f.identity,
    version: 1,
    conclusionType: 'defense',
    origin: 'human_conclusion',
    conclusion: command.conclusion,
    confirmedBy: { id: f.f.person.manager, name: '演示 manager' },
    confirmedAt: businessNow,
    basis: {
      scoreConfirmationRevision: facts.revision,
      confirmations: facts.confirmations,
      references: command.basisReferences,
    },
  };
  const store = createPostgresNodeConclusionStore(db());
  await db().transaction(async (tx) => {
    await store.appendVersion(tx, record, 0);
    await store.appendAudit(tx, {
      accountId: f.f.account.manager,
      action: 'node_conclusion.confirm',
      conclusionId: record.id,
    });
    await store.saveOperation(tx, f.f.account.manager, command.operationId, {
      fingerprint: nodeConclusionFingerprint(command),
      conclusion: record,
    });
  });
  return { command, record };
}
it('reads exact pre-existing history and replays its operation through current native authority', async () => {
  const f = await fixture();
  const old = await history(f);
  const before = await counts();
  expect(
    await f.usecase.read(f.f.account.manager, { ...f.identity, version: 1 }),
  ).toMatchObject({ status: 'success', conclusion: old.record });
  expect(
    await f.usecase.confirm(f.f.account.manager, old.command),
  ).toMatchObject({
    status: 'success',
    replayed: true,
    conclusion: old.record,
  });
  expect(await counts()).toEqual(before);
  expect(
    await f.usecase.read(f.f.account.manager, { ...f.identity, version: 2 }),
  ).toMatchObject({ status: 'not_found' });
});
it('current rebind rejects old operation but preserves permitted historical read', async () => {
  const f = await fixture();
  const old = await history(f);
  await db()
    .update(accountBindings)
    .set({ personId: f.f.person.outsider })
    .where(eq(accountBindings.accountId, f.f.account.manager));
  expect(
    await f.usecase.confirm(f.f.account.manager, old.command),
  ).toMatchObject({ status: 'forbidden' });
  expect(await f.usecase.read(f.f.account.manager, f.identity)).toMatchObject({
    status: 'success',
    conclusion: old.record,
  });
});
it('historical read and replay reject newly shared inaccessible sources and changed locator', async () => {
  const f = await fixture();
  const old = await history(f);
  await db()
    .update(fragments)
    .set({ location: { kind: 'document', paragraph: 'changed' } })
    .where(eq(fragments.id, f.reference.fragmentId));
  expect(await f.usecase.read(f.f.account.manager, f.identity)).toMatchObject({
    status: 'forbidden',
  });
  expect(
    await f.usecase.confirm(f.f.account.manager, old.command),
  ).toMatchObject({ status: 'forbidden' });
});
it('invalid commands do not enter a transaction and cannot smuggle ready snapshots', async () => {
  const f = await fixture();
  const transaction = vi.spyOn(db(), 'transaction');
  expect(
    await f.usecase.confirm(f.f.account.manager, { ready: true }),
  ).toMatchObject({ status: 'validation_error' });
  expect(
    await f.usecase.read(f.f.account.manager, { ready: true }),
  ).toMatchObject({ status: 'validation_error' });
  expect(transaction).not.toHaveBeenCalled();
});

it('native composite anchor FK rejects corruption before it can become authority', async () => {
  const f = await fixture();
  const before = await inspect(f);
  await expect(
    db()
      .update(confirmations)
      .set({ anchorId: 'native-v1-2' })
      .where(eq(confirmations.id, f.saved.result.confirmationIds[0])),
  ).rejects.toThrow();
  expect(await inspect(f)).toEqual(before);
});
async function waiting() {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const result = await connection!.pool.query<{ waiting: boolean }>(
      "select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock') as waiting",
    );
    if (result.rows[0].waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected real PG lock wait');
}
it.each(['revoked', 'expired', 'rebound'] as const)(
  'historical operation rechecks %s after a real authority lock wait',
  async (mode) => {
    const f = await fixture();
    const old = await history(f);
    const before = await counts();
    const expires = '2026-11-02';
    if (mode === 'expired')
      await db()
        .update(grants)
        .set({ validTo: expires })
        .where(eq(grants.id, f.f.id + '-hr'));
    const blocker = await connection!.pool.connect();
    let pending: ReturnType<typeof f.usecase.confirm> | undefined;
    try {
      await blocker.query('begin');
      if (mode === 'rebound')
        await blocker.query(
          'lock table directory_account_bindings in row exclusive mode',
        );
      await blocker.query(
        'update directory_grants set valid_from=valid_from where id=$1',
        [f.f.id + '-hr'],
      );
      pending = f.usecase.confirm(f.f.account.manager, old.command);
      await waiting();
      if (mode === 'revoked')
        await blocker.query('delete from directory_grants where id=$1', [
          f.f.id + '-hr',
        ]);
      if (mode === 'rebound')
        await blocker.query(
          'update directory_account_bindings set person_id=$1 where account_id=$2',
          [f.f.person.outsider, f.f.account.manager],
        );
      if (mode === 'expired') f.setNow(expires + 'T00:00:00Z');
      await blocker.query('commit');
      expect(await pending).toMatchObject({ status: 'forbidden' });
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await pending;
    }
    expect(await counts()).toEqual(before);
  },
);
it('confirmation inspection waits for actual writer and sees inactive confirmation', async () => {
  const f = await fixture();
  const before = await inspect(f);
  const blocker = await connection!.pool.connect();
  let pending: ReturnType<typeof inspect> | undefined;
  try {
    await blocker.query('begin');
    await blocker.query(
      'update talent_confirmations set active=false where id=$1',
      [f.saved.result.confirmationIds[0]],
    );
    pending = inspect(f);
    await waiting();
    await blocker.query('commit');
    const after = await pending;
    expect(after.confirmations).toEqual([]);
    expect(after.revision).not.toBe(before.revision);
  } finally {
    await blocker.query('rollback');
    blocker.release();
    await pending;
  }
});
it('history rechecks newly shared complete provenance before returning text or replay', async () => {
  const f = await fixture();
  const old = await history(f);
  await db()
    .insert(eventParticipants)
    .values({ eventId: f.f.sourceEventId, personId: f.f.person.outsider });
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, f.f.person.outsider));
  const read = await f.usecase.read(f.f.account.manager, f.identity);
  expect(read.status).toBe('forbidden');
  expect(JSON.stringify(read)).not.toContain(old.record.conclusion);
  expect(
    await f.usecase.confirm(f.f.account.manager, old.command),
  ).toMatchObject({ status: 'forbidden' });
});
it.each(['40P01', '40001', 'dependency'] as const)(
  'maps native transaction %s errors without returning raw evidence',
  async (code) => {
    const f = await fixture();
    const command = await input(f);
    vi.spyOn(db(), 'transaction').mockRejectedValueOnce(
      new Error('synthetic-private-query', { cause: { code } }),
    );
    // Injected boundary classification, not a claim to have caused an actual PG fault.
    const result = f.usecase.confirm(f.f.account.manager, command);
    if (code === 'dependency') {
      await expect(result).rejects.toThrow('节点结论存储不可用');
      await expect(result).rejects.not.toHaveProperty('cause');
    } else await expect(result).resolves.toMatchObject({ status: 'conflict' });
  },
);

it('fact revision depends only on node/person facts, not the optional history selector', async () => {
  const f = await fixture();
  const current = await inspect(f);
  const historical = await f.usecase.inspect(f.f.account.manager, {
    ...f.identity,
    version: 1,
  });
  expect(historical).toEqual(current);
});
