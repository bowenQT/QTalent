import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { EntryIdentity } from '../../auth/entry/identity';
import {
  AgentApiError,
  type AgentApiClient,
} from '../../integrations/agentapi/client';
import type { NativeEvent } from '../../integrations/agentapi/protocol';
import {
  createAgentConversationService,
  type ConversationLedger,
  type ConversationPorts,
  type ToolSuccess,
} from './service';
import type { SessionAuthority } from './session-policy';

const identity = { channel: 'agentapi' } as EntryIdentity; // Explicit test capability, no production authentication claim.
const authority: SessionAuthority = {
  accountId: 'demo-account',
  personId: 'demo-person',
  credentialId: 'demo-binding',
  credentialRevision: 1,
  authorizationDigest: 'test-current-facts',
};
const success: ToolSuccess = {
  name: 'person_brief',
  payload: {
    role: 'mentor',
    person: {
      id: 'demo-person',
      name: '演示甲',
      demo: true,
      hue: 100,
      photo: null,
      teamId: 'demo-team',
      teamName: '演示团队',
      teamPath: '演示',
      jobTitle: '工程师',
      level: null,
      batch: null,
      tenureLabel: null,
    },
    projectLoad: { current: 0, ever: 0 },
    recentFacts: { status: 'empty' },
    capabilityLines: {
      status: 'insufficient_evidence',
      reason: '演示材料不足',
    },
  },
};
const toolEvents = (
  name = 'person_brief',
  input: unknown = { id: 'demo-person' },
): NativeEvent[] => [
  { id: 'evt-user', type: 'user.message' },
  { id: 'evt-tool', type: 'agent.custom_tool_use', name, input },
  {
    id: 'evt-idle',
    type: 'session.status_idle',
    stop_reason: { type: 'requires_action', event_ids: ['evt-tool'] },
  },
];
const completeEvents: NativeEvent[] = [
  { id: 'evt-user', type: 'user.message' },
  {
    id: 'evt-text',
    type: 'agent.message',
    content: [{ type: 'text', text: '演示建议，待人工核实。' }],
  },
  {
    id: 'evt-done',
    type: 'session.status_idle',
    stop_reason: { type: 'end_turn' },
  },
];
/** Explicit serializable, rollback-capable test substitute. This is NOT PG. */
function fixture() {
  let ledger: ConversationLedger | null = {
    conversation: {
      id: 'demo-conversation',
      authority: structuredClone(authority),
      providerSessionId: 'ses_demo',
      state: 'active',
      cleanup: 'none',
    },
    turns: [],
    tools: [],
  };
  let tail = Promise.resolve();
  const transactionScope = new AsyncLocalStorage<boolean>();
  let writes = 0;
  let current = structuredClone(authority);
  const valid = vi.fn(async () => true);
  const execute = vi.fn<ConversationPorts<{ writes: number }>['execute']>(
    async (tx) => {
      tx.writes++;
      return structuredClone(success);
    },
  );
  const readCurrent = vi.fn(async () => structuredClone(current));
  const ports: ConversationPorts<{ writes: number }> = {
    async transaction<T>(
      _id: string,
      run: (
        tx: { writes: number },
        row: ConversationLedger | null,
      ) => Promise<T>,
    ) {
      let release!: () => void;
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const tx = { writes };
      const draft = structuredClone(ledger);
      try {
        const result = await transactionScope.run(true, () => run(tx, draft));
        ledger = draft;
        writes = tx.writes;
        return result;
      } finally {
        release();
      }
    },
    save: vi.fn(async () => undefined),
    current: readCurrent,
    execute,
    revalidate: valid,
  };
  const provider: Pick<AgentApiClient, 'send' | 'events' | 'archive'> = {
    send: vi.fn(async (_id, event) => {
      expect(transactionScope.getStore()).not.toBe(true);
      return event.type === 'user.message' ? 'evt-user' : 'evt-result';
    }),
    events: vi.fn(async () => {
      expect(transactionScope.getStore()).not.toBe(true);
      return structuredClone(completeEvents);
    }),
    archive: vi.fn(async () => {
      expect(transactionScope.getStore()).not.toBe(true);
    }),
  };
  const service = createAgentConversationService(ports, provider);
  return {
    service,
    provider,
    ports,
    execute,
    valid,
    readCurrent,
    row: () => ledger!,
    writes: () => writes,
    setAuthority: (value: Partial<SessionAuthority>) => {
      current = { ...current, ...value };
    },
    remove: () => {
      ledger = null;
    },
    submit: () =>
      service.submit(identity, 'demo-conversation', 'op-one', '读取演示资料'),
    advance: () => service.advance(identity, 'demo-conversation', 'op-one'),
    cancel: () => service.cancel(identity, 'demo-conversation'),
  };
}

