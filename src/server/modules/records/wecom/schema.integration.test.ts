import { createHash, randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../../tests/fixtures/bow-845/native';
import { accountBindings, organizations, people } from '../../directory';
import { wecomBindings } from '../../../auth/entry/schema';
import { entryAccountBindingDigest } from '../../../auth/entry/persistent';
import { wecomMessages, wecomReceiptAttempts } from './schema';
import { wecomArchivedMediaListSchema } from './facts';
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = new Date('2026-11-01T12:00:00Z');
let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  if (process.env.BOW_909_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_909_TEST_MIGRATIONS_DIR,
    });
  await c.db.select().from(wecomMessages).limit(1);
}, 30000);
afterAll(async () => {
  await c?.close();
});
async function fixture() {
  const id = randomUUID(),
    accountId = 'demo-account-' + id,
    personId = 'demo-person-' + id;
  await c.db
    .insert(organizations)
    .values({ id, name: '演示组织', shortName: '演示' });
  await c.db
    .insert(people)
    .values({ id: personId, name: '演示化名', organizationId: id });
  await c.db.insert(accountBindings).values({ accountId, personId });
  const identity = {
    scope: 'demo-scope',
    botId: 'demo-bot',
    senderId: id,
    messageId: id,
  };
  await c.db.insert(wecomBindings).values({
    id,
    accountId,
    accountBindingDigest: entryAccountBindingDigest(accountId, personId),
    revision: 1,
    expiresAt: new Date('2026-11-02'),
    scope: identity.scope,
    botId: identity.botId,
    senderId: id,
  });
  const message = {
    key: digest([identity.scope, identity.botId, identity.senderId, id]),
    ...identity,
    actorAccountId: accountId,
    actorPersonId: personId,
    credentialId: id,
    credentialRevision: 1,
    inputDigest: digest('synthetic-input'),
    partCount: 1,
    archiveRefs: [],
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  await c.db.insert(wecomMessages).values(message);
  return message;
}
function receipt(
  messageKey: string,
  kind: 'group_ack' | 'private_receipt' = 'private_receipt',
  batchStatus: 'processing' | 'awaiting_confirmation' = 'processing',
) {
  const batchId = kind === 'group_ack' ? null : 'demo-batch';
  const batchRevision = kind === 'group_ack' ? null : 1;
  const status = kind === 'group_ack' ? null : batchStatus;
  return {
    key: digest([messageKey, kind, batchId, batchRevision, status]),
    messageKey,
    kind,
    batchId,
    batchRevision,
    batchStatus: status,
    fingerprint: digest([kind, batchId, batchRevision, status]),
    state: 'reserved' as const,
    attemptedAt: now,
  };
}
it('deduplicates messages by both deterministic key and actual sender tuple', async () => {
  const message = await fixture();
  await expect(
    c.db
      .insert(wecomMessages)
      .values({ ...message, key: digest(randomUUID()) }),
  ).rejects.toThrow();
  await expect(
    c.db.insert(wecomMessages).values({ ...message, messageId: randomUUID() }),
  ).rejects.toThrow();
});
it('keeps processing and awaiting-confirmation distinct at the same batch revision, and deduplicates both', async () => {
  const message = await fixture();
  for (const status of ['processing', 'awaiting_confirmation'] as const) {
    const row = receipt(message.key, 'private_receipt', status);
    await c.db.insert(wecomReceiptAttempts).values(row);
    await expect(
      c.db
        .insert(wecomReceiptAttempts)
        .values({ ...row, key: digest(randomUUID()) }),
    ).rejects.toThrow();
  }
  expect(
    await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(eq(wecomReceiptAttempts.messageKey, message.key)),
  ).toHaveLength(2);
});
it('deduplicates null-batch group acknowledgements and forbids ambiguous receipt shapes', async () => {
  const message = await fixture(),
    row = receipt(message.key, 'group_ack');
  await c.db.insert(wecomReceiptAttempts).values(row);
  await expect(
    c.db
      .insert(wecomReceiptAttempts)
      .values({ ...row, key: digest(randomUUID()) }),
  ).rejects.toThrow();
  for (const change of [
    { batchId: 'demo-batch' },
    { batchRevision: 1 },
    { batchStatus: 'processing' as const },
  ])
    await expect(
      c.db
        .insert(wecomReceiptAttempts)
        .values({ ...row, ...change, key: digest(randomUUID()) }),
    ).rejects.toThrow();
  for (const change of [
    { batchId: null },
    { batchRevision: null },
    { batchStatus: null },
    { batchRevision: 0 },
  ])
    await expect(
      c.db.insert(wecomReceiptAttempts).values({
        ...receipt(message.key),
        ...change,
        key: digest(randomUUID()),
      }),
    ).rejects.toThrow();
});
it('preserves reserved/unknown without acknowledgement and requires a real ordered ACK time', async () => {
  const message = await fixture(),
    row = receipt(message.key);
  await c.db.insert(wecomReceiptAttempts).values(row);
  await c.db
    .update(wecomReceiptAttempts)
    .set({ state: 'outcome_unknown' })
    .where(eq(wecomReceiptAttempts.key, row.key));
  expect(
    await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).toMatchObject([{ state: 'outcome_unknown', acknowledgedAt: null }]);
  await expect(
    c.db
      .update(wecomReceiptAttempts)
      .set({ state: 'acknowledged' })
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).rejects.toThrow();
  await expect(
    c.db
      .update(wecomReceiptAttempts)
      .set({ acknowledgedAt: now })
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).rejects.toThrow();
  await expect(
    c.db
      .update(wecomReceiptAttempts)
      .set({
        state: 'acknowledged',
        acknowledgedAt: new Date(now.getTime() - 1),
      })
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).rejects.toThrow();
  await c.db
    .update(wecomReceiptAttempts)
    .set({ state: 'acknowledged', acknowledgedAt: now })
    .where(eq(wecomReceiptAttempts.key, row.key));
});
it('stores only bounded archive references; rejects text, URL, key, headers and malformed references', async () => {
  const message = await fixture();
  const valid = {
    partIndex: 0,
    kind: 'image' as const,
    uploadId: 'demo-upload',
    originalVersionId: 'demo-original-version',
    sha256: 'a'.repeat(64),
  };
  expect(wecomArchivedMediaListSchema.parse([valid])).toEqual([valid]);
  await c.db
    .update(wecomMessages)
    .set({ archiveRefs: [valid] })
    .where(eq(wecomMessages.key, message.key));
  const bad = [
    null,
    {},
    { ...valid, partIndex: null },
    { ...valid, partIndex: 0.5 },
    { ...valid, partIndex: 20 },
    { ...valid, kind: 'text' },
    { ...valid, sha256: 'bad' },
    { ...valid, uploadId: '' },
    ...['url', 'aesKey', 'text', 'headers', 'other'].map((key) => ({
      ...valid,
      [key]: 'synthetic-forbidden-field',
    })),
  ];
  for (const ref of bad) {
    expect(wecomArchivedMediaListSchema.safeParse([ref]).success).toBe(false);
    await expect(
      c.db
        .update(wecomMessages)
        .set({ archiveRefs: [ref] as never })
        .where(eq(wecomMessages.key, message.key)),
    ).rejects.toThrow();
  }
  await expect(
    c.db
      .update(wecomMessages)
      .set({ archiveRefs: Array.from({ length: 21 }, () => valid) })
      .where(eq(wecomMessages.key, message.key)),
  ).rejects.toThrow();
  expect(wecomArchivedMediaListSchema.safeParse([valid, valid]).success).toBe(
    false,
  );
});
it('does not invent target or completed producer facts and rejects missing real FK rows', async () => {
  const message = await fixture();
  for (const patch of [
    { personIds: ['demo-person'] },
    { projectId: 'missing-project' },
    { collectionId: 'unverified-collection' },
    { batchId: 'demo-batch' },
    { jobId: 'missing-job' },
    { inputId: 'missing-input' },
    { credentialId: 'missing-credential' },
    { actorPersonId: 'missing-person' },
    { credentialRevision: 0 },
    { revision: 0 },
  ])
    await expect(
      c.db
        .update(wecomMessages)
        .set(patch)
        .where(eq(wecomMessages.key, message.key)),
    ).rejects.toThrow();
  const [stored] = await c.db
    .select()
    .from(wecomMessages)
    .where(eq(wecomMessages.key, message.key));
  expect(stored).toMatchObject({
    evaluationNodeId: null,
    personIds: null,
    projectId: null,
    collectionId: null,
    batchId: null,
    jobId: null,
    inputId: null,
  });
});
it('rolls reservation back with the outer transaction and makes committed reservation visible before any sender can run', async () => {
  const message = await fixture(),
    row = receipt(message.key),
    failure = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await tx.insert(wecomReceiptAttempts).values(row);
      expect(
        await c.db
          .select()
          .from(wecomReceiptAttempts)
          .where(eq(wecomReceiptAttempts.key, row.key)),
      ).toEqual([]);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(
    await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).toEqual([]);
  await c.db.transaction((tx) => tx.insert(wecomReceiptAttempts).values(row));
  expect(
    await c.db
      .select()
      .from(wecomReceiptAttempts)
      .where(eq(wecomReceiptAttempts.key, row.key)),
  ).toMatchObject([{ state: 'reserved' }]);
});
