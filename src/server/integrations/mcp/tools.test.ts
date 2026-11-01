import type { MaterialBatchReceipt } from '../../../contracts/materials';
import type { QuickView } from '../../../contracts/people';
import { describe, expect, it, vi } from 'vitest';
import { MCP_ENTRY_TOOLS } from '../../../contracts/entry-tools';
import { staffingDemandJobFixture } from '../../../contracts/staffing.fixtures';
import {
  createEntryIdentityService,
  type CredentialBinding,
  type EntryIdentity,
} from '../../auth/entry/identity';
import { canReadNodeTalent } from '../../authz/evaluation-node';
import { evaluationContextFixture } from '../../modules/programs/reassignment.fixtures';
import {
  createEntryContextLoader,
  type EntryAudit,
} from '../../usecases/entry/context';
import type { EntryToolHandler } from '../../usecases/entry/tools';
import { createMcpTools, McpToolProtocolError } from './tools';

const now = '2026-11-01T01:00:00.000Z';
const proof = 'synthetic-proof-not-a-personal-token';
const recordArgs = {
  operationId: 'demo-operation',
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  text: '演示：合成工作记录',
  files: [],
};
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
type Tx = { effects: string[]; audit: EntryAudit[] };

async function fixture() {
  const binding: CredentialBinding = {
    credentialId: 'demo-mcp-binding',
    accountId: 'demo-hr-account',
    personId: 'demo-hr',
    revision: 1,
    expiresAt: '2026-11-02T00:00:00.000Z',
    revokedAt: null,
  };
  const verify = vi.fn(async (value: unknown) =>
    value === proof ? structuredClone(binding) : null,
  );
  const current = vi.fn(async () => structuredClone(binding));
  const identities = createEntryIdentityService(
    {
      mcp: { verify, current },
      web: { verify, current },
    },
    () => new Date(now),
  );
  const facts = evaluationContextFixture();
  const loadContext = createEntryContextLoader(identities, {
    load: async () => structuredClone(facts),
    businessNow: () => now,
  });
  let committed: Tx = { effects: [], audit: [] };
  const transactions = {
    async transaction<T>(run: (tx: Tx) => Promise<T>) {
      const tx = structuredClone(committed);
      const result = await run(tx);
      committed = tx;
      return result;
    },
    async audit(tx: Tx, event: EntryAudit) {
      tx.audit.push(event);
    },
  };
  const sourceFacts = {
    complete: true,
    kinds: ['work_record'],
    references: ['demo-fragment'],
  };
  let payload: unknown = receipt;
  const authorize = vi.fn(
    async (_tx: Tx, context: ReturnType<typeof evaluationContextFixture>) => {
      void _tx;
      return canReadNodeTalent(
        context,
        {
          personId: 'demo-person',
          evaluationNodeId: 'demo-node',
          kind: 'person',
        },
        'source-read',
      );
    },
  );
  const execute = vi.fn(async (tx: Tx) => {
    tx.effects.push('demo-domain-effect');
    return structuredClone(payload);
  });
  // Synthetic trusted 903 output adapter. Facts come from its own source
  // inventory, never from a DTO, a prompt, a client flag or a string scan.
  const authorizeOutput = vi.fn(async () => {
    return (
      sourceFacts.complete &&
      sourceFacts.kinds.every((kind) => kind === 'work_record') &&
      sourceFacts.references.every((id) => id === 'demo-fragment')
    );
  });
  const handler: EntryToolHandler<Tx> = {
    authorize,
    execute,
    authorizeOutput,
  };
  const handlers = Object.fromEntries(
    MCP_ENTRY_TOOLS.map((name) => [name, handler]),
  );
  const tools = createMcpTools({
    identities,
    entry: { loadContext, transactions, handlers },
  });
  return {
    tools,
    identity: await tools.authenticate(proof),
    identities,
    verify,
    current,
    binding,
    facts,
    sourceFacts,
    authorize,
    execute,
    authorizeOutput,
    handler,
    committed: () => committed,
    payload: (value: unknown) => {
      payload = value;
    },
    withoutHandlers: () =>
      createMcpTools({
        identities,
        entry: { loadContext, transactions, handlers: {} },
      }),
    incomplete: () =>
      createMcpTools({
        identities,
        entry: {
          loadContext,
          transactions,
          handlers: {
            record_moment: {
              authorize,
              execute,
            } as unknown as EntryToolHandler<Tx>,
          },
        },
      }),
  };
}

