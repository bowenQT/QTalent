import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import type { Transaction } from '../../db/client';
import {
  accountBindings,
  organizations,
  people,
} from '../../modules/directory';
import { session, user } from '../schema';
import { createEntryIdentityService } from './identity';
import {
  createAgentApiEntryAuthenticator,
  entryAccountBindingDigest,
  type VerifiedAgentOwner,
} from './persistent';
import { agentApiBindings } from './schema';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
const at = new Date('2026-11-01T12:00:00Z');
const expiresAt = new Date('2026-11-01T13:00:00Z');
beforeAll(async () => {
  c = await nativeDatabase();
  // Same scoped transitional migration override as the existing 903 suite.
  if (process.env.BOW_903_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_903_TEST_MIGRATIONS_DIR,
    });
  await c.db
    .select({ id: agentApiBindings.id })
    .from(agentApiBindings)
    .limit(1);
}, 30000);
afterAll(async () => {
  await c?.close();
});

async function setup() {
  const id = randomUUID();
  const accountId = 'demo-account-' + id;
  const personId = 'demo-person-' + id;
  const other = 'demo-other-' + id;
  await c.db
    .insert(organizations)
    .values({ id, name: '演示组织', shortName: '演示' });
  await c.db.insert(people).values(
    [personId, other].map((person) => ({
      id: person,
      name: '演示化名',
      organizationId: id,
      demo: true,
    })),
  );
  await c.db
    .insert(accountBindings)
    .values({ accountId, personId, isSystemAdmin: false });
  await c.db
    .insert(user)
    .values({ id: accountId, name: '演示', email: id + '@example.invalid' });
  const owner = {
    accountId,
    agentId: 'demo-agent-' + id,
    sessionId: 'demo-session-' + id,
  };
  await c.db.insert(session).values({
    id: owner.sessionId,
    userId: accountId,
    token: 'synthetic-session-' + id,
    expiresAt,
  });
  await c.db.insert(agentApiBindings).values({
    id,
    accountId,
    agentId: owner.agentId,
    sessionId: owner.sessionId,
    accountBindingDigest: entryAccountBindingDigest(accountId, personId),
    revision: 1,
    expiresAt,
    revokedAt: null,
  });
  return { id, accountId, personId, other, owner };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function identities(f: Fixture, now: () => Date = () => at) {
  return createEntryIdentityService(
    {
      agentapi: createAgentApiEntryAuthenticator(
        c.db,
        async () => f.owner,
        now,
      ),
    },
    now,
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function signalBeforeCompletion<T>(signal: Promise<T>, task: Promise<unknown>) {
  return Promise.race([
    signal,
    task.then(() => {
      throw new Error('Transaction ended before its barrier');
    }),
  ]);
}
async function pid(tx: Transaction) {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid`,
  );
  return result.rows[0].pid;
}
// Observe PostgreSQL's actual lock wait, not elapsed time as a proxy for locking.
async function waitForBlock(waiter: number, blocker: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await c.pool.query<{ blocked: boolean }>(
      'select $2::integer = any(pg_blocking_pids($1::integer)) as blocked',
      [waiter, blocker],
    );
    if (result.rows[0].blocked) return;
    await delay(10);
  }
  throw new Error('Expected PostgreSQL row-lock wait was not observed');
}
const changes = ['agent revoke', 'directory rebind', 'session expiry'] as const;
type Change = (typeof changes)[number];
async function invalidate(tx: Transaction, kind: Change, f: Fixture) {
  if (kind === 'agent revoke')
    await tx
      .update(agentApiBindings)
      .set({ revokedAt: at })
      .where(eq(agentApiBindings.id, f.id));
  else if (kind === 'directory rebind')
    await tx
      .update(accountBindings)
      .set({ personId: f.other })
      .where(eq(accountBindings.accountId, f.accountId));
  else
    await tx
      .update(session)
      .set({ expiresAt: at })
      .where(eq(session.id, f.owner.sessionId));
}

it('reads the exact AgentAPI capability in the caller transaction and returns only identity metadata', async () => {
  const f = await setup();
  const issuer = identities(f);
  const cap = await issuer.authenticate('agentapi', { personId: f.other });
  const result = await c.db.transaction(
    (tx) => issuer.currentInTransaction(tx, cap),
    {
      isolationLevel: 'read committed',
    },
  );
  expect(result).toEqual({
    channel: 'agentapi',
    accountId: f.accountId,
    personId: f.personId,
    credentialId: f.id,
    credentialRevision: 1,
  });
  expect(JSON.stringify(cap)).toBe('{"channel":"agentapi"}');
});

it.each(changes)(
  'observes own %s, not pool state, and retires the failed cap across rollback',
  async (kind) => {
    const f = await setup();
    const issuer = identities(f);
    const cap = await issuer.authenticate('agentapi', true);
    const outside = await issuer.authenticate('agentapi', true);
    const rollback = new Error('synthetic rollback');
    await expect(
      c.db.transaction(
        async (tx) => {
          await invalidate(tx, kind, f);
          // The original pool-backed path cannot see uncommitted caller changes.
          expect(await issuer.current(outside)).toHaveProperty(
            'personId',
            f.personId,
          );
          await expect(
            issuer.currentInTransaction(tx, cap),
          ).rejects.toMatchObject({ kind: 'unauthenticated' });
          throw rollback;
        },
        { isolationLevel: 'read committed' },
      ),
    ).rejects.toBe(rollback);
    expect(await issuer.current(outside)).toHaveProperty(
      'personId',
      f.personId,
    );
    await expect(issuer.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    const fresh = await issuer.authenticate('agentapi', true);
    expect(
      await c.db.transaction((tx) => issuer.currentInTransaction(tx, fresh)),
    ).toHaveProperty('personId', f.personId);
  },
);

it('sees a transaction-local valid replacement directory binding but refuses to retarget an old cap', async () => {
  const f = await setup();
  const issuer = identities(f);
  const cap = await issuer.authenticate('agentapi', true);
  const reader = createAgentApiEntryAuthenticator(
    c.db,
    async () => f.owner,
    () => at,
  );
  const rollback = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await tx
        .update(accountBindings)
        .set({ personId: f.other })
        .where(eq(accountBindings.accountId, f.accountId));
      await tx
        .update(agentApiBindings)
        .set({
          accountBindingDigest: entryAccountBindingDigest(f.accountId, f.other),
          revision: 2,
        })
        .where(eq(agentApiBindings.id, f.id));
      expect(await reader.currentInTransaction!(tx, f.id)).toMatchObject({
        personId: f.other,
        revision: 2,
      });
      expect(await reader.current(f.id)).toMatchObject({
        personId: f.personId,
        revision: 1,
      });
      await expect(issuer.currentInTransaction(tx, cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  await expect(issuer.current(cap)).rejects.toMatchObject({
    kind: 'unauthenticated',
  });
});

it.each(changes)(
  'waits for a concurrent %s and re-reads its committed result under RC',
  async (kind) => {
    const f = await setup();
    const issuer = identities(f);
    const cap = await issuer.authenticate('agentapi', true);
    const locked = deferred<number>();
    const release = deferred<void>();
    const started = deferred<number>();
    const writer = c.db.transaction(async (tx) => {
      await invalidate(tx, kind, f);
      locked.resolve(await pid(tx));
      await release.promise;
    });
    let reader: Promise<unknown> | undefined;
    try {
      const blocker = await signalBeforeCompletion(locked.promise, writer);
      reader = c.db.transaction(
        async (tx) => {
          started.resolve(await pid(tx));
          return issuer.currentInTransaction(tx, cap);
        },
        { isolationLevel: 'read committed' },
      );
      const result = reader.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      await waitForBlock(
        await signalBeforeCompletion(started.promise, reader),
        blocker,
      );
      release.resolve();
      await writer;
      expect(await result).toMatchObject({
        ok: false,
        error: { kind: 'unauthenticated' },
      });
      await expect(issuer.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    } finally {
      release.resolve();
      await Promise.allSettled([writer, ...(reader ? [reader] : [])]);
    }
  },
  15000,
);

it.each(changes)(
  'holds authoritative locks against %s until the caller transaction ends',
  async (kind) => {
    const f = await setup();
    const issuer = identities(f);
    const cap = await issuer.authenticate('agentapi', true);
    const locked = deferred<number>();
    const release = deferred<void>();
    const started = deferred<number>();
    const reader = c.db.transaction(
      async (tx) => {
        expect(await issuer.currentInTransaction(tx, cap)).toHaveProperty(
          'personId',
          f.personId,
        );
        locked.resolve(await pid(tx));
        await release.promise;
      },
      { isolationLevel: 'read committed' },
    );
    let writer: Promise<unknown> | undefined;
    try {
      const blocker = await signalBeforeCompletion(locked.promise, reader);
      writer = c.db.transaction(async (tx) => {
        started.resolve(await pid(tx));
        await invalidate(tx, kind, f);
      });
      await waitForBlock(
        await signalBeforeCompletion(started.promise, writer),
        blocker,
      );
      release.resolve();
      await Promise.all([reader, writer]);
      await expect(issuer.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    } finally {
      release.resolve();
      await Promise.allSettled([reader, ...(writer ? [writer] : [])]);
    }
  },
  15000,
);

it('rejects an established Repeatable Read snapshot instead of using it as current proof', async () => {
  const f = await setup();
  const issuer = identities(f);
  const cap = await issuer.authenticate('agentapi', true);
  await c.db.transaction(
    async (tx) => {
      await tx
        .select({ id: agentApiBindings.id })
        .from(agentApiBindings)
        .where(eq(agentApiBindings.id, f.id));
      await c.db
        .update(agentApiBindings)
        .set({ revokedAt: at })
        .where(eq(agentApiBindings.id, f.id));
      // This transaction still sees the old row, proving why it cannot authenticate.
      const [stale] = await tx
        .select({ revokedAt: agentApiBindings.revokedAt })
        .from(agentApiBindings)
        .where(eq(agentApiBindings.id, f.id));
      expect(stale.revokedAt).toBeNull();
      await expect(issuer.currentInTransaction(tx, cap)).rejects.toMatchObject({
        kind: 'unavailable',
      });
    },
    { isolationLevel: 'repeatable read' },
  );
  await c.db
    .update(agentApiBindings)
    .set({ revokedAt: null })
    .where(eq(agentApiBindings.id, f.id));
  await expect(issuer.current(cap)).rejects.toMatchObject({
    kind: 'unauthenticated',
  });
});

it.each(['accountId', 'agentId', 'sessionId', 'missing'] as const)(
  'requires trusted verifiedOwner again on every tx read: %s',
  async (field) => {
    const f = await setup();
    let proof: VerifiedAgentOwner | null = f.owner;
    let calls = 0;
    const reader = createAgentApiEntryAuthenticator(
      c.db,
      async () => {
        calls++;
        return proof;
      },
      () => at,
    );
    const issuer = createEntryIdentityService({ agentapi: reader }, () => at);
    const cap = await issuer.authenticate('agentapi', f.owner);
    await c.db.transaction((tx) => issuer.currentInTransaction(tx, cap));
    expect(calls).toBe(2);
    proof = field === 'missing' ? null : { ...f.owner, [field]: 'wrong' };
    await expect(
      c.db.transaction((tx) => issuer.currentInTransaction(tx, cap)),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(calls).toBe(3);
    proof = f.owner;
    await expect(
      c.db.transaction((tx) => issuer.currentInTransaction(tx, cap)),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(calls).toBe(3);
  },
);

it('does not extend the issued capability when persistent row and session deadlines are renewed', async () => {
  const f = await setup();
  let now = at;
  const issuer = identities(f, () => now);
  const cap = await issuer.authenticate('agentapi', true);
  await c.db
    .update(agentApiBindings)
    .set({ expiresAt: new Date('2027-01-01') })
    .where(eq(agentApiBindings.id, f.id));
  await c.db
    .update(session)
    .set({ expiresAt: new Date('2027-01-01') })
    .where(eq(session.id, f.owner.sessionId));
  now = expiresAt;
  await expect(
    c.db.transaction((tx) => issuer.currentInTransaction(tx, cap)),
  ).rejects.toMatchObject({ kind: 'unauthenticated' });
});

it('observes same-tx Web logout while pool authentication remains isolated until rollback', async () => {
  const f = await setup();
  const issuer = identities(f);
  const cap = await issuer.authenticate('agentapi', true);
  const outside = await issuer.authenticate('agentapi', true);
  const rollback = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await tx.delete(session).where(eq(session.id, f.owner.sessionId));
      expect(await issuer.current(outside)).toHaveProperty(
        'personId',
        f.personId,
      );
      await expect(issuer.currentInTransaction(tx, cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
  expect(await issuer.current(outside)).toHaveProperty('personId', f.personId);
  await expect(issuer.current(cap)).rejects.toMatchObject({
    kind: 'unauthenticated',
  });
});
