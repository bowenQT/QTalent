import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../../db/client';
import {
  createEntryIdentityService,
  type CredentialBinding,
  type EntryAuthenticator,
  type EntryIdentity,
} from './identity';

const at = Date.parse('2026-11-01T12:00:00.000Z');
const expiry = '2026-11-01T13:00:00.000Z';
function fixture(transactionReader = true) {
  let now = at;
  const original: CredentialBinding = {
    credentialId: 'demo-agent-binding',
    accountId: 'demo-account',
    personId: 'demo-person',
    revision: 1,
    expiresAt: expiry,
    revokedAt: null,
  };
  let binding: unknown = { ...original };
  // The issuer only forwards this exact handle; real isolation/locking is tested
  // in the persistent reader's PostgreSQL integration suite.
  const tx = Object.freeze({
    syntheticTransaction: true,
  }) as unknown as Transaction;
  const verify = vi.fn(async () => ({ ...original }));
  const current = vi.fn(async (_id: string): Promise<unknown> => {
    void _id;
    return { ...original };
  });
  const currentInTransaction = vi.fn(
    async (_tx: Transaction, _id: string): Promise<unknown> => {
      void _tx;
      void _id;
      return binding;
    },
  );
  const reader: EntryAuthenticator = {
    verify,
    current,
    ...(transactionReader ? { currentInTransaction } : {}),
  };
  const service = createEntryIdentityService(
    { agentapi: reader },
    () => new Date(now),
  );
  return {
    tx,
    service,
    reader,
    original,
    verify,
    current,
    currentInTransaction,
    setBinding(value: unknown) {
      binding = value;
    },
    setTime(value: number) {
      now = value;
    },
  };
}

