import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { nativeDatabase } from '../../../../tests/fixtures/bow-845/native';
import {
  accountBindings,
  organizations,
  people,
  rebindDirectoryAccount,
} from '../../modules/directory';
import { session, user } from '../schema';
import { createEntryIdentityService, EntryIdentityError } from './identity';
import { agentApiBindings, mcpCredentials, wecomBindings } from './schema';
import {
  createAgentApiEntryAuthenticator,
  createMcpEntryAuthenticator,
  createWecomEntryAuthenticator,
  entryAccountBindingDigest,
  mcpTokenDigest,
  type VerifiedAgentOwner,
  type VerifiedWecomSender,
} from './persistent';

let c: Awaited<ReturnType<typeof nativeDatabase>>;
const at = new Date('2026-11-01T12:00:00Z');
const expiresAt = new Date('2026-11-01T13:00:00Z');
beforeAll(async () => {
  c = await nativeDatabase();
  // Transitional structure validation only. Default CI still uses formal SQL;
  // this scoped override is retired when the migration cursor reaches 903.
  if (process.env.BOW_903_TEST_MIGRATIONS_DIR)
    await migrate(c.db, {
      migrationsFolder: process.env.BOW_903_TEST_MIGRATIONS_DIR,
    });
  await c.db.select().from(mcpCredentials).limit(1);
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
    })),
  );
  await c.db
    .insert(accountBindings)
    .values({ accountId, personId, isSystemAdmin: false });
  await c.db
    .insert(user)
    .values({ id: accountId, name: '演示', email: id + '@example.invalid' });
  const sessionId = 'demo-session-' + id;
  await c.db.insert(session).values({
    id: sessionId,
    userId: accountId,
    token: 'synthetic-session-' + id,
    expiresAt,
  });
  const base = {
    id,
    accountId,
    accountBindingDigest: entryAccountBindingDigest(accountId, personId, 1),
    revision: 1,
    expiresAt,
    revokedAt: null,
  };
  const token = 'synthetic-mcp-token-' + id;
  const sender = { scope: 'demo-scope', botId: 'demo-bot', senderId: id };
  const owner = { accountId, agentId: 'demo-agent', sessionId };
  await c.db
    .insert(mcpCredentials)
    .values({ ...base, tokenDigest: mcpTokenDigest(token) });
  await c.db.insert(wecomBindings).values({ ...base, ...sender });
  await c.db
    .insert(agentApiBindings)
    .values({ ...base, agentId: owner.agentId, sessionId });
  return { ...base, personId, other, token, sender, owner };
}
function readers(f: Awaited<ReturnType<typeof setup>>) {
  return {
    mcp: createMcpEntryAuthenticator(c.db, () => at),
    wecom: createWecomEntryAuthenticator(
      c.db,
      async () => f.sender,
      () => at,
    ),
    agentapi: createAgentApiEntryAuthenticator(
      c.db,
      async () => f.owner,
      () => at,
    ),
  };
}
it('joins the unique current directory binding for all channels without returning token or role data', async () => {
  const f = await setup();
  for (const [channel, reader] of Object.entries(readers(f))) {
    const value = await reader.verify(
      channel === 'mcp' ? f.token : { untrustedPerson: f.other },
    );
    expect(value).toEqual({
      credentialId: f.id,
      accountId: f.accountId,
      personId: f.personId,
      revision: 1,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    });
    expect(await reader.current(f.id)).toEqual(value);
  }
  const stored = (
    await c.db.select().from(mcpCredentials).where(eq(mcpCredentials.id, f.id))
  )[0];
  expect(JSON.stringify(stored)).not.toContain(f.token);
  expect(JSON.stringify(stored)).not.toContain(f.personId);
  expect(mcpTokenDigest(f.token)).not.toBe(
    entryAccountBindingDigest(f.accountId, f.personId, 1),
  );
});
it('rejects missing credentials and malformed or wrong bearer tokens', async () => {
  const f = await setup();
  const reader = readers(f).mcp;
  for (const value of [
    null,
    {},
    '',
    'short',
    f.token + ' ',
    'x'.repeat(513),
    'unknown-token-'.repeat(4),
  ])
    await expect(reader.verify(value)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
  await expect(reader.current('missing')).rejects.toBeInstanceOf(
    EntryIdentityError,
  );
});
it.each(['mcp', 'wecom', 'agentapi'] as const)(
  'rejects both old capabilities and fresh %s authentication after account rebind',
  async (channel) => {
    const f = await setup();
    const r = readers(f);
    const identities = createEntryIdentityService(r, () => at);
    const identity = await identities.authenticate(
      channel,
      channel === 'mcp' ? f.token : true,
    );
    await rebindDirectoryAccount(c.db, {
      accountId: f.accountId,
      personId: f.other,
    });
    await expect(identities.current(identity)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    await expect(
      identities.authenticate(channel, channel === 'mcp' ? f.token : true),
    ).rejects.toBeInstanceOf(EntryIdentityError);
    // A failed capability stays retired even if an administrator restores mapping.
    await rebindDirectoryAccount(c.db, {
      accountId: f.accountId,
      personId: f.personId,
    });
    await expect(identities.current(identity)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
  },
);
it.each(['mcp', 'wecom', 'agentapi'] as const)(
  'keeps a %s credential issued before A→B→A rejected while a credential issued after it works',
  async (channel) => {
    const f = await setup();
    const table = {
      mcp: mcpCredentials,
      wecom: wecomBindings,
      agentapi: agentApiBindings,
    }[channel];
    const r = readers(f);
    const proof = channel === 'mcp' ? f.token : true;
    expect(await r[channel].verify(proof)).toHaveProperty('credentialId', f.id);
    expect(
      await rebindDirectoryAccount(c.db, {
        accountId: f.accountId,
        personId: f.other,
      }),
    ).toEqual({ generation: 2 });
    await expect(r[channel].verify(proof)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    expect(
      await rebindDirectoryAccount(c.db, {
        accountId: f.accountId,
        personId: f.personId,
      }),
    ).toEqual({ generation: 3 });
    // Same account and person again: the old issue-time generation is 1.
    await expect(r[channel].verify(proof)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    await expect(r[channel].current(f.id)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    // A trusted writer re-issues under the current generation.
    await c.db
      .update(table)
      .set({
        accountBindingDigest: entryAccountBindingDigest(
          f.accountId,
          f.personId,
          3,
        ),
        revision: 2,
      })
      .where(eq(table.id, f.id));
    expect(await r[channel].verify(proof)).toMatchObject({
      credentialId: f.id,
      personId: f.personId,
      revision: 2,
    });
  },
);
it('advances the generation only through the rebind writer and keeps it positive', async () => {
  const f = await setup();
  expect(
    await rebindDirectoryAccount(c.db, {
      accountId: 'demo-missing-' + f.id,
      personId: f.personId,
    }),
  ).toBeNull();
  await expect(
    c.db
      .update(accountBindings)
      .set({ generation: 0 })
      .where(eq(accountBindings.accountId, f.accountId)),
  ).rejects.toMatchObject({
    cause: expect.objectContaining({
      code: '23514',
      constraint: 'directory_account_generation',
    }),
  });
});
it.each(['mcp', 'wecom', 'agentapi'] as const)(
  'enforces %s expiry, revocation, generation and system-admin exclusion',
  async (channel) => {
    const f = await setup();
    const table = {
      mcp: mcpCredentials,
      wecom: wecomBindings,
      agentapi: agentApiBindings,
    }[channel];
    const r = readers(f);
    const identities = createEntryIdentityService(r, () => at);
    const proof = channel === 'mcp' ? f.token : true;
    const cap = await identities.authenticate(channel, proof);
    await c.db.update(table).set({ revision: 2 }).where(eq(table.id, f.id));
    await expect(identities.current(cap)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    expect(await identities.authenticate(channel, proof)).toHaveProperty(
      'channel',
      channel,
    );
    await c.db.update(table).set({ revokedAt: at }).where(eq(table.id, f.id));
    await expect(r[channel].verify(proof)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    await c.db
      .update(table)
      .set({ revokedAt: null, expiresAt: at })
      .where(eq(table.id, f.id));
    await expect(r[channel].verify(proof)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
    await c.db.update(table).set({ expiresAt }).where(eq(table.id, f.id));
    await c.db
      .update(accountBindings)
      .set({ isSystemAdmin: true })
      .where(eq(accountBindings.accountId, f.accountId));
    await expect(r[channel].verify(proof)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
  },
);
it('requires the trusted WeCom connection tuple; caller fields cannot replace it', async () => {
  const f = await setup();
  let proof: VerifiedWecomSender | null = null;
  const reader = createWecomEntryAuthenticator(
    c.db,
    async () => proof,
    () => at,
  );
  await expect(reader.verify(f.sender)).rejects.toBeInstanceOf(
    EntryIdentityError,
  );
  for (const field of ['scope', 'botId', 'senderId'] as const) {
    proof = { ...f.sender, [field]: 'wrong' };
    await expect(reader.verify(f.sender)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
  }
  proof = f.sender;
  expect(await reader.verify(true)).toHaveProperty('accountId', f.accountId);
  proof = null;
  await expect(reader.current(f.id)).rejects.toBeInstanceOf(EntryIdentityError);
});
it('requires authenticated AgentAPI owner and actual matching unexpired Web session', async () => {
  const f = await setup();
  let proof: VerifiedAgentOwner | null = null;
  const reader = createAgentApiEntryAuthenticator(
    c.db,
    async () => proof,
    () => at,
  );
  await expect(reader.verify(f.owner)).rejects.toBeInstanceOf(
    EntryIdentityError,
  );
  for (const field of ['accountId', 'agentId', 'sessionId'] as const) {
    proof = { ...f.owner, [field]: 'wrong' };
    await expect(reader.verify(f.owner)).rejects.toBeInstanceOf(
      EntryIdentityError,
    );
  }
  proof = f.owner;
  await c.db
    .update(session)
    .set({ expiresAt: new Date('2026-11-01T12:01:00Z') })
    .where(eq(session.id, f.owner.sessionId));
  expect(await reader.verify(true)).toHaveProperty(
    'expiresAt',
    '2026-11-01T12:01:00.000Z',
  );
  await c.db
    .update(session)
    .set({ expiresAt: at })
    .where(eq(session.id, f.owner.sessionId));
  await expect(reader.current(f.id)).rejects.toBeInstanceOf(EntryIdentityError);
  const stranger = await setup();
  await c.db
    .update(session)
    .set({ expiresAt, userId: stranger.accountId })
    .where(eq(session.id, f.owner.sessionId));
  await expect(reader.verify(true)).rejects.toBeInstanceOf(EntryIdentityError);
});
it('re-reads session and directory after an asynchronous verifier has waited', async () => {
  const f = await setup();
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const reader = createAgentApiEntryAuthenticator(
    c.db,
    async () => {
      await waiting;
      return f.owner;
    },
    () => at,
  );
  const result = reader.verify(true);
  await rebindDirectoryAccount(c.db, {
    accountId: f.accountId,
    personId: f.other,
  });
  resume();
  await expect(result).rejects.toBeInstanceOf(EntryIdentityError);
});
it('checks security time after verification and does not extend an issued capability', async () => {
  const f = await setup();
  let now = at;
  const reader = createWecomEntryAuthenticator(
    c.db,
    async () => f.sender,
    () => now,
  );
  const identities = createEntryIdentityService({ wecom: reader }, () => now);
  const cap = await identities.authenticate('wecom', true);
  await c.db
    .update(wecomBindings)
    .set({ expiresAt: new Date('2027-01-01') })
    .where(eq(wecomBindings.id, f.id));
  now = expiresAt;
  await expect(identities.current(cap)).rejects.toBeInstanceOf(
    EntryIdentityError,
  );
  now = new Date(NaN);
  await expect(reader.verify(true)).rejects.toMatchObject({
    kind: 'unavailable',
  });
});
it('enforces digest, positive revision, current account FK and unique issuer keys in PostgreSQL', async () => {
  const f = await setup();
  for (const patch of [
    { revision: 0 },
    { accountBindingDigest: 'bad' },
    { tokenDigest: 'not-a-digest' },
    { accountId: 'missing-account' },
  ])
    await expect(
      c.db.insert(mcpCredentials).values({
        ...f,
        id: randomUUID(),
        tokenDigest: mcpTokenDigest(randomUUID()),
        ...patch,
      }),
    ).rejects.toThrow();
  await expect(
    c.db
      .insert(mcpCredentials)
      .values({ ...f, id: randomUUID(), tokenDigest: mcpTokenDigest(f.token) }),
  ).rejects.toThrow();
  await expect(
    c.db.insert(wecomBindings).values({ ...f, ...f.sender, id: randomUUID() }),
  ).rejects.toThrow();
  await expect(
    c.db.insert(agentApiBindings).values({
      ...f,
      agentId: f.owner.agentId,
      sessionId: f.owner.sessionId,
      id: randomUUID(),
    }),
  ).rejects.toThrow();
  const columns = await c.db.execute<{ column_name: string }>(
    sql`select column_name from information_schema.columns where table_name in ('entry_mcp_credentials','entry_wecom_bindings','entry_agent_api_bindings')`,
  );
  for (const forbidden of ['person_id', 'role', 'token'])
    expect(columns.rows.map((row) => row.column_name)).not.toContain(forbidden);
});
it('does not observe uncommitted credential changes and honors rollback', async () => {
  const f = await setup();
  const reader = readers(f).mcp;
  const failure = new Error('synthetic rollback');
  await expect(
    c.db.transaction(async (tx) => {
      await tx
        .update(mcpCredentials)
        .set({ revokedAt: at })
        .where(eq(mcpCredentials.id, f.id));
      expect(await reader.verify(f.token)).toHaveProperty(
        'accountId',
        f.accountId,
      );
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(await reader.verify(f.token)).toHaveProperty('accountId', f.accountId);
});

it('invalidates AgentAPI mapping on actual Web logout without blocking session deletion', async () => {
  const f = await setup();
  const reader = readers(f).agentapi;
  expect(await reader.verify(true)).toHaveProperty('accountId', f.accountId);
  await c.db.delete(session).where(eq(session.id, f.owner.sessionId));
  await expect(reader.current(f.id)).rejects.toBeInstanceOf(EntryIdentityError);
  expect(
    await c.db
      .select()
      .from(agentApiBindings)
      .where(eq(agentApiBindings.id, f.id)),
  ).toEqual([]);
});
