import { describe, expect, it, vi } from 'vitest';
import {
  createEntryIdentityService,
  EntryIdentityError,
  type CredentialBinding,
  type EntryChannel,
  type EntryIdentity,
} from './identity';
const channels: EntryChannel[] = ['web', 'wecom', 'mcp', 'agentapi'];
const instant = '2026-11-01T01:00:00.000Z';
function fixture() {
  let time = Date.parse(instant);
  let binding: CredentialBinding | null = {
    credentialId: 'synthetic-credential-row',
    accountId: 'demo-account',
    revision: 1,
    expiresAt: '2026-11-01T02:00:00.000Z',
    revokedAt: null,
  };
  const verify = vi.fn(async (presented: unknown) =>
    presented === 'synthetic-proof' ? structuredClone(binding) : null,
  );
  const current = vi.fn(async (_id: string) => {
    void _id;
    return structuredClone(binding);
  });
  const service = createEntryIdentityService(
    Object.fromEntries(
      channels.map((channel) => [channel, { verify, current }]),
    ),
    () => new Date(time),
  );
  return {
    service,
    verify,
    current,
    set: (value: CredentialBinding | null) => {
      binding = value;
    },
    get: () => binding!,
    time: (value: number) => {
      time = value;
    },
  };
}
describe('trusted entry identities', () => {
  it.each(channels)(
    'authenticates %s through its verifier and rechecks server state',
    async (channel) => {
      const f = fixture();
      const identity = await f.service.authenticate(channel, 'synthetic-proof');
      expect(await f.service.current(identity)).toEqual({
        channel,
        accountId: 'demo-account',
        credentialId: 'synthetic-credential-row',
      });
      await f.service.current(identity);
      expect(f.current).toHaveBeenCalledTimes(2);
      expect(f.current).toHaveBeenLastCalledWith('synthetic-credential-row');
      expect(JSON.stringify(identity)).toBe(JSON.stringify({ channel }));
      expect(Object.isFrozen(identity)).toBe(true);
    },
  );
  it('rejects forged, copied and foreign-service capabilities', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('web', 'synthetic-proof');
    for (const forged of [
      null,
      { channel: 'web', accountId: 'demo-account' },
      { ...cap },
    ])
      await expect(
        f.service.current(forged as EntryIdentity),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(fixture().service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.current).not.toHaveBeenCalled();
  });
  it.each(['accountId', 'credentialId', 'revision'] as const)(
    'invalidates old identities when %s changes',
    async (field) => {
      const f = fixture();
      const cap = await f.service.authenticate('mcp', 'synthetic-proof');
      f.set({ ...f.get(), [field]: field === 'revision' ? 2 : 'other' });
      await expect(f.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    },
  );
  it.each(['revoked', 'expired', 'deleted'] as const)(
    'rejects a %s credential immediately',
    async (state) => {
      const f = fixture();
      const cap = await f.service.authenticate('wecom', 'synthetic-proof');
      f.set(
        state === 'deleted'
          ? null
          : {
              ...f.get(),
              ...(state === 'revoked'
                ? { revokedAt: instant }
                : { expiresAt: instant }),
            },
      );
      await expect(f.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    },
  );
  it('does not extend a capability when a session expiry is renewed', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('web', 'synthetic-proof');
    f.set({ ...f.get(), expiresAt: '2026-11-02T02:00:00.000Z' });
    f.time(Date.parse('2026-11-01T02:00:00.000Z'));
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });
  it('rejects missing verifiers and invalid proofs without a service identity fallback', async () => {
    await expect(
      createEntryIdentityService().authenticate('agentapi', 'synthetic-proof'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    const f = fixture();
    await expect(
      f.service.authenticate('mcp', { accountId: 'demo-account' }),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(
      f.service.authenticate('web', undefined),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    await expect(
      f.service.authenticate('confirm' as EntryChannel, 'synthetic-proof'),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
  it('requires complete, current, bounded server credential metadata', async () => {
    for (const value of [
      {},
      { ...fixture().get(), revision: 0 },
      { ...fixture().get(), expiresAt: instant },
      { ...fixture().get(), revokedAt: instant },
      { ...fixture().get(), role: 'manager' },
    ]) {
      const service = createEntryIdentityService(
        { web: { verify: async () => value, current: async () => value } },
        () => new Date(instant),
      );
      await expect(
        service.authenticate('web', 'synthetic-proof'),
      ).rejects.toMatchObject({ kind: 'unauthenticated' });
    }
  });
  it('keeps equal credential row IDs isolated by their original issuer', async () => {
    const first = fixture().get();
    const second = { ...first, accountId: 'demo-other-account' };
    let webCurrent = { ...first };
    const mcpCurrent = vi.fn(async () => second);
    const service = createEntryIdentityService(
      {
        web: { verify: async () => first, current: async () => webCurrent },
        mcp: { verify: async () => second, current: mcpCurrent },
      },
      () => new Date(instant),
    );
    const web = await service.authenticate('web', 'synthetic-proof');
    const mcp = await service.authenticate('mcp', 'synthetic-proof');
    webCurrent = { ...first, revokedAt: instant };
    await expect(service.current(web)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(mcpCurrent).not.toHaveBeenCalled();
    expect(await service.current(mcp)).toHaveProperty(
      'accountId',
      second.accountId,
    );
  });
  it('refuses a broken security clock independently of business test time', async () => {
    const service = createEntryIdentityService(
      {
        web: {
          verify: async () => fixture().get(),
          current: async () => fixture().get(),
        },
      },
      () => new Date(NaN),
    );
    await expect(
      service.authenticate('web', 'synthetic-proof'),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('sanitizes verifier and refresh failures', async () => {
    const broken = async () => {
      throw new Error('private credential material');
    };
    const service = createEntryIdentityService({
      web: { verify: broken, current: broken },
    });
    const error = await service
      .authenticate('web', 'synthetic-proof')
      .catch((e) => e);
    expect(error).toBeInstanceOf(EntryIdentityError);
    expect(String(error) + JSON.stringify(error)).not.toContain('private');
    const f = fixture();
    const cap = await f.service.authenticate('mcp', 'synthetic-proof');
    f.current.mockImplementation(broken);
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });
});

describe('retired entry capabilities stay retired', () => {
  it.each(channels)(
    'does not revive a %s identity after observed revocation and restored metadata',
    async (channel) => {
      const f = fixture();
      const original = structuredClone(f.get());
      const cap = await f.service.authenticate(channel, 'synthetic-proof');
      f.set({ ...original, revokedAt: instant });
      await expect(f.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      f.set(original);
      await expect(f.service.current(cap)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
      expect(f.current).toHaveBeenCalledTimes(1);
      const fresh = await f.service.authenticate(channel, 'synthetic-proof');
      expect(await f.service.current(fresh)).toHaveProperty(
        'accountId',
        original.accountId,
      );
    },
  );
  it('does not let an in-flight positive lookup revive a concurrently retired identity', async () => {
    const f = fixture();
    const original = structuredClone(f.get());
    const cap = await f.service.authenticate('mcp', 'synthetic-proof');
    let release!: (value: CredentialBinding) => void;
    f.current.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.service.current(cap);
    f.set(null);
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    release(original);
    await expect(pending).rejects.toMatchObject({ kind: 'unauthenticated' });
  });
  it('requires a new authentication after a dependency failure instead of reusing an uncertain capability', async () => {
    const f = fixture();
    const cap = await f.service.authenticate('agentapi', 'synthetic-proof');
    f.current.mockRejectedValueOnce(new Error('private dependency detail'));
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'unavailable',
    });
    await expect(f.service.current(cap)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
    expect(f.current).toHaveBeenCalledTimes(1);
  });
});