describe('transaction-local opaque entry identities', () => {
  it('passes the exact transaction and retained credential to its reader, without touching the pool', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', 'synthetic-proof');
    expect(f.verify).toHaveBeenCalledExactlyOnceWith('synthetic-proof');
    expect(f.currentInTransaction).not.toHaveBeenCalled();
    expect(await f.service.currentInTransaction(f.tx, cap)).toEqual({
      channel: 'agentapi',
      accountId: 'demo-account',
      personId: 'demo-person',
      credentialId: 'demo-agent-binding',
      credentialRevision: 1,
    });
    expect(f.currentInTransaction).toHaveBeenCalledExactlyOnceWith(
      f.tx,
      f.original.credentialId,
    );
    expect(f.current).not.toHaveBeenCalled();
    expect(Object.isFrozen(cap)).toBe(true);
    expect(JSON.stringify(cap)).toBe('{"channel":"agentapi"}');
  });

  it('keeps ordinary authentication and current on their original pool path', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', 'synthetic-proof');
    f.setBinding(null);
    expect(await f.service.current(cap)).toHaveProperty(
      'personId',
      f.original.personId,
    );
    expect(f.current).toHaveBeenCalledExactlyOnceWith(f.original.credentialId);
    expect(f.currentInTransaction).not.toHaveBeenCalled();
    expect(f.verify).toHaveBeenCalledTimes(1);
  });

  it('preserves the existing pool refresh deadline timing instead of expanding this transaction-only change', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', true);
    let release!: (value: CredentialBinding) => void;
    f.current.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.current(cap);
    f.setTime(Date.parse(expiry));
    release({ ...f.original, expiresAt: '2027-01-01T00:00:00.000Z' });
    // The pre-existing pool path checks the original cap before the await only.
    // The new transaction path below deliberately also checks after the await.
    expect(await pending).toHaveProperty('personId', f.original.personId);
    expect(f.currentInTransaction).not.toHaveBeenCalled();
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('rejects DTOs, copied or rechannelled caps, credential IDs and foreign issuers before reading', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', 'synthetic-proof');
    const foreign = await fixture().service.authenticate(
      'agentapi',
      'synthetic-proof',
    );
    for (const fake of [
      null,
      undefined,
      f.original.credentialId,
      f.original,
      { ...cap },
      { ...cap, channel: 'web' },
      foreign,
    ]) {
      await expect(
        f.service.currentInTransaction(f.tx, fake as EntryIdentity),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
    }
    expect(f.currentInTransaction).not.toHaveBeenCalled();
    expect(f.current).not.toHaveBeenCalled();
    expect(await f.service.currentInTransaction(f.tx, cap)).toHaveProperty(
      'channel',
      'agentapi',
    );
  });

  it('returns unavailable without a same-channel transaction reader, retires the cap and never falls back', async () => {
    const f = fixture(false);
    const cap = await f.service.authenticate('agentapi', 'synthetic-proof');
    await expect(
      f.service.currentInTransaction(f.tx, cap),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.current).not.toHaveBeenCalled();
    expect(f.currentInTransaction).not.toHaveBeenCalled();
    const fresh = await f.service.authenticate('agentapi', 'synthetic-proof');
    expect(await f.service.current(fresh)).toHaveProperty(
      'personId',
      f.original.personId,
    );
  });

  it('retains the issuing channel reader despite equal IDs and later composition replacement', async () => {
    const f = fixture();
    const other = fixture();
    const authenticators = { agentapi: f.reader, mcp: other.reader };
    const service = createEntryIdentityService(
      authenticators,
      () => new Date(at),
    );
    const agent = await service.authenticate('agentapi', true);
    const mcp = await service.authenticate('mcp', true);
    authenticators.agentapi = other.reader;
    f.setBinding({ ...f.original, revokedAt: new Date(at).toISOString() });
    await expect(
      service.currentInTransaction(f.tx, agent),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(other.currentInTransaction).not.toHaveBeenCalled();
    expect(await service.currentInTransaction(f.tx, mcp)).toHaveProperty(
      'channel',
      'mcp',
    );
    expect(other.currentInTransaction).toHaveBeenCalledExactlyOnceWith(
      f.tx,
      f.original.credentialId,
    );
  });

  it.each(['accountId', 'personId', 'credentialId', 'revision'] as const)(
    'rejects a transaction-local %s change and cannot revive after rollback',
    async (field) => {
      const f = fixture();
      const cap = await f.service.authenticate('agentapi', true);
      f.setBinding({
        ...f.original,
        [field]: field === 'revision' ? 2 : 'demo-rebound',
      });
      await expect(
        f.service.currentInTransaction(f.tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      f.setBinding({ ...f.original });
      await expect(
        f.service.currentInTransaction(f.tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      await expect(f.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      expect(f.currentInTransaction).toHaveBeenCalledTimes(1);
      expect(f.current).not.toHaveBeenCalled();
    },
  );

  it.each([
    null,
    { revokedAt: new Date(at).toISOString() },
    { expiresAt: new Date(at).toISOString() },
    { role: 'manager' },
  ])(
    'rejects missing, revoked, expired and malformed transaction metadata: %j',
    async (patch) => {
      const f = fixture();
      const cap = await f.service.authenticate('agentapi', true);
      f.setBinding(patch === null ? null : { ...f.original, ...patch });
      await expect(
        f.service.currentInTransaction(f.tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      f.setBinding(f.original);
      await expect(
        f.service.currentInTransaction(f.tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      expect(f.currentInTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects at the original capability deadline even when its backing expiry was extended', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', true);
    f.setBinding({ ...f.original, expiresAt: '2027-01-01T00:00:00.000Z' });
    f.setTime(Date.parse(expiry));
    await expect(
      f.service.currentInTransaction(f.tx, cap),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(f.currentInTransaction).not.toHaveBeenCalled();
  });

  it('rechecks the original deadline after a transaction read waited across it', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', true);
    let release!: (value: CredentialBinding) => void;
    f.currentInTransaction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.currentInTransaction(f.tx, cap);
    f.setTime(Date.parse(expiry));
    release({ ...f.original, expiresAt: '2027-01-01T00:00:00.000Z' });
    await expect(pending).rejects.toMatchObject({ kind: 'unauthenticated' });
    f.setTime(at);
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('sanitizes dependency failure and permanently retires the capability on both paths', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', true);
    f.currentInTransaction.mockRejectedValueOnce(
      new Error('synthetic-private-detail'),
    );
    const error = await f.service
      .currentInTransaction(f.tx, cap)
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      kind: 'unavailable',
      message: 'unavailable',
    });
    expect(String(error) + JSON.stringify(error)).not.toContain(
      'synthetic-private-detail',
    );
    await expect(
      f.service.currentInTransaction(f.tx, cap),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.currentInTransaction).toHaveBeenCalledTimes(1);
    expect(f.current).not.toHaveBeenCalled();
  });

  it.each(['pool', 'transaction'] as const)(
    'cannot revive an in-flight transaction refresh after a concurrent %s refresh retired the cap',
    async (path) => {
      const f = fixture();
      const cap = await f.service.authenticate('agentapi', true);
      let release!: (value: CredentialBinding) => void;
      f.currentInTransaction.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      const pending = f.service.currentInTransaction(f.tx, cap);
      f.setBinding(null);
      f.current.mockResolvedValueOnce(null);
      await expect(
        path === 'pool'
          ? f.service.current(cap)
          : f.service.currentInTransaction(f.tx, cap),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
      release({ ...f.original });
      await expect(pending).rejects.toMatchObject({ kind: 'unauthenticated' });
    },
  );

  it('rejects an invalid security clock and retires the cap before transaction access', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', true);
    f.setTime(NaN);
    await expect(
      f.service.currentInTransaction(f.tx, cap),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    f.setTime(at);
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.currentInTransaction).not.toHaveBeenCalled();
  });
});
