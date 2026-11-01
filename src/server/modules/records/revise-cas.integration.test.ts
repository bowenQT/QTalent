import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../../db/client';
import { people } from '../directory';
import {
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
} from './save-state/schema';
import { reviseTrustedRecordDraftBatch } from './write';
import { saveRecordDraft, undoRecordSave } from '../../usecases/record-save';
import {
  seedRecordCase,
  seedRecordRules,
} from '../../../../tests/fixtures/bow-846/native';
import type { RecordBatchDraftSet } from '../../../contracts/record';

let admin: Pool;
let connection: ReturnType<typeof createDatabase>;
const name = 'qtalent_revise_' + randomUUID().replaceAll('-', '') + '_test';
beforeAll(async () => {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error('Real isolated TEST_DATABASE_URL required');
  const url = new URL(raw);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test') ||
    url.port === '55432'
  )
    throw new Error('Unsafe test database');
  admin = new Pool({ connectionString: raw });
  await admin.query('CREATE DATABASE "' + name + '"');
  url.pathname = '/' + name;
  connection = createDatabase(url.toString());
  await migrate(connection.db, {
    migrationsFolder: 'src/server/db/migrations',
  });
  await seedRecordRules(connection.db);
});
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query('DROP DATABASE IF EXISTS "' + name + '"');
    await admin.end();
  }
});
async function setup() {
  const f = await seedRecordCase(connection.db, { secondDraft: true });
  const value = {
    expectedBatchRevision: 1,
    expectedDrafts: [f.draft, f.otherDraft].map((d) => ({
      draftId: d.draftId,
      revision: 1,
    })),
    draftSet: {
      batchId: f.draft.batchId,
      revision: 2,
      drafts: structuredClone([f.draft, f.otherDraft]),
      duplicateCandidates: [],
    } satisfies RecordBatchDraftSet,
  };
  return { f, value };
}
async function snapshot(batchId: string) {
  const [batch] = await connection.db
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, batchId));
  const drafts = await connection.db
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, batchId))
    .orderBy(recordDrafts.draftId);
  return { batch, drafts };
}
type Input = Awaited<ReturnType<typeof setup>>['value'];
const revise = (value: Input) =>
  connection.db.transaction((tx) => reviseTrustedRecordDraftBatch(tx, value));
