import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { createDatabase, type Transaction } from '../../../db/client';
import { loadEvaluationContext } from '../../../usecases/evaluation-context';
import {
  createManagementObservation,
  readManagementObservations,
} from '../../../usecases/management-observations';
import * as directorySchema from '../../directory/schema';
import * as programsSchema from '../../programs/schema';
import * as staffingSchema from '../../staffing/schema';
import * as evaluationSchema from '../../evaluation-system/schema';
import * as recordsSchema from '../schema';
import * as auditSchema from '../../../platform/audit/schema';
import * as observationSchema from './schema';
import {
  createManagementObservationPostgresPorts,
  type ObservationFactReaders,
} from './postgres';
import { managementObservationSchema, ObservationError } from './model';
import {
  manual,
  imported,
  attribution,
  subject,
  source,
  now,
  reference,
  observation,
} from './__tests__/fixtures';

const name = 'qtalent_904_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined,
  connection: ReturnType<typeof createDatabase> | undefined,
  created = false;
const db = () => connection!.db;
const { organizations, people, accountBindings, grants } = directorySchema;
const {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} = programsSchema;
const { originals, originalVersions, fragments } = recordsSchema;
const {
  managementObservations: observations,
  managementObservationSources: citations,
  managementObservationOperations: operations,
} = observationSchema;
const { auditEvents } = auditSchema;
let instant = now;
let lastClock = vi.fn(() => instant);
let sourceCalls = 0;
let sourceKinds = source();

beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw)
    throw new Error(
      'BOW-904 requires explicitly configured TEST_DATABASE_URL; no skip/fake',
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid isolated test database configuration');
  }
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port === '55432' ||
    !url.pathname.endsWith('_test')
  )
    throw new Error(
      'BOW-904 requires designated loopback TEST_DATABASE_URL ending _test and forbids the old 55432 server',
    );
  admin = new Pool({ connectionString: raw, max: 3 });
  await admin.query('CREATE DATABASE "' + name + '"');
  created = true;
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  // In-memory generated schema for OUR random disposable DB, never final migration files.
  const schema = generateDrizzleJson({
    ...directorySchema,
    ...programsSchema,
    ...staffingSchema,
    ...evaluationSchema,
    ...recordsSchema,
    ...auditSchema,
    ...observationSchema,
  });
  const statements = await generateMigration(generateDrizzleJson({}), schema);
  for (const statement of statements) await db().execute(sql.raw(statement));
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      try {
        if (created) await admin.query('DROP DATABASE "' + name + '"');
      } finally {
        await admin.end();
      }
    }
  }
});
beforeEach(async () => {
  await db().execute(
    sql`truncate directory_organizations, programs_cohorts, records_originals, audit_events cascade`,
  );
  instant = now;
  lastClock = vi.fn(() => instant);
  sourceCalls = 0;
  sourceKinds = source();
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  const ids = [
    'demo-person',
    'demo-hr',
    'demo-interviewer',
    'demo-other-author',
    'demo-employee',
    'demo-outside',
    'demo-manager',
    'demo-admin',
  ];
  await db()
    .insert(people)
    .values(
      ids.map((id) => ({
        id,
        name: id === 'demo-interviewer' ? '演示面试官甲' : '演示：' + id,
        organizationId: 'demo-org',
      })),
    );
  await db()
    .insert(accountBindings)
    .values(
      ids.map((personId) => ({
        personId,
        accountId: 'account-' + personId,
        isSystemAdmin: personId === 'demo-admin',
      })),
    );
  await db()
    .insert(cohorts)
    .values([
      { id: 'demo-cohort', name: '演示期次' },
      { id: 'demo-other-cohort', name: '演示另一期次' },
    ]);
  await db()
    .insert(grants)
    .values([
      {
        id: 'demo-hr-grant',
        accountId: 'account-demo-hr',
        role: 'hr',
        scope: 'cohort',
        cohortId: 'demo-cohort',
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-manager-grant',
        accountId: 'account-demo-manager',
        role: 'manager',
        scope: 'company',
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(enrollments)
    .values([
      {
        id: 'demo-enrollment',
        personId: subject.personId,
        cohortId: 'demo-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
      {
        id: 'demo-outside-enrollment',
        personId: 'demo-outside',
        cohortId: 'demo-other-cohort',
        confirmed: true,
        validFrom: '2026-01-01',
      },
    ]);
  await db()
    .insert(evaluationNodes)
    .values([
      { id: subject.evaluationNodeId, name: '演示面试', kind: 'interview' },
      { id: 'demo-other-node', name: '演示另节点', kind: 'interview' },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values([
      subject,
      { ...subject, personId: 'demo-outside' },
      { ...subject, evaluationNodeId: 'demo-other-node' },
    ]);
  await db()
    .insert(evaluationRelations)
    .values(
      ['demo-interviewer', 'demo-other-author'].map((evaluatorId) => ({
        id: 'relation-' + evaluatorId,
        ...subject,
        evaluatorId,
        kind: 'interviewer' as const,
        validFrom: '2026-01-01T00:00:00.000Z',
      })),
    );
  await db()
    .insert(originals)
    .values({ id: 'demo-original', title: '演示面评' });
  await db()
    .insert(originalVersions)
    .values([
      {
        id: reference.originalVersionId,
        originalId: 'demo-original',
        version: 1,
        contentDigest: 'synthetic-v1',
      },
      {
        id: 'demo-v2',
        originalId: 'demo-original',
        version: 2,
        contentDigest: 'synthetic-v2',
      },
    ]);
  await db()
    .insert(fragments)
    .values({
      id: reference.fragmentId,
      originalVersionId: reference.originalVersionId,
      location: { kind: 'document', page: 2, paragraph: '演示面评综合评价' },
      excerpt: attribution().text,
    });
});
/** Test composition owns these existing-domain table fences; no production authorization/source reader is claimed. */
async function lockFacts(tx: Transaction) {
  await tx.execute(sql`lock table directory_account_bindings, directory_people, directory_grants,
    programs_enrollments, programs_assignments, programs_evaluation_nodes, programs_evaluation_node_subjects, programs_evaluation_relations,
    records_originals, records_original_versions, records_fragments in share mode`);
}
function readers(): ObservationFactReaders {
  return {
    lockFacts,
    loadSnapshot: async (tx, accountId) => {
      const { context, directory } = await loadEvaluationContext(
        tx,
        accountId,
        lastClock(),
      );
      return {
        context,
        actorName: directory.people.find(
          (p) => p.id === context.account.personId,
        )!.name,
      };
    },
    loadSources: async (tx, refs) => {
      sourceCalls++;
      const found = await tx.select().from(fragments);
      return refs.flatMap((ref) =>
        found
          .filter(
            (f) =>
              f.id === ref.fragmentId &&
              f.originalVersionId === ref.originalVersionId,
          )
          .map((f) => ({
            ...sourceKinds,
            fragmentId: f.id,
            originalVersionId: f.originalVersionId,
            location: f.location,
          })),
      );
    },
    // Synthetic trusted parser boundary; production 906 attribution storage is not installed by this test.
    loadAttribution: async () => attribution(),
  };
}
const ports = () => createManagementObservationPostgresPorts(db(), readers());
async function counts() {
  const [o, s, k, a, e, t] = await Promise.all([
    db().select().from(observations),
    db().select().from(citations),
    db().select().from(operations),
    db().select().from(auditEvents),
    db().select().from(recordsSchema.events),
    db().select().from(recordsSchema.statements),
  ]);
  return {
    observations: o.length,
    sources: s.length,
    operations: k.length,
    audits: a.length,
    events: e.length,
    statements: t.length,
  };
}
const hr = 'account-demo-hr',
  author = 'account-demo-interviewer';

it('persists without SBI, reads the stored signature, and creates no event or scoring evidence', async () => {
  const first = await createManagementObservation(ports(), hr, manual());
  expect(first.replayed).toBe(false);
  expect(first.observation).toMatchObject({
    kind: 'management-observation',
    nature: 'management_observation',
    author: { personId: 'demo-hr', name: '演示：demo-hr' },
    sources: [],
  });
  expect(await readManagementObservations(ports(), hr, subject)).toEqual([
    first.observation,
  ]);
  expect(await counts()).toEqual({
    observations: 1,
    sources: 0,
    operations: 1,
    audits: 1,
    events: 0,
    statements: 0,
  });
  expect((await db().select().from(auditEvents))[0]).toMatchObject({
    actorId: hr,
    action: 'management_observation.recorded',
    resourceId: first.observation.id,
  });
});
it('persists interviewer attribution separately from the importer and keeps source date precision', async () => {
  const result = await createManagementObservation(ports(), hr, imported());
  expect(result.observation).toMatchObject({
    author: { personId: 'demo-interviewer', name: '演示面试官甲' },
    authorUnconfirmed: true,
    importedBy: { accountId: hr, personId: 'demo-hr' },
    occurredAt: '2026-10-01',
    recordedAt: now,
    sources: [reference],
  });
  await db()
    .update(people)
    .set({ name: '演示：新显示名' })
    .where(eq(people.id, 'demo-interviewer'));
  expect(
    (await readManagementObservations(ports(), hr, subject))[0].author.name,
  ).toBe('演示面试官甲');
  expect(await counts()).toMatchObject({
    observations: 1,
    sources: 1,
    operations: 1,
    audits: 1,
    events: 0,
    statements: 0,
  });
});
it('serializes concurrent duplicate operations in PostgreSQL and rejects changed payloads', async () => {
  const result = await Promise.all(
    Array.from({ length: 4 }, () =>
      createManagementObservation(ports(), hr, manual()),
    ),
  );
  expect(new Set(result.map((r) => r.observation.id)).size).toBe(1);
  expect(result.filter((r) => !r.replayed)).toHaveLength(1);
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
  await expect(
    createManagementObservation(ports(), hr, {
      ...manual(),
      text: '演示：变载',
    }),
  ).rejects.toMatchObject({ code: 'conflict' });
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
});
it('rechecks current SQL permissions for a replay and denies employees before reading sources', async () => {
  await createManagementObservation(ports(), hr, imported());
  sourceCalls = 0;
  await expect(
    readManagementObservations(ports(), 'account-demo-employee', subject),
  ).rejects.toThrow();
  expect(sourceCalls).toBe(0);
  await db()
    .update(grants)
    .set({ revokedAt: '2026-10-31' })
    .where(eq(grants.id, 'demo-hr-grant'));
  await expect(
    createManagementObservation(ports(), hr, imported()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
});
it('rolls observation, source links and operation ledger back when the real audit insert fails', async () => {
  await db().execute(
    sql`alter table audit_events add constraint demo_904_audit_failure check(action <> 'management_observation.recorded')`,
  );
  try {
    await expect(
      createManagementObservation(ports(), hr, imported()),
    ).rejects.toThrow();
    expect(await counts()).toMatchObject({
      observations: 0,
      sources: 0,
      operations: 0,
      audits: 0,
    });
  } finally {
    await db().execute(
      sql`alter table audit_events drop constraint demo_904_audit_failure`,
    );
  }
});
it('rejects wrong original versions with an actual composite foreign key and rolls back', async () => {
  const row = managementObservationSchema.parse({
    ...observation(),
    sources: [{ ...reference, originalVersionId: 'demo-v2' }],
  });
  const store = ports();
  await expect(
    store.transaction((tx) => store.insertObservation(tx, row)),
  ).rejects.toMatchObject({ sqlState: '23503' });
  expect(await counts()).toMatchObject({
    observations: 0,
    sources: 0,
    operations: 0,
    audits: 0,
  });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function waitForDatabaseLock() {
  await vi.waitFor(
    async () => {
      const waiting = await admin!.query(
        'select count(*)::int as n from pg_stat_activity where datname=$1 and wait_event_type=$2',
        [name, 'Lock'],
      );
      expect(waiting.rows[0].n).toBeGreaterThan(0);
    },
    { interval: 15, timeout: 3000 },
  );
}
it('keeps actor operation namespaces independent and enforces the ledger owner FK', async () => {
  const a = await createManagementObservation(ports(), hr, manual());
  const b = await createManagementObservation(ports(), author, manual());
  expect(a.observation.id).not.toBe(b.observation.id);
  expect(await counts()).toMatchObject({
    observations: 2,
    operations: 2,
    audits: 2,
  });
  await expect(
    db()
      .insert(operations)
      .values({
        accountId: hr,
        operationId: 'wrong-owner',
        fingerprint: 'a'.repeat(64),
        observationId: b.observation.id,
      }),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
});
it('keeps original source order while semantic reorder replays the original immutable record', async () => {
  const second = {
    fragmentId: 'demo-second-fragment',
    originalVersionId: reference.originalVersionId,
  };
  await db()
    .insert(fragments)
    .values({
      id: second.fragmentId,
      originalVersionId: second.originalVersionId,
      location: { kind: 'document', page: 3, paragraph: '演示第二段' },
      excerpt: '演示：另一段',
    });
  const input = { ...manual(), sources: [second, reference] };
  const a = await createManagementObservation(ports(), hr, input);
  const b = await createManagementObservation(ports(), hr, {
    ...input,
    sources: [reference, second],
  });
  expect(b.replayed).toBe(true);
  expect(b.observation).toEqual(a.observation);
  expect(b.observation.sources.map((s) => s.fragmentId)).toEqual([
    second.fragmentId,
    reference.fragmentId,
  ]);
  expect(
    (await db().select().from(citations)).map((s) => s.position).sort(),
  ).toEqual([0, 1]);
});
it('permits author-only reading in a current relation but refuses other authors and revoked authors', async () => {
  const saved = await createManagementObservation(ports(), author, manual());
  expect(await readManagementObservations(ports(), author, subject)).toEqual([
    saved.observation,
  ]);
  expect(
    await readManagementObservations(
      ports(),
      'account-demo-other-author',
      subject,
    ),
  ).toEqual([]);
  expect(
    await readManagementObservations(ports(), 'account-demo-manager', subject),
  ).toHaveLength(1);
  await db()
    .update(evaluationRelations)
    .set({ revokedAt: now })
    .where(eq(evaluationRelations.evaluatorId, 'demo-interviewer'));
  await expect(
    readManagementObservations(ports(), author, subject),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
});
it('requires all source coowners and their current kinds before persisting or returning text', async () => {
  sourceKinds = {
    ...source(),
    subjects: [subject, { ...subject, personId: 'demo-outside' }],
  };
  await expect(
    createManagementObservation(ports(), hr, imported()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 0,
    sources: 0,
    operations: 0,
    audits: 0,
  });
  sourceKinds = source();
  await createManagementObservation(ports(), hr, imported());
  sourceKinds = { ...source(), requiredKinds: ['ai-inference'] };
  expect(await readManagementObservations(ports(), hr, subject)).toEqual([]);
});
it('rejects unknown accounts, no-review subjects, cross-node guesses and forged attribution at the usecase boundary', async () => {
  await expect(
    createManagementObservation(ports(), 'missing-account', manual()),
  ).rejects.toThrow();
  await expect(
    createManagementObservation(ports(), author, {
      ...manual(),
      evaluationNodeId: 'demo-other-node',
    }),
  ).rejects.toMatchObject({ code: 'forbidden' });
  await expect(
    createManagementObservation(ports(), hr, {
      ...manual(),
      author: { personId: 'demo-interviewer', name: '伪造' },
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' });
  await db()
    .update(people)
    .set({ noReview: true })
    .where(eq(people.id, subject.personId));
  await expect(
    createManagementObservation(ports(), hr, manual()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 0,
    operations: 0,
    audits: 0,
  });
});
it('holds SQL origin attribution constraints independently of the domain constructor', async () => {
  await createManagementObservation(ports(), hr, manual());
  const [row] = await db().select().from(observations);
  for (const change of [
    { authorUnconfirmed: true },
    { origin: 'interview_import' as const },
    { importedByAccountId: hr },
    { personId: 'demo-employee' },
  ]) {
    await expect(
      db()
        .insert(observations)
        .values({ ...row, id: randomUUID(), ...change }),
    ).rejects.toThrow();
  }
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
});
it('rejects duplicate references and inconsistent positions in real SQL', async () => {
  const saved = await createManagementObservation(ports(), hr, imported());
  await expect(
    db()
      .insert(citations)
      .values({
        observationId: saved.observation.id,
        position: 1,
        ...reference,
      }),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
  await expect(
    db().insert(citations).values({
      observationId: saved.observation.id,
      position: 100,
      fragmentId: 'missing',
      originalVersionId: 'missing',
    }),
  ).rejects.toThrow();
  expect(await counts()).toMatchObject({ observations: 1, sources: 1 });
});
it('rolls the already inserted observation and source back on a real operation-ledger failure', async () => {
  await db().execute(
    sql`alter table records_management_observation_operations add constraint demo_904_ledger_failure check(operation_id <> 'demo-operation')`,
  );
  try {
    await expect(
      createManagementObservation(ports(), hr, imported()),
    ).rejects.toMatchObject({ sqlState: '23514' });
    expect(await counts()).toMatchObject({
      observations: 0,
      sources: 0,
      operations: 0,
      audits: 0,
    });
  } finally {
    await db().execute(
      sql`alter table records_management_observation_operations drop constraint demo_904_ledger_failure`,
    );
  }
});
it('redacts real database rejection parameters while preserving SQLSTATE', async () => {
  const store = ports();
  const row = managementObservationSchema.parse({
    ...observation(),
    personId: 'demo-employee',
    text: '演示：不得写进错误消息的原文',
  });
  const error = await store
    .transaction((tx) => store.insertObservation(tx, row))
    .catch((e: unknown) => e);
  expect(error).toMatchObject({ sqlState: '23503' });
  expect(String(error)).not.toContain(row.text);
  expect(JSON.stringify(error)).not.toMatch(/query|params|不得写进/);
});
it('requires explicit canonical readers and only permits store work in its own transaction', async () => {
  expect(() =>
    createManagementObservationPostgresPorts(
      db(),
      {} as ObservationFactReaders,
    ),
  ).toThrow();
  const store = ports();
  await expect(
    db().transaction((tx) => store.readObservation(tx, 'missing')),
  ).rejects.toMatchObject({ code: 'invalid_data' });
  expect(
    await store.transaction((tx) => store.readObservation(tx, 'missing')),
  ).toBeNull();
  await expect(
    store.transaction((tx) =>
      store.insertObservation(tx, {
        ...observation(),
        authorUnconfirmed: true,
      }),
    ),
  ).rejects.toMatchObject({ code: 'invalid_data' });
  expect(await counts()).toMatchObject({
    observations: 0,
    operations: 0,
    audits: 0,
  });
});
it('fails closed when a persisted imported row is missing its required citation instead of returning partial data', async () => {
  await createManagementObservation(ports(), hr, imported());
  await db().delete(citations);
  await expect(
    readManagementObservations(ports(), hr, subject),
  ).rejects.toMatchObject({ code: 'invalid_data' });
});
it('loads permissions and business time after waiting for the operation lock', async () => {
  const store = ports(),
    ready = gate(),
    held = gate();
  const blocker = store.transaction(async (tx) => {
    await store.lockOperation(tx, hr, manual().operationId);
    ready.release();
    await held.promise;
  });
  await ready.promise;
  lastClock.mockClear();
  const pending = createManagementObservation(store, hr, manual()).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  try {
    await waitForDatabaseLock();
    expect(lastClock).not.toHaveBeenCalled();
    await db()
      .update(grants)
      .set({ revokedAt: '2026-10-31' })
      .where(eq(grants.id, 'demo-hr-grant'));
  } finally {
    held.release();
    await blocker;
  }
  const result = await pending;
  expect(result.value).toBeNull();
  expect(result.error).toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 0,
    operations: 0,
    audits: 0,
  });
});
it('honors an evaluator relation expiring exactly while queued before its first authorization read', async () => {
  const end = '2026-10-31T12:00:01.000Z';
  await db()
    .update(evaluationRelations)
    .set({ validTo: end })
    .where(eq(evaluationRelations.evaluatorId, 'demo-interviewer'));
  const store = ports(),
    ready = gate(),
    held = gate();
  const blocker = store.transaction(async (tx) => {
    await store.lockOperation(tx, author, manual().operationId);
    ready.release();
    await held.promise;
  });
  await ready.promise;
  lastClock.mockClear();
  const pending = createManagementObservation(store, author, manual()).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  try {
    await waitForDatabaseLock();
    expect(lastClock).not.toHaveBeenCalled();
    instant = end;
  } finally {
    held.release();
    await blocker;
  }
  expect((await pending).error).toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 0,
    operations: 0,
    audits: 0,
  });
});
it('holds the canonical fact fence through commit, serializing concurrent grant revocation after the observation', async () => {
  const ready = gate(),
    held = gate(),
    facts = readers();
  let snapshots = 0;
  const original = facts.loadSnapshot;
  facts.loadSnapshot = async (tx, id) => {
    const current = await original(tx, id);
    if (++snapshots === 1) {
      ready.release();
      await held.promise;
    }
    return current;
  };
  const store = createManagementObservationPostgresPorts(db(), facts);
  const pending = createManagementObservation(store, hr, manual()).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  await ready.promise;
  let mutationFinished = false;
  const revoked = db()
    .update(grants)
    .set({ revokedAt: '2026-10-31' })
    .where(eq(grants.id, 'demo-hr-grant'))
    .then(() => {
      mutationFinished = true;
    });
  try {
    await waitForDatabaseLock();
    expect(mutationFinished).toBe(false);
  } finally {
    held.release();
  }
  expect((await pending).value?.replayed).toBe(false);
  await revoked;
  await expect(
    readManagementObservations(ports(), hr, subject),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 1,
    operations: 1,
    audits: 1,
  });
});
it('holds original-version facts until the observation and its exact-version FK commit together', async () => {
  const ready = gate(),
    held = gate(),
    facts = readers();
  let calls = 0;
  const original = facts.loadSources;
  facts.loadSources = async (tx, refs) => {
    const result = await original(tx, refs);
    if (++calls === 1) {
      ready.release();
      await held.promise;
    }
    return result;
  };
  const store = createManagementObservationPostgresPorts(db(), facts);
  const pending = createManagementObservation(store, hr, imported()).then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  );
  await ready.promise;
  let finished = false;
  const changed = db()
    .update(fragments)
    .set({ originalVersionId: 'demo-v2' })
    .where(eq(fragments.id, reference.fragmentId))
    .then(
      () => ({ error: null }),
      (error: unknown) => ({ error }),
    )
    .finally(() => {
      finished = true;
    });
  try {
    await waitForDatabaseLock();
    expect(finished).toBe(false);
  } finally {
    held.release();
  }
  expect((await pending).value?.replayed).toBe(false);
  expect((await changed).error).toMatchObject({ cause: { code: '23503' } });
  expect(await counts()).toMatchObject({
    observations: 1,
    sources: 1,
    operations: 1,
    audits: 1,
  });
});
it('rereads the clock after actual writes and rolls back when the current relation expires before return', async () => {
  const end = '2026-10-31T12:00:01.000Z';
  await db()
    .update(evaluationRelations)
    .set({ validTo: end })
    .where(eq(evaluationRelations.evaluatorId, 'demo-interviewer'));
  const store = ports(),
    audit = store.audit;
  store.audit = async (...args) => {
    await audit(...args);
    instant = end;
  };
  await expect(
    createManagementObservation(store, author, manual()),
  ).rejects.toMatchObject({ code: 'forbidden' });
  expect(await counts()).toMatchObject({
    observations: 0,
    operations: 0,
    audits: 0,
  });
});

it('redacts a real Drizzle parameter-serialization failure without SQLSTATE including text and signature', async () => {
  const store = ports(),
    text = '演示：不应回显的观察正文',
    authorName = '演示：不应回显的署名';
  const bad = {
    toPostgres() {
      throw new Error('Synthetic transport conversion failed');
    },
  };
  let raw: unknown;
  await db().transaction(async (tx) => {
    try {
      await tx.execute(sql`select ${text},${authorName},${bad}`);
    } catch (error) {
      raw = error;
    }
  });
  expect(String(raw)).toContain(text);
  expect(String(raw)).toContain(authorName);
  const projected = await store
    .transaction((tx) => tx.execute(sql`select ${text},${authorName},${bad}`))
    .catch((e: unknown) => e);
  expect(projected).toMatchObject({
    name: 'ObservationPersistenceError',
    sqlState: undefined,
  });
  expect(String(projected)).not.toContain(text);
  expect(String(projected)).not.toContain(authorName);
  expect(JSON.stringify(projected)).not.toMatch(/query|params|cause|不应回显/);
});
it('preserves the stable business ObservationError but sanitizes other error values and rolls back', async () => {
  const store = ports();
  const domain = new ObservationError('forbidden');
  await expect(
    store.transaction(async () => {
      throw domain;
    }),
  ).rejects.toBe(domain);
  for (const reason of [
    new Error('演示：敏感内容'),
    '演示：敏感原始异常',
    null,
  ]) {
    const error = await store
      .transaction(async (tx) => {
        await store.insertObservation(tx, observation());
        throw reason;
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      name: 'ObservationPersistenceError',
      sqlState: undefined,
    });
    expect(String(error)).not.toContain('敏感');
    expect(await counts()).toMatchObject({
      observations: 0,
      operations: 0,
      audits: 0,
    });
  }
});
