import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import { recordEntryAudit } from '../../usecases/entry/audit';
import { auditEvents } from './schema';
import { recordAudit } from './index';
let c: Awaited<ReturnType<typeof nativeDatabase>>;
beforeAll(async () => {
  c = await nativeDatabase();
  // Use only the columns actually present in the published pre-upgrade table.
  await c.db.execute(
    sql`insert into audit_events(id,actor_id,action,resource_id) values ('demo-legacy-audit','demo-legacy-actor','synthetic.legacy','demo-old-resource')`,
  );
  if (process.env.BOW_903_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_903_TEST_MIGRATIONS_DIR,
    });
}, 30000);
afterAll(async () => {
  await c?.close();
});
it('persists exact channel and resource revision in the caller transaction, including a real null resource', async () => {
  const actorId = randomUUID();
  await c.db.transaction(async (tx) => {
    await recordEntryAudit(tx, {
      actorId,
      action: 'entry.tool.person',
      channel: 'mcp',
      resourceId: null,
      revision: null,
    });
    expect(
      await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, actorId)),
    ).toMatchObject([
      { resourceId: null, metadata: { channel: 'mcp', revision: null } },
    ]);
    expect(
      await c.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, actorId)),
    ).toEqual([]);
  });
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, actorId)),
  ).toHaveLength(1);
});
it('rolls audit back with caller failure and preserves legacy events without metadata', async () => {
  const actorId = randomUUID(),
    failure = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await recordEntryAudit(tx, {
        actorId,
        action: 'entry.tool.record',
        channel: 'wecom',
        resourceId: 'demo-batch',
        revision: 2,
      });
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, actorId)),
  ).toEqual([]);
  await recordAudit(c.db, {
    actorId,
    action: 'legacy.synthetic',
    resourceId: 'demo-legacy',
  });
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorId, actorId)),
  ).toMatchObject([{ resourceId: 'demo-legacy', metadata: null }]);
});
it('rejects absent, invalid, secret-bearing or excessive metadata keys at SQL and runtime boundaries', async () => {
  for (const metadata of [
    {},
    { channel: 'mcp' },
    { revision: 1 },
    { channel: null, revision: 1 },
    { channel: 'invalid', revision: 1 },
    { channel: 'mcp', revision: '1' },
    { channel: 'mcp', revision: 0 },
    { channel: 'mcp', revision: -1 },
    { channel: 'mcp', revision: 1.5 },
    { channel: 'mcp', revision: 9007199254740992 },
    { channel: 'mcp', revision: 1, token: 'synthetic-must-not-persist' },
    { channel: 'mcp', revision: null, text: 'x'.repeat(300) },
  ]) {
    const actorId = randomUUID();
    // Deliberately malformed JSON: direct SQL is an independently reachable boundary.
    await expect(
      c.db.insert(auditEvents).values({
        id: randomUUID(),
        actorId,
        action: 'synthetic',
        resourceId: null,
        metadata: metadata as never,
      }),
    ).rejects.toThrow();
    await expect(
      recordAudit(c.db, {
        actorId,
        action: 'synthetic',
        resourceId: null,
        metadata: metadata as never,
      }),
    ).rejects.toThrow();
    expect(
      await c.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorId, actorId)),
    ).toEqual([]);
  }
});

it('preserves an existing pre-migration audit fact without inventing channel or revision', async () => {
  expect(
    await c.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.id, 'demo-legacy-audit')),
  ).toMatchObject([
    {
      actorId: 'demo-legacy-actor',
      action: 'synthetic.legacy',
      resourceId: 'demo-old-resource',
      metadata: null,
    },
  ]);
});

it('returns the actual inserted id while leaving commit ownership to the caller', async () => {
  const actorId = randomUUID();
  const id = await c.db.transaction(async (tx) => {
    const insertedId = await recordAudit(tx, {
      actorId,
      action: 'synthetic.audit.receipt',
      resourceId: null,
      metadata: { channel: 'web', revision: null },
    });
    expect(
      await tx.select().from(auditEvents).where(eq(auditEvents.id, insertedId)),
    ).toMatchObject([{ id: insertedId, actorId, resourceId: null }]);
    expect(
      await c.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.id, insertedId)),
    ).toEqual([]);
    return insertedId;
  });
  expect(
    await c.db.select().from(auditEvents).where(eq(auditEvents.id, id)),
  ).toMatchObject([{ id, actorId }]);
});

it('does not retain a returned audit id when the outer transaction rolls back', async () => {
  let insertedId = '';
  const failure = new Error('synthetic audit receipt rollback');
  await expect(
    c.db.transaction(async (tx) => {
      insertedId = await recordAudit(tx, {
        actorId: randomUUID(),
        action: 'synthetic.audit.rollback',
        resourceId: null,
      });
      expect(
        await tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.id, insertedId)),
      ).toHaveLength(1);
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(insertedId).not.toBe('');
  expect(
    await c.db.select().from(auditEvents).where(eq(auditEvents.id, insertedId)),
  ).toEqual([]);
});
