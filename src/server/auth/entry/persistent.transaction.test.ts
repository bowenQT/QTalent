import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { describe, expect, it, vi } from 'vitest';
import { createEntryIdentityService } from './identity';
import {
  createAgentApiEntryAuthenticator,
  createMcpEntryAuthenticator,
  createWecomEntryAuthenticator,
  entryAccountBindingDigest,
  type VerifiedAgentOwner,
} from './persistent';

const at = new Date('2026-11-01T12:00:00.000Z');
const expiry = '2026-11-01T13:00:00.000Z';
const owner = {
  accountId: 'demo-account',
  agentId: 'demo-agent',
  sessionId: 'demo-session',
};
const credentialId = 'demo-binding';
const personId = 'demo-person';
type Lock = 'session' | 'account' | 'agent';
type Query = { text: string; params: unknown[]; path: 'pool' | 'tx' };

// Only pg I/O is replaced. Drizzle builds actual transactions/queries and maps
// actual positional rows. This does NOT prove PostgreSQL isolation or locking.
function driver() {
  const queries: Query[] = [];
  let isolation: string | undefined = 'read committed';
  let missing: Lock | 'joined' | undefined;
  let failure: Lock | 'joined' | 'isolation' | undefined;
  let lockWait = Promise.resolve();
  let lockStarted!: () => void;
  const locked = new Promise<void>((resolve) => {
    lockStarted = resolve;
  });
  const row = {
    accountId: owner.accountId,
    personId,
    isSystemAdmin: false,
    id: credentialId,
    accountBindingDigest: entryAccountBindingDigest(owner.accountId, personId),
    revision: 1,
    expiresAt: expiry,
    revokedAt: null as string | null,
    sessionExpiresAt: expiry,
  };
  async function respond(
    path: 'pool' | 'tx',
    config: { text: string },
    params: unknown[] = [],
  ) {
    const text = config.text;
    queries.push({ text, params, path });
    if (/^(begin|commit|rollback)/u.test(text)) return { rows: [] };
    if (text.includes('current_setting')) {
      if (failure === 'isolation')
        throw new Error('synthetic-private-db-detail');
      return { rows: isolation === undefined ? [] : [{ isolation }] };
    }
    if (text.includes('inner join')) {
      if (failure === 'joined') throw new Error('synthetic-private-db-detail');
      return {
        rows:
          missing === 'joined'
            ? []
            : [
                [
                  row.accountId,
                  row.personId,
                  row.isSystemAdmin,
                  row.id,
                  row.accountBindingDigest,
                  row.revision,
                  row.expiresAt,
                  row.revokedAt,
                  row.sessionExpiresAt,
                ],
              ],
      };
    }
    const lock: Lock | undefined = text.includes('from "auth_session"')
      ? 'session'
      : text.includes('from "directory_account_bindings"')
        ? 'account'
        : text.includes('from "entry_agent_api_bindings"')
          ? 'agent'
          : undefined;
    if (lock) {
      if (lock === 'agent') {
        lockStarted();
        await lockWait;
      }
      if (failure === lock) throw new Error('synthetic-private-db-detail');
      return {
        rows:
          missing === lock
            ? []
            : [
                [
                  lock === 'session'
                    ? owner.sessionId
                    : lock === 'account'
                      ? owner.accountId
                      : credentialId,
                ],
              ],
      };
    }
    throw new Error('unexpected synthetic query');
  }
  const pool = new Pool();
  const poolQuery = vi.fn((config: { text: string }, params?: unknown[]) =>
    respond('pool', config, params),
  );
  vi.spyOn(pool, 'query').mockImplementation(
    poolQuery as unknown as typeof pool.query,
  );
  const txQuery = vi.fn((config: { text: string }, params?: unknown[]) =>
    respond('tx', config, params),
  );
  const release = vi.fn();
  vi.spyOn(pool, 'connect').mockImplementation(
    async () => ({ query: txQuery, release }) as unknown as PoolClient,
  );
  const db = drizzle(pool);
  let proof: VerifiedAgentOwner | null = { ...owner };
  const verifiedOwner = vi.fn(async () => proof);
  const reader = createAgentApiEntryAuthenticator(db, verifiedOwner, () => at);
  const service = createEntryIdentityService({ agentapi: reader }, () => at);
  return {
    db,
    reader,
    service,
    verifiedOwner,
    poolQuery,
    txQuery,
    queries,
    row,
    release,
    locked,
    proof(value: VerifiedAgentOwner | null) {
      proof = value;
    },
    isolation(value: string | undefined) {
      isolation = value;
    },
    missing(value: typeof missing) {
      missing = value;
    },
    failure(value: typeof failure) {
      failure = value;
    },
    waitForLock(value: Promise<void>) {
      lockWait = value;
    },
    async refresh() {
      const cap = await service.authenticate('agentapi', true);
      return db.transaction((tx) => service.currentInTransaction(tx, cap), {
        isolationLevel: 'read committed',
      });
    },
  };
}

