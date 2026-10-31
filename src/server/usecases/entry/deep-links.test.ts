import { describe, expect, it, vi } from 'vitest';
import {
  createEntryIdentityService,
  type CredentialBinding,
} from '../../auth/entry/identity';
import { evaluationContextFixture } from '../../modules/programs/reassignment.fixtures';
import { canReadNodeTalent } from '../../authz/evaluation-node';
import { buildEntryDeepLink } from '../../../contracts/entry-links';
import {
  createEntryContextLoader,
  EntryUsecaseError,
  type EntryAudit,
  type EntryTransactionPorts,
} from './context';
import { createEntryDeepLinkUsecase } from './deep-links';
const now = '2026-11-01T01:00:00.000Z';
const target = {
  kind: 'material_batch' as const,
  id: 'demo-batch',
  expectedRevision: 1,
};
const href = buildEntryDeepLink(target);
type Tx = { audits: EntryAudit[] };
async function fixture() {
  let time = now;
  const binding: CredentialBinding = {
    credentialId: 'demo-web-row',
    accountId: 'demo-hr-account',
    revision: 1,
    expiresAt: '2026-11-02T00:00:00.000Z',
    revokedAt: null,
  };
  const otherBinding: CredentialBinding = {
    ...binding,
    credentialId: 'demo-other-row',
    accountId: 'demo-other-account',
  };
  const service = createEntryIdentityService(
    {
      web: {
        verify: async (proof) =>
          proof === 'synthetic-other' ? otherBinding : binding,
        current: async (id) =>
          id === otherBinding.credentialId ? otherBinding : binding,
      },
    },
    () => new Date(now),
  );
  const identity = await service.authenticate('web', 'synthetic-proof');
  const otherIdentity = await service.authenticate('web', 'synthetic-other');
  const facts = evaluationContextFixture();
  const load = vi.fn(async (_tx: Tx, accountId: string, _now: string) => {
    void _now;
    const context = structuredClone(facts);
    if (accountId === otherBinding.accountId) {
      context.account = {
        ...context.account,
        id: accountId,
        personId: 'demo-other',
      };
      context.grants = [];
    }
    return context;
  });
  const loadContext = createEntryContextLoader(service, {
    load,
    businessNow: () => time,
  });
  let committed: EntryAudit[] = [];
  const audit = vi.fn(async (tx: Tx, event: EntryAudit) => {
    tx.audits.push(event);
  });
  const transactions: EntryTransactionPorts<Tx> = {
    async transaction(run) {
      const tx = { audits: [...committed] };
      const value = await run(tx);
      committed = tx.audits;
      return value;
    },
    audit,
  };
  const read = vi.fn(
    async (_tx: Tx, _target: typeof target): Promise<unknown> => {
      void _tx;
      void _target;
      return { kind: target.kind, id: target.id, revision: 1 };
    },
  );
  const authorize = vi.fn(
    async (_tx: Tx, context: ReturnType<typeof evaluationContextFixture>) =>
      canReadNodeTalent(
        context,
        {
          evaluationNodeId: 'demo-node',
          personId: 'demo-person',
          kind: 'person',
        },
        'source-read',
      ),
  );
  const reader = { load: read, authorize };
  return {
    open: createEntryDeepLinkUsecase({ loadContext, transactions, reader }),
    withoutReader: createEntryDeepLinkUsecase({ loadContext, transactions }),
    identity,
    otherIdentity,
    binding,
    facts,
    read,
    load,
    authorize,
    audit,
    committed: () => committed,
    time: (value: string) => {
      time = value;
    },
  };
}
describe('receipt deep links carry no authority', () => {
  it('requires authentication for an anonymously forwarded link without reading its object', async () => {
    const f = await fixture();
    expect(await f.open(null, href)).toEqual({
      status: 'authentication_required',
      returnTo: href,
    });
    expect(f.read).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
    expect(f.committed()).toEqual([]);
  });
  it('uses the currently authenticated account and refuses an account switch', async () => {
    const f = await fixture();
    expect(await f.open(f.identity, href)).toEqual({ status: 'ready', target });
    expect(await f.open(f.otherIdentity, href)).toEqual({
      status: 'forbidden',
    });
    expect(f.load).toHaveBeenLastCalledWith(
      expect.any(Object),
      'demo-other-account',
      now,
    );
    expect(f.committed()).toHaveLength(1);
  });
  it('checks current permissions for every open, including existing sessions', async () => {
    const f = await fixture();
    expect(await f.open(f.identity, href)).toHaveProperty('status', 'ready');
    f.facts.grants = [];
    expect(await f.open(f.identity, href)).toEqual({ status: 'forbidden' });
    expect(f.committed()).toHaveLength(1);
  });
  it('rejects a node relation at its exact half-open expiry boundary', async () => {
    const f = await fixture();
    f.facts.grants = [];
    const expires = '2026-11-01T01:00:01.000Z';
    f.facts.evaluationRelations = [
      {
        ...f.facts.evaluationRelations[1],
        evaluatorId: 'demo-hr',
        validTo: expires,
      },
    ];
    expect(await f.open(f.identity, href)).toHaveProperty('status', 'ready');
    f.time(expires);
    expect(await f.open(f.identity, href)).toEqual({ status: 'forbidden' });
  });
  it('returns a refresh link for an authorized stale version without source text', async () => {
    const f = await fixture();
    f.read.mockResolvedValue({ kind: target.kind, id: target.id, revision: 2 });
    expect(await f.open(f.identity, href)).toEqual({
      status: 'stale',
      refreshHref: buildEntryDeepLink({ ...target, expectedRevision: 2 }),
    });
    expect(f.committed()).toEqual([
      {
        actorId: 'demo-hr-account',
        channel: 'web',
        action: 'entry.link.open',
        resourceId: target.id,
        revision: 2,
      },
    ]);
  });
  it('does not disclose the current version to the wrong account', async () => {
    const f = await fixture();
    f.read.mockResolvedValue({
      kind: target.kind,
      id: target.id,
      revision: 919,
    });
    expect(await f.open(f.otherIdentity, href)).toEqual({
      status: 'forbidden',
    });
    expect(f.committed()).toEqual([]);
  });
  it('treats a revoked session as requiring new authentication and a safe return', async () => {
    const f = await fixture();
    f.binding.revokedAt = now;
    expect(await f.open(f.identity, href)).toEqual({
      status: 'authentication_required',
      returnTo: href,
    });
    expect(f.read).not.toHaveBeenCalled();
  });
  it('discards audit when identity or permissions change during the read', async () => {
    const f = await fixture();
    f.read.mockImplementation(async () => {
      f.facts.grants = [];
      return { kind: target.kind, id: target.id, revision: 1 };
    });
    expect(await f.open(f.identity, href)).toEqual({ status: 'forbidden' });
    expect(f.committed()).toEqual([]);
    f.facts.grants = evaluationContextFixture().grants;
    f.read.mockImplementation(async () => {
      f.binding.revokedAt = now;
      return { kind: target.kind, id: target.id, revision: 1 };
    });
    expect(await f.open(f.identity, href)).toEqual({
      status: 'authentication_required',
      returnTo: href,
    });
    expect(f.committed()).toEqual([]);
  });
  it.each([
    { kind: 'material_batch', id: 'demo-other-batch', revision: 1 },
    { kind: 'staffing_demand', id: 'demo-batch', revision: 1 },
  ])(
    'refuses an accidentally returned different object %j',
    async (resource) => {
      const f = await fixture();
      f.read.mockResolvedValue(resource);
      expect(await f.open(f.identity, href)).toEqual({ status: 'forbidden' });
      expect(f.committed()).toEqual([]);
    },
  );
  it.each([
    { kind: target.kind, id: target.id, revision: 0 },
    { kind: target.kind, id: target.id, revision: 1, text: 'private' },
    undefined,
  ])('rejects invalid or overbroad server projections %j', async (resource) => {
    const f = await fixture();
    f.read.mockResolvedValue(resource);
    expect(await f.open(f.identity, href)).toEqual({ status: 'unavailable' });
  });
  it('reports a missing object, missing adapter and sanitized infrastructure failure honestly', async () => {
    const f = await fixture();
    f.read.mockResolvedValue(null);
    expect(await f.open(f.identity, href)).toEqual({ status: 'not_found' });
    expect(await f.withoutReader(f.identity, href)).toEqual({
      status: 'unavailable',
    });
    f.read.mockRejectedValue(new Error('private storage credentials'));
    expect(await f.open(f.identity, href)).toEqual({ status: 'unavailable' });
    f.read.mockRejectedValue(new EntryUsecaseError('conflict'));
    expect(await f.open(f.identity, href)).toEqual({ status: 'conflict' });
  });
  it('does not commit an open receipt when audit fails', async () => {
    const f = await fixture();
    f.audit.mockRejectedValue(new Error('private'));
    expect(await f.open(f.identity, href)).toEqual({ status: 'unavailable' });
    expect(f.committed()).toEqual([]);
  });
  it.each([
    'https://evil.invalid/',
    '//evil.invalid',
    `${href}&token=secret`,
    `${href}&expectedRevision=2`,
    `${href}#score`,
    { id: target.id },
  ])('refuses malicious targets before authorization %j', async (malformed) => {
    const f = await fixture();
    expect(await f.open(f.identity, malformed)).toEqual({
      status: 'validation_error',
    });
    expect(f.load).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
});