it('preserves stable identities and immutable input while incrementing only changed drafts', async () => {
  const { f, value } = await setup();
  const before = await snapshot(f.draft.batchId);
  value.draftSet.drafts[0].sbi.title = '演示修订事件';
  value.draftSet.drafts[0].revision = 2;
  await revise(value);
  const after = await snapshot(f.draft.batchId);
  expect(after.batch).toEqual({ ...before.batch, revision: 2 });
  expect(after.drafts.map((d) => [d.draftId, d.revision])).toEqual([
    [f.draft.draftId, 2],
    [f.otherDraft.draftId, 1],
  ]);
  expect(after.drafts[0].draft.sbi.title).toBe('演示修订事件');
  expect(after.drafts[1]).toEqual(before.drafts[1]);
});
it('advances only the batch for a semantic no-op', async () => {
  const { f, value } = await setup();
  const before = await snapshot(f.draft.batchId);
  await revise(value);
  const after = await snapshot(f.draft.batchId);
  expect(after).toEqual({
    batch: { ...before.batch, revision: 2 },
    drafts: before.drafts,
  });
});
const badInputs: [string, (value: Input) => void][] = [
  [
    'stale batch',
    (v) => {
      v.expectedBatchRevision = 2;
      v.draftSet.revision = 3;
    },
  ],
  [
    'missing expected draft',
    (v) => {
      v.expectedDrafts.pop();
    },
  ],
  [
    'duplicate expected draft',
    (v) => {
      v.expectedDrafts[1] = v.expectedDrafts[0];
    },
  ],
  [
    'stale draft',
    (v) => {
      v.expectedDrafts[1].revision = 2;
    },
  ],
  [
    'new stable ID',
    (v) => {
      v.draftSet.drafts[1].draftId += '-replacement';
    },
  ],
  [
    'changed body without increment',
    (v) => {
      v.draftSet.drafts[0].sbi.title = '演示修订';
    },
  ],
  [
    'unchanged body with increment',
    (v) => {
      v.draftSet.drafts[0].revision = 2;
    },
  ],
  [
    'different node',
    (v) => {
      v.draftSet.drafts[0].evaluationNodeId += '-other';
      v.draftSet.drafts[0].revision = 2;
    },
  ],
  [
    'different rule',
    (v) => {
      v.draftSet.drafts[0].dimensionVersionId += '-other';
      v.draftSet.drafts[0].revision = 2;
    },
  ],
  [
    'different project',
    (v) => {
      v.draftSet.drafts[0].projectId = 'untrusted-project';
      v.draftSet.drafts[0].revision = 2;
    },
  ],
  [
    'rewritten source',
    (v) => {
      v.draftSet.drafts[0].sourceReferences[0].fragmentId += '-other';
      v.draftSet.drafts[0].scores = [];
      v.draftSet.drafts[0].revision = 2;
    },
  ],
];
it.each(badInputs)(
  'rejects %s with no partial mutation',
  async (_name, mutate) => {
    const { f, value } = await setup();
    const before = await snapshot(f.draft.batchId);
    mutate(value);
    await expect(revise(value)).rejects.toMatchObject({ status: 'conflict' });
    expect(await snapshot(f.draft.batchId)).toEqual(before);
  },
);
it.each([false, true])(
  'never overwrites human history (withdrawn=%s)',
  async (withdrawn) => {
    const { f, value } = await setup();
    const saved = await saveRecordDraft(
      connection.db,
      f.account.one,
      f.input,
      f.clock,
    );
    if (withdrawn)
      await undoRecordSave(
        connection.db,
        f.account.one,
        { operation_id: f.id + '-undo', saveId: saved.result.saveId },
        f.clock,
      );
    const before = await snapshot(f.draft.batchId);
    value.expectedBatchRevision = before.batch.revision;
    value.expectedDrafts = before.drafts.map((d) => ({
      draftId: d.draftId,
      revision: d.revision,
    }));
    value.draftSet.revision = before.batch.revision + 1;
    value.draftSet.drafts = before.drafts.map((d) => d.draft);
    await expect(revise(value)).rejects.toMatchObject({
      reason: 'human_confirmation_exists',
    });
    expect(await snapshot(f.draft.batchId)).toEqual(before);
  },
);
it('rejects an existing event mapping even without a save ledger', async () => {
  const { f, value } = await setup();
  await connection.db
    .insert(recordDraftEvents)
    .values({
      batchId: f.draft.batchId,
      draftId: f.draft.draftId,
      personId: f.person.one,
      eventId: f.sourceEventId,
    });
  await expect(revise(value)).rejects.toMatchObject({
    reason: 'human_confirmation_exists',
  });
});
it('serializes competing revisions so only one writer commits', async () => {
  const { f, value } = await setup();
  const results = await Promise.allSettled([
    revise(value),
    revise(structuredClone(value)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect((await snapshot(f.draft.batchId)).batch.revision).toBe(2);
});
it('rolls back the caller transaction when a stale draft fails CAS', async () => {
  const { f, value } = await setup();
  value.expectedDrafts[1].revision = 99;
  await expect(
    connection.db.transaction(async (tx) => {
      await tx
        .update(people)
        .set({ noReview: true })
        .where(eq(people.id, f.person.one));
      await reviseTrustedRecordDraftBatch(tx, value);
    }),
  ).rejects.toMatchObject({ status: 'conflict' });
  expect(
    (
      await connection.db
        .select()
        .from(people)
        .where(eq(people.id, f.person.one))
    )[0].noReview,
  ).toBe(false);
});