describe('MCP tools composed from the fixed 903 usecase', () => {
  it('exposes exactly three tools with schemas derived from the actual contract', async () => {
    const f = await fixture();
    const listed = await f.tools.list(f.identity);
    expect(listed.tools.map((tool) => tool.name)).toEqual(MCP_ENTRY_TOOLS);
    expect(listed.tools[0].inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: [
        'operationId',
        'evaluationNodeId',
        'personIds',
        'projectId',
        'text',
        'files',
      ],
    });
    expect(listed.tools[1].inputSchema).toMatchObject({
      properties: { id: { type: 'string' } },
    });
    expect(listed.tools[1].annotations.readOnlyHint).toBe(true);
    expect(listed.tools[0].annotations.readOnlyHint).toBe(false);
    listed.tools.pop();
    expect((await f.tools.list(f.identity)).tools).toHaveLength(3);
    expect(f.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(listed)).not.toContain(proof);
  });

  it.each([
    ['record_moment', recordArgs, receipt],
    ['person_brief', { id: 'demo-person' }, brief],
    [
      'draft_requirement',
      {
        operationId: 'demo-demand-operation',
        projectId: 'demo-project',
        inputText: '演示：起草需求',
      },
      staffingDemandJobFixture(),
    ],
  ] as const)(
    'dispatches %s and mirrors only the authorized result',
    async (name, args, payload) => {
      const f = await fixture();
      f.payload(payload);
      const result = await f.tools.call(f.identity, name, args);
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({ status: 'success', payload });
      expect(JSON.parse(result.content[0].text)).toEqual(
        result.structuredContent,
      );
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(f.authorize).toHaveBeenCalledTimes(2);
      expect(f.authorizeOutput).toHaveBeenCalledTimes(1);
      expect(f.committed().audit[0]).toMatchObject({
        actorId: 'demo-hr-account',
        channel: 'mcp',
        action: 'entry.tool.' + name,
      });
      expect(JSON.stringify(f.committed().audit)).not.toContain('inputText');
    },
  );

  it.each([
    'confirm',
    'confirm_score',
    'confirm_requirement',
    'publish_rule',
    'submit_material_batch',
    'web_entry',
    '__proto__',
  ])('rejects non-MCP tool %s without effects', async (name) => {
    const f = await fixture();
    await expect(
      f.tools.call(f.identity, name, recordArgs),
    ).rejects.toBeInstanceOf(McpToolProtocolError);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('uses runtime refinements and rejects role/identity injection', async () => {
    const f = await fixture();
    for (const args of [
      { ...recordArgs, text: '', files: [] },
      { ...recordArgs, personIds: ['demo-person', 'demo-person'] },
      { ...recordArgs, role: 'manager' },
      { ...recordArgs, accountId: 'demo-other-account' },
    ]) {
      const result = await f.tools.call(f.identity, 'record_moment', args);
      expect(result.structuredContent).toEqual({ status: 'validation_error' });
      expect(result.isError).toBe(true);
    }
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each(['missing', 'incomplete'] as const)(
    'keeps a %s trusted output adapter unavailable',
    async (kind) => {
      const f = await fixture();
      const tools = kind === 'missing' ? f.withoutHandlers() : f.incomplete();
      const result = await tools.call(f.identity, 'record_moment', recordArgs);
      expect(result.structuredContent).toEqual({ status: 'unavailable' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it('refuses an out-of-scope subject before execution', async () => {
    const f = await fixture();
    f.facts.grants = [];
    const result = await f.tools.call(f.identity, 'record_moment', recordArgs);
    expect(result.structuredContent).toEqual({ status: 'forbidden' });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.committed().effects).toEqual([]);
  });

  it.each([
    'performance',
    'promotion',
    'unknown',
    'indirect-citation',
  ] as const)(
    'does not return schema-valid %s material or citations',
    async (kind) => {
      const f = await fixture();
      f.payload({
        ...brief,
        recentFacts: {
          status: 'ready',
          data: [
            {
              eventId: 'demo-private-event',
              title: '演示：不可外发的合成内容',
              occurredOn: '2026-10-31',
              recorderName: '演示记录人',
              sources: [
                {
                  fragmentId: 'demo-private-fragment',
                  originalVersionId: 'demo-private-original',
                  location: { kind: 'document', paragraph: '演示：第1段' },
                },
              ],
            },
          ],
        },
      });
      if (kind === 'unknown') f.sourceFacts.complete = false;
      else if (kind === 'indirect-citation')
        f.sourceFacts.references = ['demo-private-fragment'];
      else f.sourceFacts.kinds = [kind];
      const result = await f.tools.call(f.identity, 'person_brief', {
        id: 'demo-person',
      });
      expect(result.structuredContent).toEqual({ status: 'forbidden' });
      expect(result.isError).toBe(true);
      expect(f.authorizeOutput).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toMatch(/private|不可外发|第1段/);
      expect(f.committed()).toEqual({ effects: [], audit: [] });
    },
  );

  it('rechecks identity and authorization after execution and rolls back', async () => {
    const f = await fixture();
    f.execute.mockImplementationOnce(async (tx: Tx) => {
      tx.effects.push('demo-pending-effect');
      f.binding.revokedAt = now;
      return receipt;
    });
    expect(
      (await f.tools.call(f.identity, 'record_moment', recordArgs))
        .structuredContent,
    ).toEqual({ status: 'unauthenticated' });
    expect(f.committed()).toEqual({ effects: [], audit: [] });
  });

  it('rolls back a person rebind during execution and never revives the old capability', async () => {
    const f = await fixture();
    f.execute.mockImplementationOnce(async (tx: Tx) => {
      tx.effects.push('demo-pending-effect');
      f.binding.personId = 'demo-other-person';
      return receipt;
    });
    expect(
      (await f.tools.call(f.identity, 'record_moment', recordArgs))
        .structuredContent,
    ).toEqual({ status: 'unauthenticated' });
    expect(f.committed()).toEqual({ effects: [], audit: [] });
    f.binding.personId = 'demo-hr';
    await expect(f.tools.list(f.identity)).rejects.toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('rejects a current directory person that differs from the trusted credential', async () => {
    const f = await fixture();
    f.facts.account.personId = 'demo-other-person';
    expect(
      (await f.tools.call(f.identity, 'record_moment', recordArgs))
        .structuredContent,
    ).toEqual({ status: 'forbidden' });
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.committed()).toEqual({ effects: [], audit: [] });
  });

  it('rejects forged, foreign-channel and revoked identities', async () => {
    const f = await fixture();
    const web = await f.identities.authenticate('web', proof);
    for (const identity of [
      web,
      { ...f.identity } as EntryIdentity,
      { channel: 'mcp' } as EntryIdentity,
    ])
      await expect(f.tools.list(identity)).rejects.toMatchObject({
        kind: 'unauthenticated',
      });
    f.binding.revokedAt = now;
    await expect(
      f.tools.call(f.identity, 'record_moment', recordArgs),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('rejects malformed and leaked domain outputs without raw error details', async () => {
    const f = await fixture();
    f.payload({ ...receipt, rawSecret: 'synthetic-private-value' });
    expect(
      (await f.tools.call(f.identity, 'record_moment', recordArgs))
        .structuredContent,
    ).toEqual({ status: 'unavailable' });
    f.execute.mockRejectedValueOnce(
      new Error('synthetic-private-vendor-error'),
    );
    const result = await f.tools.call(f.identity, 'record_moment', recordArgs);
    expect(result.structuredContent).toEqual({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('synthetic-private');
    expect(f.committed().effects).toEqual([]);
  });

  it('returns only a failure for an output referring to another object', async () => {
    const f = await fixture();
    f.payload({ ...receipt, evaluationNodeId: 'demo-other-node' });
    expect(
      (await f.tools.call(f.identity, 'record_moment', recordArgs))
        .structuredContent,
    ).toEqual({ status: 'forbidden' });
    expect(f.committed().effects).toEqual([]);
  });
});