describe('AgentAPI conversation orchestration (explicit transaction substitute)', () => {
  it('serializes concurrent user operation replay and never duplicates POST', async () => {
    const f = fixture();
    await Promise.all([f.submit(), f.submit()]);
    expect(f.provider.send).toHaveBeenCalledTimes(1);
    expect(f.row().turns).toHaveLength(1);
    await expect(
      f.service.submit(identity, 'demo-conversation', 'op-one', '不同内容'),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(f.advance()).resolves.toEqual({
      status: 'complete',
      text: '演示建议，待人工核实。',
      nature: 'ai_suggestion',
    });
    await expect(f.submit()).resolves.toMatchObject({ status: 'complete' });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });
  it('rejects overlapping turns, missing conversations and invalid bounded input before network', async () => {
    const f = fixture();
    await f.submit();
    await expect(
      f.service.submit(identity, 'demo-conversation', 'op-two', '另一请求'),
    ).rejects.toMatchObject({ kind: 'conflict' });
    await expect(
      f.service.submit(identity, 'demo-conversation', '', '请求'),
    ).rejects.toThrow();
    await expect(
      f.service.submit(identity, 'demo-conversation', 'x', 'x'.repeat(65537)),
    ).rejects.toThrow();
    await expect(
      f.service.advance(identity, 'demo-conversation', 'missing'),
    ).rejects.toMatchObject({ kind: 'not_found' });
    f.remove();
    await expect(f.submit()).rejects.toMatchObject({ kind: 'not_found' });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });
  it.each([new AgentApiError('timeout', true), new Error('untrusted failure')])(
    'unknown POST is durable and cannot be resubmitted',
    async (error) => {
      const f = fixture();
      vi.mocked(f.provider.send).mockRejectedValue(error);
      await expect(f.submit()).resolves.toEqual({ status: 'outcome_unknown' });
      expect(f.row().conversation.state).toBe('outcome_unknown');
      await expect(f.submit()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(f.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps definitive rejection separate from unknown outcome', async () => {
    const f = fixture();
    vi.mocked(f.provider.send).mockRejectedValue(
      new AgentApiError('rate_limited'),
    );
    await expect(f.submit()).rejects.toMatchObject({ kind: 'model_failed' });
    expect(f.row().conversation.state).toBe('failed');
    expect(f.row().turns[0]!.state).toBe('failed');
  });
  it('crashed reserved input is not automatically reposted', async () => {
    const f = fixture();
    await f.submit();
    f.row().turns[0]!.state = 'reserved';
    f.row().turns[0]!.userEventId = null;
    await expect(f.submit()).resolves.toEqual({ status: 'outcome_unknown' });
    await expect(f.advance()).resolves.toEqual({ status: 'outcome_unknown' });
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });
  it('another account cannot read, invalidate or cancel an owner conversation', async () => {
    const f = fixture();
    f.setAuthority({ accountId: 'different-account' });
    await expect(f.submit()).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.cancel()).rejects.toMatchObject({ kind: 'forbidden' });
    expect(f.row().conversation.state).toBe('active');
    expect(f.provider.send).not.toHaveBeenCalled();
    expect(f.provider.archive).not.toHaveBeenCalled();
  });
  it.each([
    { personId: 'changed-person' },
    { credentialRevision: 2 },
    { credentialId: 'other-binding' },
    { authorizationDigest: 'revoked-or-expired-facts' },
  ])(
    'changed trusted facts permanently invalidate provider context %j',
    async (change) => {
      const f = fixture();
      f.setAuthority(change);
      await expect(f.submit()).rejects.toMatchObject({
        kind: 'permission_changed',
      });
      expect(f.row().conversation.state).toBe('invalidated');
      f.setAuthority(authority);
      await expect(f.submit()).rejects.toMatchObject({
        kind: 'permission_changed',
      });
      expect(f.provider.send).not.toHaveBeenCalled();
    },
  );
  it('current credential lookup failure never falls back to cached authority', async () => {
    const f = fixture();
    f.readCurrent.mockRejectedValue(new Error('revoked'));
    await expect(f.submit()).rejects.toThrow();
    expect(f.provider.send).not.toHaveBeenCalled();
  });
  it('rechecks authority after POST and after GET before revealing anything', async () => {
    const f = fixture();
    vi.mocked(f.provider.send).mockImplementation(async () => {
      f.setAuthority({ credentialRevision: 2 });
      return 'evt-user';
    });
    await expect(f.submit()).rejects.toMatchObject({
      kind: 'permission_changed',
    });
    expect(f.row().turns[0]!.userEventId).toBe('evt-user');
    const g = fixture();
    await g.submit();
    vi.mocked(g.provider.events).mockImplementation(async () => {
      g.setAuthority({ authorizationDigest: 'new' });
      return completeEvents;
    });
    await expect(g.advance()).rejects.toMatchObject({
      kind: 'permission_changed',
    });
    expect(g.row().turns[0]!.answer).toBeNull();
  });
  it('executes and audits a tool once in the receipt transaction, then sends outside it', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    await Promise.all([f.advance(), f.advance()]);
    expect(f.writes()).toBe(1);
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.provider.send).toHaveBeenCalledTimes(2);
    expect(f.row().tools[0]).toMatchObject({
      state: 'sent',
      resultEventId: 'evt-result',
    });
    expect(f.row().tools[0]!.businessOperationId).toMatch(/^[a-f0-9]{64}$/);
    vi.mocked(f.provider.events).mockResolvedValue([
      ...toolEvents(),
      ...completeEvents.slice(1),
    ]);
    await expect(f.advance()).resolves.toMatchObject({
      status: 'complete',
      nature: 'ai_suggestion',
    });
    expect(f.writes()).toBe(1);
  });
  it.each(['submit_material_batch', 'draft_requirement'] as const)(
    'uses the frozen %s DTO and replaces model-chosen business operation IDs',
    async (name) => {
      const f = fixture();
      await f.submit();
      const args =
        name === 'submit_material_batch'
          ? {
              operationId: 'model-chosen',
              evaluationNodeId: 'demo-node',
              personIds: ['demo-person'],
              projectId: null,
              text: '合成演示记录',
              files: [],
            }
          : {
              operationId: 'model-chosen',
              projectId: 'demo-project',
              inputText: '合成演示需求',
            };
      const result: ToolSuccess =
        name === 'submit_material_batch'
          ? {
              name,
              payload: {
                batchId: 'demo-batch',
                revision: 1,
                evaluationNodeId: 'demo-node',
                personIds: ['demo-person'],
                projectId: null,
                hasHiddenContent: false,
                status: 'processing',
                jobId: 'demo-job',
                files: [],
                textMaterial: {
                  materialId: 'demo-material',
                  originalVersionId: 'demo-original',
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
              },
            }
          : {
              name,
              payload: {
                schemaVersion: 1,
                jobId: 'demo-job',
                kind: 'staffing_demand',
                status: 'queued',
                attempt: 1,
                revision: 1,
                updatedAt: '2026-11-01T00:00:00.000Z',
                progress: null,
                result: null,
                error: null,
                canRetry: false,
                canCancel: true,
                cancelRequestedAt: null,
              },
            };
      f.execute.mockImplementation(async (tx) => {
        tx.writes++;
        return result;
      });
      vi.mocked(f.provider.events).mockResolvedValue(toolEvents(name, args));
      await f.advance();
      const call = f.execute.mock.calls[0]!;
      expect(call[3]).toMatchObject({ operationId: call[4] });
      expect(call[4]).not.toBe('model-chosen');
      expect(f.row().tools[0]!.args).toEqual(args);
      expect(f.row().tools[0]!.success).toEqual(result);
      expect(f.writes()).toBe(1);
    },
  );
  it('rejects over-budget tool disclosure with a complete transaction rollback', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    f.execute.mockImplementation(async (tx) => {
      tx.writes++;
      const result = structuredClone(success);
      result.payload.person.name = '演示'.repeat(22000);
      return result;
    });
    await expect(f.advance()).rejects.toMatchObject({ kind: 'budget' });
    expect(f.writes()).toBe(0);
    expect(f.row().tools).toHaveLength(0);
    expect(f.provider.send).toHaveBeenCalledTimes(1);
  });
  it('unknown tool-result POST preserves committed business effect and never executes/sends again', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    vi.mocked(f.provider.send).mockRejectedValue(
      new AgentApiError('timeout', true),
    );
    await expect(f.advance()).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
    expect(f.row().tools[0]!.state).toBe('outcome_unknown');
    expect(f.writes()).toBe(1);
    await expect(f.advance()).rejects.toMatchObject({ kind: 'unavailable' });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.provider.send).toHaveBeenCalledTimes(2);
  });
  it('does not resend a crashed sending tool receipt; completed tool history must stay identical', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    await f.advance();
    f.row().tools[0]!.state = 'sending';
    await f.advance();
    expect(f.provider.send).toHaveBeenCalledTimes(2);
    vi.mocked(f.provider.events).mockResolvedValue(
      toolEvents('person_brief', { id: 'other-person' }),
    );
    await expect(f.advance()).rejects.toMatchObject({ kind: 'protocol' });
    expect(f.writes()).toBe(1);
  });
  it('revalidates prior-turn source visibility before sending any new context', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    await f.advance();
    vi.mocked(f.provider.events).mockResolvedValue([
      ...toolEvents(),
      ...completeEvents.slice(1),
    ]);
    await f.advance();
    f.valid.mockResolvedValue(false);
    await expect(
      f.service.submit(identity, 'demo-conversation', 'op-two', '继续'),
    ).rejects.toMatchObject({ kind: 'permission_changed' });
    expect(f.row().conversation.state).toBe('invalidated');
    expect(f.provider.send).toHaveBeenCalledTimes(2);
  });
  it.each([
    'read_comparison_summary',
    'read_revision_status',
    'confirm_rating',
    'read_material_batch',
  ])(
    'unimplemented or prohibited tool %s is never an arbitrary successful object',
    async (name) => {
      const f = fixture();
      await f.submit();
      const args =
        name === 'read_revision_status'
          ? { revisionId: 'demo', expectedRevision: 1 }
          : name === 'read_material_batch' || name === 'read_comparison_summary'
            ? { batchId: 'demo' }
            : {};
      vi.mocked(f.provider.events).mockResolvedValue(toolEvents(name, args));
      await expect(f.advance()).rejects.toMatchObject({ kind: 'unavailable' });
      expect(f.execute).not.toHaveBeenCalled();
      expect(f.provider.send).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['wrong-person', 'invalid-payload', 'wrong-name'])(
    'invalid successful DTO rolls back domain mutation: %s',
    async (kind) => {
      const f = fixture();
      await f.submit();
      vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
      f.execute.mockImplementation(async (tx) => {
        tx.writes++;
        const result = structuredClone(success);
        if (kind === 'wrong-person')
          result.payload.person.id = 'different-person';
        else if (kind === 'wrong-name')
          return {
            ...result,
            name: 'draft_requirement',
          } as unknown as ToolSuccess;
        else
          return {
            name: 'person_brief',
            payload: { secret: 'not-a-dto' },
          } as unknown as ToolSuccess;
        return result;
      });
      await expect(f.advance()).rejects.toMatchObject({ kind: 'protocol' });
      expect(f.writes()).toBe(0);
      expect(f.row().tools).toHaveLength(0);
    },
  );
  it('authority/source change during domain execution rolls back write and receipt', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    f.execute.mockImplementation(async (tx) => {
      tx.writes++;
      f.setAuthority({ credentialRevision: 2 });
      return structuredClone(success);
    });
    await expect(f.advance()).rejects.toMatchObject({
      kind: 'permission_changed',
    });
    expect(f.writes()).toBe(0);
    expect(f.row().conversation.state).toBe('invalidated');
    const g = fixture();
    await g.submit();
    vi.mocked(g.provider.events).mockResolvedValue(toolEvents());
    g.valid.mockResolvedValue(false);
    await expect(g.advance()).rejects.toMatchObject({
      kind: 'permission_changed',
    });
    expect(g.writes()).toBe(0);
  });
  it('read failure is retryable but model error is terminal and not insufficient evidence', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockRejectedValueOnce(
      new AgentApiError('timeout'),
    );
    await expect(f.advance()).rejects.toMatchObject({ kind: 'timeout' });
    expect(f.row().conversation.state).toBe('active');
    vi.mocked(f.provider.events).mockResolvedValue([
      { id: 'evt-user', type: 'user.message' },
      { id: 'evt-fail', type: 'session.error' },
    ]);
    await expect(f.advance()).rejects.toMatchObject({ kind: 'model_failed' });
    expect(f.row().turns[0]!.answer).toBeNull();
  });
  it('bounds polling, and waits when the provider has not accepted the event in history', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue([]);
    await expect(f.advance()).resolves.toMatchObject({ status: 'waiting' });
    f.row().turns[0]!.polls = 120;
    await expect(f.advance()).rejects.toMatchObject({ kind: 'budget' });
    expect(f.provider.events).toHaveBeenCalledTimes(1);
  });
  it('cancel archives once, records unknown cleanup, and cannot roll back committed tools', async () => {
    const f = fixture();
    await f.submit();
    vi.mocked(f.provider.events).mockResolvedValue(toolEvents());
    await f.advance();
    vi.mocked(f.provider.archive).mockRejectedValue(
      new AgentApiError('timeout', true),
    );
    await expect(f.cancel()).resolves.toEqual({
      status: 'cancelled',
      cleanup: 'unknown',
    });
    await f.cancel();
    expect(f.row().conversation.cleanup).toBe('unknown');
    expect(f.provider.archive).toHaveBeenCalledTimes(1);
    expect(f.writes()).toBe(1);
    await expect(f.submit()).rejects.toMatchObject({ kind: 'cancelled' });
    const g = fixture();
    await g.cancel();
    expect(g.row().conversation.cleanup).toBe('verified');
  });
});
