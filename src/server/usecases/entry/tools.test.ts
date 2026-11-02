import { describe, expect, it, vi } from 'vitest';
import {
  createEntryIdentityService,
  type EntryChannel,
  type CredentialBinding,
  type EntryIdentity,
} from '../../auth/entry/identity';
import { canReadNodeTalent } from '../../authz/evaluation-node';
import { evaluationContextFixture } from '../../modules/programs/reassignment.fixtures';
import {
  createEntryContextLoader,
  EntryUsecaseError,
  type EntryAudit,
  type EntryTransactionPorts,
} from './context';
import { createEntryToolUsecase, type EntryToolHandler } from './tools';
import type {
  EntryToolName,
  EntryToolPayload,
} from '../../../contracts/entry-tools';
import {
  staffingFixture,
  staffingDemandJobFixture,
} from '../../../contracts/staffing.fixtures';
import { buildEntryDeepLink } from '../../../contracts/entry-links';
import type {
  MaterialBatchInput,
  MaterialBatchReceipt,
} from '../../../contracts/materials';
import type { QuickView } from '../../../contracts/people';
const now = '2026-11-01T01:00:00.000Z';
const args = {
  operationId: 'demo-operation',
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  text: '演示：合成材料',
  files: [],
} satisfies MaterialBatchInput;
const receipt = {
  batchId: 'demo-batch',
  revision: 1,
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  hasHiddenContent: false,
  files: [],
  status: 'processing' as const,
  jobId: 'demo-job',
  textMaterial: {
    materialId: 'demo-text-material',
    originalVersionId: 'demo-text-original',
  },
  items: [],
  resolvedItems: [],
  draftSet: null,
  confirmedDrafts: [],
  counts: {
    files: {
      total: 0,
      processing: 0,
      parsed: 0,
      needs_review: 0,
      unsupported: 0,
      failed: 0,
      original_only: 0,
      attachment_only: 0,
    },
    events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
    reviewItems: 0,
  },
  error: null,
} satisfies MaterialBatchReceipt;
const brief = {
  role: 'hr' as const,
  person: {
    id: 'demo-person',
    demo: true,
    name: '演示小禾',
    hue: 120,
    photo: null,
    teamId: 'demo-team',
    teamName: '演示组',
    teamPath: '演示组织 / 演示组',
    jobTitle: '演示岗位',
    level: null,
    batch: null,
    tenureLabel: null,
  },
  projectLoad: { current: 0, ever: 0 },
  recentFacts: { status: 'empty' as const },
  capabilityLines: { status: 'empty' as const },
  referencePosition: { status: 'unknown' as const, reason: '演示：无快照' },
} satisfies QuickView;
type Tx = { writes: string[]; audits: EntryAudit[] };
async function fixture(channel: EntryChannel = 'web') {
  const binding: CredentialBinding = {
    credentialId: 'demo-row',
    accountId: 'demo-hr-account',
    personId: 'demo-hr',
    revision: 1,
    expiresAt: '2026-11-02T00:00:00.000Z',
    revokedAt: null,
  };
  const verifier = {
    verify: async () => binding,
    current: async () => binding,
  };
  const identities = createEntryIdentityService(
    { web: verifier, wecom: verifier, mcp: verifier, agentapi: verifier },
    () => new Date(now),
  );
  const identity = await identities.authenticate(channel, 'synthetic-proof');
  const facts = evaluationContextFixture();
  const load = vi.fn(async (_tx: Tx, _account: string, _now: string) => {
    void _tx;
    void _account;
    void _now;
    return structuredClone(facts);
  });
  const loadContext = createEntryContextLoader(identities, {
    load,
    businessNow: () => now,
  });
  let committed: Tx = { writes: [], audits: [] };
  const audit = vi.fn(async (tx: Tx, event: EntryAudit) => {
    tx.audits.push(event);
  });
  const transactions: EntryTransactionPorts<Tx> = {
    async transaction(run) {
      const tx = structuredClone(committed);
      const value = await run(tx);
      committed = tx;
      return value;
    },
    audit,
  };
  const authorize = vi.fn(
    async (
      _tx: Tx,
      context: ReturnType<typeof evaluationContextFixture>,
      input: unknown,
    ) => {
      const value = input as Record<string, unknown>;
      return canReadNodeTalent(
        context,
        {
          evaluationNodeId:
            typeof value.evaluationNodeId === 'string'
              ? value.evaluationNodeId
              : 'demo-node',
          personId:
            typeof value.id === 'string' && !('kind' in value)
              ? value.id
              : 'demo-person',
          kind: 'person',
        },
        'source-read',
      );
    },
  );
  const execute = vi.fn(
    async (
      tx: Tx,
      _input: unknown,
      loadCurrent: () => Promise<ReturnType<typeof evaluationContextFixture>>,
    ): Promise<unknown> => {
      await loadCurrent();
      tx.writes.push('synthetic-domain-effect');
      return structuredClone(receipt);
    },
  );
  const authorizeOutput = vi.fn(
    async (
      _tx: Tx,
      context: ReturnType<typeof evaluationContextFixture>,
      _input: unknown,
      _payload: EntryToolPayload,
    ) => {
      void _tx;
      void _input;
      void _payload;
      return canReadNodeTalent(
        context,
        {
          evaluationNodeId: 'demo-node',
          personId: 'demo-person',
          kind: 'person',
        },
        'source-read',
      );
    },
  );
  const handler: EntryToolHandler<Tx> = { authorize, execute, authorizeOutput };
  const handlers: Partial<Record<EntryToolName, EntryToolHandler<Tx>>> =
    Object.fromEntries(
      [
        'record_moment',
        'submit_material_batch',
        'read_material_batch',
        'person_brief',
        'draft_requirement',
        'read_requirement_status',
        'read_match_results',
        'web_entry',
        'read_comparison_summary',
      ].map((name) => [name, handler]),
    );
  return {
    invoke: createEntryToolUsecase({ loadContext, transactions, handlers }),
    identity,
    identities,
    facts,
    binding,
    load,
    execute,
    authorize,
    authorizeOutput,
    handlers,
    audit,
    committed: () => committed,
  };
}
describe('framework-free entry tool boundary', () => {
  it('produces equal domain receipts for the same identity via Web, WeCom and MCP', async () => {
    const results = [];
    for (const channel of ['web', 'wecom', 'mcp'] as const) {
      const f = await fixture(channel);
      results.push(await f.invoke(f.identity, { name: 'record_moment', args }));
      expect(f.committed().audits).toEqual([
        {
          actorId: 'demo-hr-account',
          channel,
          action: 'entry.tool.record_moment',
          resourceId: 'demo-batch',
          revision: 1,
        },
      ]);
      expect(f.load).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(f.committed().audits)).not.toContain(args.text);
    }
    expect(results).toEqual(
      [0, 1, 2].map(() => ({ status: 'success', payload: receipt })),
    );
  });
  it.each([
    'confirm_score',
    'confirm_requirement',
    'confirm',
    'publish_rule',
    'attribute',
  ])('refuses %s before effects', async (name) => {
    const f = await fixture('agentapi');
    expect(await f.invoke(f.identity, { name, args })).toEqual({
      status: 'validation_error',
    });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.committed().writes).toEqual([]);
  });
  it.each([
    { ...args, accountId: 'admin' },
    { ...args, role: 'hr' },
    { ...args, confirm: true },
  ])('does not trust caller context %j', async (input) => {
    const f = await fixture();
    expect(
      await f.invoke(f.identity, { name: 'record_moment', args: input }),
    ).toEqual({ status: 'validation_error' });
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('requires an issued identity and current complete node permissions', async () => {
    const f = await fixture();
    expect(
      await f.invoke({ channel: 'web' } as EntryIdentity, {
        name: 'record_moment',
        args,
      }),
    ).toEqual({ status: 'unauthenticated' });
    f.facts.grants = [];
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'forbidden' },
    );
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('immediately rejects revoked credentials and administrator fallback', async () => {
    const f = await fixture();
    f.binding.revokedAt = now;
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unauthenticated' },
    );
    f.binding.revokedAt = null;
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unauthenticated' },
    );
    const admin = await fixture();
    admin.facts.account.isSystemAdmin = true;
    expect(
      await admin.invoke(admin.identity, { name: 'record_moment', args }),
    ).toEqual({ status: 'forbidden' });
    expect(f.execute).not.toHaveBeenCalled();
    expect(admin.execute).not.toHaveBeenCalled();
  });
  it.each(['mcp', 'wecom'] as const)(
    '%s cannot acquire AgentAPI-only reads',
    async (channel) => {
      const f = await fixture(channel);
      expect(
        await f.invoke(f.identity, {
          name: 'read_material_batch',
          args: { batchId: 'demo-batch' },
        }),
      ).toEqual(
        channel === 'wecom'
          ? { status: 'success', payload: receipt }
          : { status: 'forbidden' },
      );
      if (channel === 'mcp') expect(f.execute).not.toHaveBeenCalled();
      if (channel === 'wecom') {
        f.execute.mockClear();
        expect(
          await f.invoke(f.identity, {
            name: 'person_brief',
            args: { id: 'demo-person' },
          }),
        ).toEqual({ status: 'forbidden' });
        expect(f.execute).not.toHaveBeenCalled();
      }
    },
  );
  it('fails closed for missing handlers, missing post-authorization and unfrozen DTOs', async () => {
    const f = await fixture('agentapi');
    delete f.handlers.record_moment;
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unavailable' },
    );
    expect(
      await f.invoke(f.identity, {
        name: 'read_comparison_summary',
        args: { batchId: 'demo-batch' },
      }),
    ).toEqual({ status: 'unavailable' });
    expect(
      await f.invoke(f.identity, {
        name: 'read_revision_status',
        args: { revisionId: 'demo-revision', expectedRevision: 1 },
      }),
    ).toEqual({ status: 'unavailable' });
    f.handlers.record_moment = {
      authorize: f.authorize,
      execute: f.execute,
    } as unknown as EntryToolHandler<Tx>;
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unavailable' },
    );
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['credential', 'grant'] as const)(
    'rolls back when %s changes during execution',
    async (change) => {
      const f = await fixture();
      f.execute.mockImplementation(async (tx) => {
        tx.writes.push('must-rollback');
        if (change === 'credential') f.binding.revokedAt = now;
        else f.facts.grants = [];
        return receipt;
      });
      expect(
        await f.invoke(f.identity, { name: 'record_moment', args }),
      ).toEqual({
        status: change === 'credential' ? 'unauthenticated' : 'forbidden',
      });
      expect(f.committed()).toEqual({ writes: [], audits: [] });
      expect(f.audit).not.toHaveBeenCalled();
    },
  );
  it('rejects a valid DTO for a different person before disclosure', async () => {
    const f = await fixture();
    f.execute.mockResolvedValue({
      ...brief,
      person: { ...brief.person, id: 'demo-other-person' },
    });
    expect(
      await f.invoke(f.identity, {
        name: 'person_brief',
        args: { id: 'demo-person' },
      }),
    ).toEqual({ status: 'forbidden' });
    expect(f.committed().audits).toEqual([]);
    expect(f.authorizeOutput).not.toHaveBeenCalled();
  });
  it('rejects a different node or batch despite a structurally valid receipt', async () => {
    const f = await fixture();
    f.execute.mockResolvedValue({
      ...receipt,
      evaluationNodeId: 'demo-other-node',
    });
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'forbidden' },
    );
    f.execute.mockResolvedValue({ ...receipt, batchId: 'demo-other-batch' });
    expect(
      await f.invoke(f.identity, {
        name: 'read_material_batch',
        args: { batchId: 'demo-batch' },
      }),
    ).toEqual({ status: 'forbidden' });
  });
  it('requires source-aware output authorization even for a legal QuickView', async () => {
    const f = await fixture();
    f.execute.mockResolvedValue(brief);
    f.authorizeOutput.mockResolvedValue(false);
    expect(
      await f.invoke(f.identity, {
        name: 'person_brief',
        args: { id: 'demo-person' },
      }),
    ).toEqual({ status: 'forbidden' });
    expect(f.committed().audits).toEqual([]);
    f.authorizeOutput.mockResolvedValue(true);
    expect(
      await f.invoke(f.identity, {
        name: 'person_brief',
        args: { id: 'demo-person' },
      }),
    ).toEqual({ status: 'success', payload: brief });
  });
  it.each([
    {
      name: 'person_brief',
      input: { id: 'demo-person' },
      payload: { ...brief, performance: 'private' },
    },
    {
      name: 'record_moment',
      input: args,
      payload: { ...receipt, confidence: 0.9 },
    },
    {
      name: 'record_moment',
      input: args,
      payload: { status: 'validation_error', input: args, fieldErrors: {} },
    },
  ])(
    'rejects unbounded or private output for $name',
    async ({ name, input, payload }) => {
      const f = await fixture();
      f.execute.mockResolvedValue(payload);
      expect(await f.invoke(f.identity, { name, args: input })).toEqual({
        status: 'unavailable',
      });
      expect(f.committed().audits).toEqual([]);
    },
  );
  it('validates staffing and Web entry payloads and binds their revisions', async () => {
    const f = await fixture('agentapi');
    const job = staffingDemandJobFixture();
    f.execute.mockResolvedValue(job);
    expect(
      await f.invoke(f.identity, {
        name: 'draft_requirement',
        args: {
          operationId: 'demo-create',
          projectId: 'demo-project',
          inputText: '演示',
        },
      }),
    ).toEqual({ status: 'success', payload: job });
    const page = staffingFixture();
    f.execute.mockResolvedValue(page.demand);
    expect(
      await f.invoke(f.identity, {
        name: 'read_requirement_status',
        args: { demandId: 'demo-demand', expectedRevision: 1 },
      }),
    ).toEqual({
      status: 'success',
      payload: { demandId: 'demo-demand', revision: 1, status: 'confirmed' },
    });
    f.execute.mockResolvedValue(page);
    expect(
      await f.invoke(f.identity, {
        name: 'read_match_results',
        args: { demandId: 'demo-demand', expectedRevision: 2 },
      }),
    ).toEqual({ status: 'forbidden' });
    expect(
      await f.invoke(f.identity, {
        name: 'read_match_results',
        args: { demandId: 'demo-demand', expectedRevision: 1 },
      }),
    ).toEqual({ status: 'success', payload: page });
    const target = {
      kind: 'staffing_demand' as const,
      id: 'demo-demand',
      expectedRevision: 1,
    };
    f.execute.mockResolvedValue({ href: buildEntryDeepLink(target) });
    expect(
      await f.invoke(f.identity, { name: 'web_entry', args: target }),
    ).toEqual({
      status: 'success',
      payload: { href: buildEntryDeepLink(target) },
    });
  });
  it('does not commit writes when output checks or audit fail', async () => {
    const f = await fixture();
    f.authorizeOutput.mockResolvedValue(false);
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'forbidden' },
    );
    expect(f.committed().writes).toEqual([]);
    f.authorizeOutput.mockResolvedValue(true);
    f.audit.mockRejectedValue(new Error('private audit payload'));
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unavailable' },
    );
    expect(f.committed().writes).toEqual([]);
  });
  it('keeps stable domain failures and sanitizes arbitrary exceptions', async () => {
    const f = await fixture();
    f.execute.mockRejectedValue(new EntryUsecaseError('conflict'));
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'conflict' },
    );
    f.execute.mockRejectedValue(new Error('private model request'));
    expect(await f.invoke(f.identity, { name: 'record_moment', args })).toEqual(
      { status: 'unavailable' },
    );
  });
});
