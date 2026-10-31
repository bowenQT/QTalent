import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { createWebEntryAuthenticator } from './web';
import { createEntryIdentityService } from './identity';
const mocks = vi.hoisted(() => ({ access: vi.fn(), session: vi.fn() }));
vi.mock('../../access', () => ({ verifyAccessRequest: mocks.access }));
vi.mock('../index', () => ({ getSession: mocks.session }));
const start = Date.parse('2026-11-01T01:00:00.000Z');
const end = start + 60_000;
function apiProof() {
  return {
    user: { id: 'demo-account' },
    session: {
      id: 'demo-session',
      userId: 'demo-account',
      expiresAt: new Date(end),
      token: 'synthetic-private-token',
    },
  };
}
function fixture() {
  let now = start;
  let row: unknown[] | null = [
    'demo-session',
    'demo-account',
    new Date(end),
    'demo-account',
    'demo-person',
    false,
  ];
  // Only pg.query is replaced. Drizzle builds the actual join, columns and SQL.
  const query = vi.fn(async () => ({ rows: row === null ? [] : [row] }));
  const db = drizzle({ query } as unknown as Pool);
  const reader = createWebEntryAuthenticator(db, () => new Date(now));
  const identities = createEntryIdentityService(
    { web: reader },
    () => new Date(now),
  );
  const headers = new Headers({
    cookie: 'synthetic-cookie',
    'cf-access-jwt-assertion': 'synthetic-jwt',
  });
  return {
    reader,
    identities,
    headers,
    query,
    setRow(value: unknown[] | null) {
      row = value;
    },
    getRow() {
      return row!;
    },
    time(value: number) {
      now = value;
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue(undefined);
  mocks.session.mockImplementation(async () => apiProof());
});
describe('request-owned production Web authenticator', () => {
  it('uses Access then Better Auth then actual SQL on verify and every current call', async () => {
    const f = fixture();
    const cap = await f.identities.authenticate('web', f.headers);
    for (let i = 0; i < 2; i++)
      expect(await f.identities.current(cap)).toEqual({
        channel: 'web',
        accountId: 'demo-account',
        credentialId: 'demo-session',
      });
    expect(mocks.access).toHaveBeenCalledTimes(3);
    expect(mocks.session).toHaveBeenCalledTimes(3);
    expect(f.query).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      expect(mocks.access.mock.invocationCallOrder[i]).toBeLessThan(
        mocks.session.mock.invocationCallOrder[i],
      );
      expect(mocks.session.mock.invocationCallOrder[i]).toBeLessThan(
        f.query.mock.invocationCallOrder[i],
      );
    }
    const [config, values] = f.query.mock.calls[0] as unknown as [
      { text: string; rowMode: string },
      unknown[],
    ];
    expect(config.text).toContain('inner join "directory_account_bindings"');
    expect(config.text).toContain('"auth_session"."user_id" = $2');
    expect(values).toEqual(['demo-session', 'demo-account', 1]);
    expect(config.text).not.toMatch(/"token"|"password"|"email"/);
    expect(JSON.stringify(cap)).toBe('{"channel":"web"}');
  });
  it('denies Access failure before Better Auth or DB and exposes no raw failure', async () => {
    const f = fixture();
    mocks.access.mockRejectedValue(new Error('synthetic-private-token'));
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'unavailable',
    });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([null, undefined, { accountId: 'demo-account' }, 'synthetic-cookie'])(
    'rejects non-Headers proof without trusting account input (%s)',
    async (proof) => {
      const f = fixture();
      await expect(f.reader.verify(proof)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      expect(mocks.access).not.toHaveBeenCalled();
    },
  );
  it('fails unavailable when Better Auth cannot verify, without trusting DB presence', async () => {
    const f = fixture();
    mocks.session.mockRejectedValue(
      new Error('synthetic-private-provider-error'),
    );
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'unavailable',
    });
    expect(f.query).not.toHaveBeenCalled();
  });
  it('denies absent Better Auth session before DB', async () => {
    const f = fixture();
    mocks.session.mockResolvedValue(null);
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([
    'api_account',
    'api_shape',
    'api_date',
    'missing_row',
    'row_account',
    'row_session',
    'row_shape',
    'row_date',
    'system_admin',
  ])('rejects inconsistent authoritative metadata: %s', async (kind) => {
    const f = fixture();
    const proof = apiProof();
    const row = [...f.getRow()];
    if (kind === 'api_account') proof.user.id = 'other-account';
    if (kind === 'api_date') proof.session.expiresAt = new Date(NaN);
    mocks.session.mockResolvedValue(
      kind === 'api_shape' ? { user: proof.user } : proof,
    );
    if (kind === 'missing_row') f.setRow(null);
    if (kind === 'row_account') row[3] = 'other-account';
    if (kind === 'row_session') row[0] = 'other-session';
    if (kind === 'row_shape') row[4] = '';
    if (kind === 'row_date') row[2] = new Date(NaN);
    if (kind === 'system_admin') row[5] = true;
    if (kind !== 'missing_row') f.setRow(row);
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: ['api_shape', 'api_date', 'row_shape', 'row_date'].includes(kind)
        ? 'unavailable'
        : 'unauthenticated',
    });
  });
  it('rejects clock failures rather than treating them as an unexpired proof', async () => {
    const f = fixture();
    f.time(NaN);
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
  it('captures immutable request headers and cannot be rebound to another request', async () => {
    const f = fixture();
    await f.reader.verify(f.headers);
    f.headers.set('cookie', 'another-account-cookie');
    await f.reader.current('demo-session');
    expect(mocks.session.mock.calls[1][0].get('cookie')).toBe(
      'synthetic-cookie',
    );
    await expect(f.reader.verify(f.headers)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
  it.each([
    'deleted',
    'expired',
    'person_changed',
    'account_changed',
    'gateway_denied',
    'cookie_denied',
    'database_error',
  ])(
    'rechecks %s and permanently retires this request identity',
    async (kind) => {
      const f = fixture();
      const cap = await f.identities.authenticate('web', f.headers);
      const before = [...f.getRow()];
      const row = [...before];
      if (kind === 'deleted') f.setRow(null);
      if (kind === 'expired') row[2] = new Date(start);
      if (kind === 'person_changed') row[4] = 'other-person';
      if (kind === 'account_changed') {
        const proof = apiProof();
        proof.user.id = proof.session.userId = 'other-account';
        mocks.session.mockResolvedValue(proof);
        row[1] = row[3] = 'other-account';
      }
      if (kind === 'gateway_denied')
        mocks.access.mockRejectedValue(new Error('private gateway error'));
      if (kind === 'cookie_denied') mocks.session.mockResolvedValue(null);
      if (kind === 'database_error')
        f.query.mockRejectedValue(new Error('private SQL/values'));
      if (kind !== 'deleted') f.setRow(row);
      await expect(f.identities.current(cap)).rejects.toMatchObject({
        kind: ['gateway_denied', 'database_error'].includes(kind)
          ? 'unavailable'
          : 'unauthenticated',
      });
      f.setRow(before);
      mocks.access.mockResolvedValue(undefined);
      mocks.session.mockResolvedValue(apiProof());
      f.query.mockResolvedValue({ rows: [before] });
      const checked = f.query.mock.calls.length;
      await expect(f.identities.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      expect(f.query).toHaveBeenCalledTimes(checked);
    },
  );
  it('cannot extend an issued identity when both source session expiries are renewed', async () => {
    const f = fixture();
    await f.reader.verify(f.headers);
    const proof = apiProof();
    proof.session.expiresAt = new Date(end + 60_000);
    mocks.session.mockResolvedValue(proof);
    const row = [...f.getRow()];
    row[2] = new Date(end + 60_000);
    f.setRow(row);
    f.time(end);
    await expect(f.reader.current('demo-session')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
  it('unknown credential IDs and uninitialized current do no I/O', async () => {
    const f = fixture();
    await expect(f.reader.current('demo-session')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.query).not.toHaveBeenCalled();
    await f.reader.verify(f.headers);
    const checks = mocks.session.mock.calls.length;
    await expect(f.reader.current('other-session')).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(mocks.session).toHaveBeenCalledTimes(checks);
  });
  it('rechecks DB after a suspended Better Auth result; logout cannot race into success', async () => {
    const f = fixture();
    await f.reader.verify(f.headers);
    const entered = deferred();
    const release = deferred();
    const snapshot = apiProof();
    mocks.session.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return snapshot;
    });
    const current = f.reader.current('demo-session');
    await entered.promise;
    f.setRow(null);
    release.resolve();
    await expect(current).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
  it('takes expiry time after the final asynchronous DB boundary', async () => {
    const f = fixture();
    const entered = deferred();
    const release = deferred();
    f.query.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { rows: [f.getRow()] };
    });
    const auth = f.reader.verify(f.headers);
    await entered.promise;
    f.time(end);
    release.resolve();
    await expect(auth).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
});