describe('AgentAPI transaction reader query boundary', () => {
  it('checks RC, locks the three exact rows, then reads a new joined statement on the same transaction', async () => {
    const d = driver();
    expect(await d.refresh()).toEqual({
      accountId: owner.accountId,
      personId,
      channel: 'agentapi',
      credentialId,
      credentialRevision: 1,
    });
    const tx = d.queries.filter((query) => query.path === 'tx');
    expect(tx).toHaveLength(7);
    expect(tx[0].text).toBe('begin isolation level read committed');
    expect(tx[1]).toMatchObject({
      text: "select current_setting('transaction_isolation') as isolation",
      params: [],
    });
    expect(tx[2]).toMatchObject({
      text: 'select "id" from "auth_session" where ("auth_session"."id" = $1 and "auth_session"."user_id" = $2) for update',
      params: [owner.sessionId, owner.accountId],
    });
    expect(tx[3]).toMatchObject({
      text: 'select "account_id" from "directory_account_bindings" where "directory_account_bindings"."account_id" = $1 for update',
      params: [owner.accountId],
    });
    expect(tx[4]).toMatchObject({
      text: 'select "id" from "entry_agent_api_bindings" where ("entry_agent_api_bindings"."id" = $1 and "entry_agent_api_bindings"."agent_id" = $2 and "entry_agent_api_bindings"."session_id" = $3 and "entry_agent_api_bindings"."account_id" = $4) for update',
      params: [credentialId, owner.agentId, owner.sessionId, owner.accountId],
    });
    expect(tx[5].text).toContain(
      'inner join "directory_account_bindings" on "directory_account_bindings"."account_id" = "entry_agent_api_bindings"."account_id"',
    );
    expect(tx[5].text).toContain(
      'inner join "auth_session" on ("auth_session"."id" = "entry_agent_api_bindings"."session_id" and "auth_session"."user_id" = "entry_agent_api_bindings"."account_id")',
    );
    expect(tx[5].text.split(' where ')[1]).toBe(
      '("entry_agent_api_bindings"."agent_id" = $1 and "entry_agent_api_bindings"."session_id" = $2 and "entry_agent_api_bindings"."account_id" = $3 and "entry_agent_api_bindings"."id" = $4) limit $5',
    );
    expect(tx[5].params).toEqual([
      owner.agentId,
      owner.sessionId,
      owner.accountId,
      credentialId,
      1,
    ]);
    expect(tx[6].text).toBe('commit');
    expect(d.poolQuery).toHaveBeenCalledTimes(1);
    expect(d.verifiedOwner).toHaveBeenCalledTimes(2);
    expect(d.release).toHaveBeenCalledOnce();
    for (const query of d.queries) {
      expect(query.text).not.toMatch(
        /token|cookie|oauth|password|ip_address|user_agent|auth_account|select \*/iu,
      );
    }
    const projection = tx[5].text.split(' from ')[0];
    expect(projection).toContain('"directory_account_bindings"."person_id"');
    expect(projection).toContain(
      '"entry_agent_api_bindings"."account_binding_digest"',
    );
    expect(projection).not.toContain('"entry_agent_api_bindings"."person_id"');
  });

  it('leaves verify/current as one pool join each, with no transaction or locking', async () => {
    const d = driver();
    const verified = await d.reader.verify({ untrustedOwner: 'demo-stranger' });
    expect(await d.reader.current(credentialId)).toEqual(verified);
    expect(verified).toEqual({
      credentialId,
      accountId: owner.accountId,
      personId,
      revision: 1,
      expiresAt: expiry,
      revokedAt: null,
    });
    expect(JSON.stringify(verified)).not.toContain(d.row.accountBindingDigest);
    expect(d.poolQuery).toHaveBeenCalledTimes(2);
    expect(d.txQuery).not.toHaveBeenCalled();
    expect(d.queries[0].params).toEqual([
      owner.agentId,
      owner.sessionId,
      owner.accountId,
      1,
    ]);
    expect(d.queries[1].params).toEqual([
      owner.agentId,
      owner.sessionId,
      owner.accountId,
      credentialId,
      1,
    ]);
    expect(
      d.queries.every(
        (query) => !/for update|current_setting/u.test(query.text),
      ),
    ).toBe(true);
  });

  it('revalidates the trusted owner on every transaction call and rejects a lost proof before queries', async () => {
    const d = driver();
    const cap = await d.service.authenticate('agentapi', true);
    await d.db.transaction(async (tx) => {
      await d.service.currentInTransaction(tx, cap);
      const count = d.queries.length;
      d.proof(null);
      await expect(
        d.service.currentInTransaction(tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      expect(d.queries).toHaveLength(count);
    });
    expect(d.verifiedOwner).toHaveBeenCalledTimes(3);
    d.proof(owner);
    await expect(d.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(d.poolQuery).toHaveBeenCalledTimes(1);
  });

  it.each(['accountId', 'agentId', 'sessionId'] as const)(
    'uses the current verified %s, never the old capability as a substitute proof',
    async (field) => {
      const d = driver();
      const cap = await d.service.authenticate('agentapi', true);
      d.proof({ ...owner, [field]: 'demo-wrong' });
      // The database returns no row for the changed proof tuple.
      d.missing(field === 'agentId' ? 'agent' : 'session');
      await expect(
        d.db.transaction((tx) => d.service.currentInTransaction(tx, cap)),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      const lastRead = d.queries
        .filter((query) => query.text.endsWith('for update'))
        .at(-1)!;
      expect(lastRead.params).toContain('demo-wrong');
      expect(
        d.queries
          .filter((query) => query.path === 'tx')
          .some((query) => query.text.includes('inner join')),
      ).toBe(false);
    },
  );

  it.each(['session', 'account', 'agent', 'joined'] as const)(
    'fails closed when the %s row disappears, without returning pool state',
    async (missing) => {
      const d = driver();
      const cap = await d.service.authenticate('agentapi', true);
      d.missing(missing);
      await expect(
        d.db.transaction((tx) => d.service.currentInTransaction(tx, cap)),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      expect(d.poolQuery).toHaveBeenCalledTimes(1);
      expect(d.queries.at(-1)?.text).toBe('rollback');
      d.missing(undefined);
      await expect(d.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    },
  );

  it.each(['repeatable read', 'serializable', undefined])(
    'rejects isolation %s before any row read',
    async (isolation) => {
      const d = driver();
      d.isolation(isolation);
      await expect(d.refresh()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(
        d.queries
          .filter((query) => query.path === 'tx')
          .map((query) => query.text),
      ).toEqual([
        'begin isolation level read committed',
        "select current_setting('transaction_isolation') as isolation",
        'rollback',
      ]);
    },
  );

  it.each(['isolation', 'session', 'account', 'agent', 'joined'] as const)(
    'sanitizes a %s database failure and retires the capability',
    async (failure) => {
      const d = driver();
      const cap = await d.service.authenticate('agentapi', true);
      d.failure(failure);
      await expect(
        d.db.transaction((tx) => d.service.currentInTransaction(tx, cap)),
      ).rejects.toMatchObject({ kind: 'unavailable', message: 'unavailable' });
      expect(d.queries.at(-1)?.text).toBe('rollback');
      d.failure(undefined);
      await expect(d.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      expect(d.poolQuery).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['revoke', 'rebind', 'session-expiry'] as const)(
    'reads the changed %s facts only after the awaited lock query completes',
    async (change) => {
      const d = driver();
      const cap = await d.service.authenticate('agentapi', true);
      let unlock!: () => void;
      d.waitForLock(
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
      );
      const pending = d.db.transaction((tx) =>
        d.service.currentInTransaction(tx, cap),
      );
      const rejected = expect(pending).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      await d.locked;
      expect(
        d.queries
          .filter((query) => query.path === 'tx')
          .some((query) => query.text.includes('inner join')),
      ).toBe(false);
      if (change === 'revoke') d.row.revokedAt = at.toISOString();
      if (change === 'rebind') d.row.personId = 'demo-rebound';
      if (change === 'session-expiry')
        d.row.sessionExpiresAt = at.toISOString();
      unlock();
      await rejected;
      expect(
        d.queries.filter(
          (query) => query.path === 'tx' && query.text.includes('inner join'),
        ),
      ).toHaveLength(1);
      expect(d.poolQuery).toHaveBeenCalledTimes(1);
      expect(d.queries.at(-1)?.text).toBe('rollback');
    },
  );

  it('does not add transaction readers to MCP or WeCom', () => {
    const d = driver();
    expect(
      createMcpEntryAuthenticator(d.db).currentInTransaction,
    ).toBeUndefined();
    expect(
      createWecomEntryAuthenticator(d.db, async () => null)
        .currentInTransaction,
    ).toBeUndefined();
  });
});
