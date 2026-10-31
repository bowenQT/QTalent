import { describe, expect, it, vi } from 'vitest';
import {
  createEntryIdentityService,
  type EntryAuthenticator,
  type CredentialBinding,
} from '../../auth/entry/identity';
import { evaluationContextFixture } from '../../modules/programs/reassignment.fixtures';
import {
  createEntryContextLoader,
  loadEntryAuthorizationContext,
  entryFailure,
  EntryUsecaseError,
} from './context';
import type { DbExecutor } from '../../db/client';
const instant = '2026-11-01T01:00:00.000Z';
async function fixture() {
  const binding: CredentialBinding = {
    credentialId: 'demo-row',
    accountId: 'demo-hr-account',
    revision: 1,
    expiresAt: '2026-11-02T00:00:00.000Z',
    revokedAt: null,
  };
  const current = vi.fn(async () => binding);
  const verifier: EntryAuthenticator = { verify: async () => binding, current };
  const identities = createEntryIdentityService(
    { web: verifier },
    () => new Date(instant),
  );
  const identity = await identities.authenticate('web', 'synthetic-proof');
  const facts = evaluationContextFixture();
  const load = vi.fn(async (_context: object, _id: string, _now: string) => {
    void _context;
    void _id;
    void _now;
    return structuredClone(facts);
  });
  let time = instant;
  const reader = createEntryContextLoader(identities, {
    load,
    businessNow: () => time,
  });
  return {
    reader,
    identities,
    identity,
    facts,
    load,
    current,
    binding,
    time: (value: string) => {
      time = value;
    },
  };
}
describe('framework-free current entry context', () => {
  it('maps actual public directory-read failures without leaking database details', async () => {
    const db = {
      select() {
        throw new Error('private database details');
      },
    } as unknown as DbExecutor;
    await expect(
      loadEntryAuthorizationContext(db, 'demo-hr-account', instant),
    ).rejects.toMatchObject({ kind: 'unavailable', message: 'unavailable' });
    const missing = {
      select: () => ({ from: () => ({ where: async () => [] }) }),
    } as unknown as DbExecutor;
    await expect(
      loadEntryAuthorizationContext(missing, 'demo-hr-account', instant),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
  it('loads the exact trusted account on every call with the current business clock', async () => {
    const f = await fixture();
    const tx = {};
    expect((await f.reader(tx, f.identity)).now).toBe(instant);
    f.time('2026-11-01T02:00:00.000Z');
    expect((await f.reader(tx, f.identity)).now).toBe(
      '2026-11-01T02:00:00.000Z',
    );
    expect(f.load).toHaveBeenCalledTimes(2);
    expect(f.load).toHaveBeenLastCalledWith(
      tx,
      'demo-hr-account',
      '2026-11-01T02:00:00.000Z',
    );
    expect(f.current).toHaveBeenCalledTimes(2);
  });
  it.each([
    'evaluationNodes',
    'evaluationNodeSubjects',
    'evaluationRelations',
  ] as const)(
    'refuses missing %s instead of falling back to P0 authorization',
    async (field) => {
      const f = await fixture();
      delete (f.facts as unknown as Record<string, unknown>)[field];
      await expect(f.reader({}, f.identity)).rejects.toMatchObject({
        kind: 'unavailable',
      });
    },
  );
  it.each(['wrong-account', 'administrator', 'unknown-person'] as const)(
    'refuses %s',
    async (invalid) => {
      const f = await fixture();
      if (invalid === 'wrong-account') f.facts.account.id = 'other';
      if (invalid === 'administrator') f.facts.account.isSystemAdmin = true;
      if (invalid === 'unknown-person') f.facts.account.personId = '';
      await expect(f.reader({}, f.identity)).rejects.toMatchObject({
        kind: 'forbidden',
      });
    },
  );
  it('rejects a revoked credential before loading private data', async () => {
    const f = await fixture();
    f.binding.revokedAt = instant;
    await expect(f.reader({}, f.identity)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.load).not.toHaveBeenCalled();
  });
  it('fails closed when composition or the business clock is unavailable', async () => {
    const f = await fixture();
    await expect(
      createEntryContextLoader(f.identities, {})({}, f.identity),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    f.time('invalid-clock');
    await expect(f.reader({}, f.identity)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
  it('sanitizes loading errors and preserves stable denials without payloads', async () => {
    const f = await fixture();
    f.load.mockRejectedValue(new Error('private source details'));
    const error = await f.reader({}, f.identity).catch((e) => e);
    expect(entryFailure(error)).toEqual({ status: 'unavailable' });
    expect(String(error)).not.toContain('private');
    expect(entryFailure(new EntryUsecaseError('forbidden'))).toEqual({
      status: 'forbidden',
    });
    expect(entryFailure(new Error('secret'))).toEqual({
      status: 'unavailable',
    });
  });
});
