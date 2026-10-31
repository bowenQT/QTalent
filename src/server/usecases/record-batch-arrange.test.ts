import { describe, expect, it } from 'vitest';
import {
  createFakeModelinkMaas,
  MODELINK_MODEL,
  type ModelinkMaasClient,
  type MaasFailureKind,
} from '../integrations/maas';
import type { ModelBatch } from '../modules/records/arrange/batch-prompt';
import type {
  RecordBatchDraft,
  RecordBatchDraftSet,
} from '../../contracts/record';
import {
  createRecordBatchArrange,
  type BatchArrangeOperation,
  type BatchArrangePorts,
  type BatchArrangeRequest,
  type BatchArrangeCommit,
  type BatchArrangeTransaction,
} from './record-batch-arrange';
import {
  type BatchSnapshot,
  type BatchRuleBundle,
} from '../modules/records/arrange/batch';
function fixture() {
  const snapshot: BatchSnapshot = {
    batchId: 'demo-batch',
    accountId: 'demo-account',
    evaluationNodeId: 'demo-node',
    batchRevision: 1,
    inputVersion: 'demo-input',
    boundAt: '2026-10-31T12:00:00.000Z',
    writeAllowed: true,
    identities: 'resolved',
    personIds: ['demo-person'],
    generation: { kind: 'initial' },
    context: {
      account: {
        id: 'demo-account',
        personId: 'demo-evaluator',
        isSystemAdmin: false,
      },
      now: '2026-10-31T12:00:00.000Z',
      grants: [],
      enrollments: [],
      assignments: [],
      projects: [],
      members: [],
      people: [{ id: 'demo-person', noReview: false }],
      evaluationNodes: [
        { id: 'demo-node', kind: 'program_cohort', cohortId: 'demo-cohort' },
      ],
      evaluationNodeSubjects: [
        { evaluationNodeId: 'demo-node', personId: 'demo-person' },
      ],
      evaluationRelations: [
        {
          id: 'demo-relation',
          evaluationNodeId: 'demo-node',
          personId: 'demo-person',
          evaluatorId: 'demo-evaluator',
          kind: 'evaluator',
          validFrom: '2026-10-01T00:00:00.000Z',
          validTo: null,
          revokedAt: null,
        },
      ],
    },
    requestedSources: [
      {
        fragmentId: 'demo-fragment',
        originalVersionId: 'demo-original-v1',
        location: { kind: 'document', paragraph: '演示第一段' },
      },
    ],
    availableSources: [],
  };
  snapshot.availableSources = [
    {
      reference: snapshot.requestedSources[0],
      text: '演示：补齐回滚步骤。',
      complete: true,
      scope: 'resolved',
      category: 'original',
      kind: 'evaluation',
      requiredKinds: [],
      subjects: [
        {
          personId: 'demo-person',
          cohortId: 'demo-cohort',
          evaluationNodeId: 'demo-node',
        },
      ],
      attributedPersonIds: ['demo-person'],
      acquisition: { kind: 'text', version: 'demo-text-v1' },
    },
  ];
  const rules: BatchRuleBundle = {
    effective: {
      category: 'dimension_anchors',
      versionId: 'rubric-v1',
      provenance: 'published',
      effectiveFrom: '2026-10-01T00:00:00.000Z',
      effectiveUntil: null,
    },
    contentVersionId: 'rubric-v1',
    dimensionVersionId: 'demo-dimension-v1',
    anchorVersionId: 'demo-anchor-v1',
    dimensions: ['demo-dimension'],
    anchors: [
      {
        id: 'demo-anchor',
        dimensionId: 'demo-dimension',
        versionId: 'demo-anchor-v1',
        value: 3,
        text: '有具体行为',
      },
    ],
  };
  return { snapshot, rules };
}
function harness() {
  const { snapshot, rules } = fixture();
  const q = {
    reference: structuredClone(snapshot.requestedSources[0]),
    quote: '补齐回滚步骤',
  };
  const modelValue: ModelBatch = {
    events: [
      {
        eventKey: 'proposal-a',
        personIds: ['demo-person'],
        sbi: {
          title: '演示：回滚验证',
          situation: '',
          behavior: '补齐回滚步骤',
          impact: '',
        },
        evidence: [q],
        scores: [
          {
            state: 'suggested',
            personId: 'demo-person',
            dimensionId: 'demo-dimension',
            value: 3,
            anchor: {
              id: 'demo-anchor',
              text: '有具体行为',
              ruleVersion: 'demo-anchor-v1',
            },
            citations: [q],
          },
        ],
      },
    ],
    similarGroups: [],
  };
  const request: BatchArrangeRequest = {
    accountId: snapshot.accountId,
    batchId: snapshot.batchId,
    operationId: 'demo-operation-1',
    attempt: 1,
  };
  const state: {
    snapshot: BatchSnapshot | null;
    rules: BatchRuleBundle;
    operation: BatchArrangeOperation | null;
    draftsByKey: Record<string, RecordBatchDraft>;
    saved: RecordBatchDraftSet[];
    traces: BatchArrangeCommit[];
  } = {
    snapshot,
    rules,
    operation: {
      ...request,
      inputVersion: snapshot.inputVersion,
      phase: 'queued',
      cancelRequested: false,
      failure: null,
      trace: null,
      draftSet: null,
    },
    draftsByKey: {},
    saved: [],
    traces: [],
  };
  const controls: {
    beforeModel?: () => void | Promise<void>;
    failure?: { kind: MaasFailureKind; retryable: boolean };
    exception?: boolean;
    wrongMetadata?: boolean;
    persistFailure?: boolean;
    corruptReceipt?: boolean;
    invalidReservation?: boolean;
  } = {};
  const messages: string[] = [];
  const ruleReads: unknown[] = [];
  let gate = Promise.resolve();
  const ports: BatchArrangePorts = {
    async locked<T>(
      _request: BatchArrangeRequest,
      fn: (tx: BatchArrangeTransaction) => Promise<T>,
    ): Promise<T> {
      const previous = gate;
      let unlock!: () => void;
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      const draft = structuredClone(state);
      let pendingKeys: string[] = [];
      try {
        const result = await fn({
          operation: draft.operation,
          async loadSnapshot() {
            return structuredClone(draft.snapshot);
          },
          async readRules(input) {
            ruleReads.push(input);
            return structuredClone(draft.rules);
          },
          async saveOperation(value) {
            draft.operation = structuredClone(value);
          },
          async reserveIdentities(plan) {
            pendingKeys = plan.events.map((e) => e.eventKey);
            const assigned: Record<string, string> = {
              'proposal-a': 'server-opaque-7f3',
              'proposal-b': 'server-opaque-9d2',
            };
            return {
              expectedBatchRevision: draft.snapshot!.batchRevision,
              drafts: plan.events.map((e) => ({
                eventKey: e.eventKey,
                draftId: controls.invalidReservation
                  ? ''
                  : assigned[e.eventKey],
                previous: draft.draftsByKey[e.eventKey] ?? null,
              })),
              candidates: plan.groups.map((g) => ({
                key: g.key,
                candidateId: 'server-candidate-6b1',
              })),
            };
          },
          async persistDraftSet(value, trace) {
            if (controls.persistFailure)
              throw new Error('private SQL details must not be returned');
            draft.saved.push(structuredClone(value));
            draft.traces.push(structuredClone(trace));
            draft.snapshot!.batchRevision = value.revision;
            pendingKeys.forEach((key, index) => {
              draft.draftsByKey[key] = structuredClone(value.drafts[index]);
            });
            return controls.corruptReceipt
              ? { ...value, batchId: 'other-batch' }
              : structuredClone(value);
          },
        });
        Object.assign(state, draft);
        return result;
      } finally {
        unlock();
      }
    },
  };
  const client: ModelinkMaasClient = {
    async generateStructured(input) {
      messages.push(JSON.stringify(input.messages));
      await controls.beforeModel?.();
      if (controls.exception) throw new Error('private upstream details');
      if (controls.failure)
        return {
          ok: false,
          ...controls.failure,
          metadata: {
            model: MODELINK_MODEL,
            promptVersion: input.promptVersion,
            attempts: 1,
            elapsedMs: 0,
          },
        };
      const result =
        await createFakeModelinkMaas(modelValue).generateStructured(input);
      if (controls.wrongMetadata)
        Object.assign(result.metadata, { model: 'wrong-model' });
      return result;
    },
  };
  const run = createRecordBatchArrange(ports, client);
  return {
    state,
    controls,
    modelValue,
    request,
    run,
    messages,
    ruleReads,
    client,
  };
}
describe('record batch orchestration with native transaction requirements and843 fake', () => {
  it.each(['text', 'offline_transcript', 'parsed_attachment'] as const)(
    'runs the fixed %s sample through the same prompt and quote validation',
    async (kind) => {
      const h = harness();
      const source = h.state.snapshot!.availableSources[0];
      if (kind === 'offline_transcript') {
        source.reference.location = {
          kind: 'recording',
          startMs: 100,
          endMs: 2400,
        };
        source.acquisition = {
          kind,
          recordingId: 'demo-recording',
          transcriptVersionId: 'demo-transcript-v1',
          bindingRevision: 3,
          binding: 'resolved',
        };
      }
      if (kind === 'parsed_attachment')
        source.acquisition = { kind, parseVersionId: 'demo-parse-v1' };
      h.modelValue.events[0].evidence[0].reference = structuredClone(
        source.reference,
      );
      const score = h.modelValue.events[0].scores[0];
      if (score.state !== 'suggested') throw new Error('fixture');
      score.citations = structuredClone(h.modelValue.events[0].evidence);
      expect((await h.run(h.request)).status).toBe('drafts');
      expect(h.state.saved[0].drafts[0].sourceReferences).toEqual([
        source.reference,
      ]);
      expect(h.state.saved[0].drafts[0].scores[0]).toMatchObject({
        state: 'suggested',
        citations: [{ quote: '补齐回滚步骤', reference: source.reference }],
      });
      expect(h.messages).toHaveLength(1);
    },
  );
  it('generates one model proposal, persists server IDs/double versions and replays without another call', async () => {
    const h = harness();
    const first = await h.run(h.request);
    expect(first.status).toBe('drafts');
    expect(h.state.saved).toHaveLength(1);
    expect(h.state.saved[0].drafts[0]).toMatchObject({
      draftId: 'server-opaque-7f3',
      origin: 'ai_suggestion',
      revision: 1,
      dimensionVersionId: 'demo-dimension-v1',
      anchorVersionId: 'demo-anchor-v1',
    });
    expect(h.state.traces[0]).toMatchObject({
      modelVersion: MODELINK_MODEL,
      promptVersion: 'record-batch-arrange.v1',
      inputVersion: 'demo-input',
    });
    expect(h.state.traces[0].events[0]).toMatchObject({
      eventKey: 'proposal-a',
      draftId: 'server-opaque-7f3',
      witnesses: [{ quote: '补齐回滚步骤' }],
    });
    expect(h.ruleReads).toEqual([
      { category: 'dimension_anchors', at: '2026-10-31T12:00:00.000Z' },
      { category: 'dimension_anchors', at: '2026-10-31T12:00:00.000Z' },
    ]);
    expect(await h.run(h.request)).toEqual(first);
    expect(h.messages).toHaveLength(1);
    expect(h.state.saved).toHaveLength(1);
    expect(JSON.stringify(first)).not.toMatch(
      /confirmedAt|confirmationIds|quadrant|totalScore/,
    );
  });
  it('keeps two same-person events with distinct ledger IDs rather than deduplicating people', async () => {
    const h = harness();
    h.state.snapshot!.availableSources[0].text += '另一次检查边界。';
    h.modelValue.events.push({
      ...structuredClone(h.modelValue.events[0]),
      eventKey: 'proposal-b',
      sbi: {
        title: '演示：第二件事待确认',
        situation: '',
        behavior: '检查边界',
        impact: '',
      },
      evidence: [
        {
          reference: structuredClone(h.state.snapshot!.requestedSources[0]),
          quote: '检查边界',
        },
      ],
      scores: [],
    });
    const result = await h.run(h.request);
    expect(result.status).toBe('drafts');
    expect(h.state.saved[0].drafts.map((d) => d.draftId)).toEqual([
      'server-opaque-7f3',
      'server-opaque-9d2',
    ]);
  });
  it.each([
    'scope',
    'identity',
    'historical',
    'incomplete',
    'hidden-owner',
    'expired',
    'performance',
    'no-write',
    'empty-attribution',
  ] as const)('calls the model zero times for %s', async (fault) => {
    const h = harness();
    const s = h.state.snapshot!;
    const source = s.availableSources[0];
    if (fault === 'scope') source.scope = 'unresolved';
    if (fault === 'identity') s.identities = 'unresolved';
    if (fault === 'historical') source.category = 'historical_evaluation';
    if (fault === 'incomplete') source.complete = false;
    if (fault === 'hidden-owner')
      source.subjects.push({
        personId: 'demo-hidden',
        cohortId: null,
        evaluationNodeId: 'demo-node',
      });
    if (fault === 'expired')
      s.context.evaluationRelations[0].validTo = s.context.now;
    if (fault === 'performance') source.requiredKinds.push('performance');
    if (fault === 'no-write') s.writeAllowed = false;
    if (fault === 'empty-attribution') source.attributedPersonIds = [];
    expect((await h.run(h.request)).status).not.toBe('drafts');
    expect(h.messages).toEqual([]);
    expect(h.state.saved).toEqual([]);
  });
  it.each([
    'permission',
    'source',
    'binding',
    'rules',
    'batch-revision',
    'input-version',
  ] as const)(
    'rechecks %s after the model wait and prevents stale output',
    async (change) => {
      const h = harness();
      h.controls.beforeModel = () => {
        const s = h.state.snapshot!;
        if (change === 'permission')
          s.context.evaluationRelations[0].revokedAt = s.context.now;
        if (change === 'source')
          s.availableSources[0].text = '演示：版本已修改';
        if (change === 'binding')
          s.availableSources[0].attributedPersonIds = [];
        if (change === 'rules')
          h.state.rules.anchorVersionId = 'demo-anchor-v2';
        if (change === 'batch-revision') s.batchRevision++;
        if (change === 'input-version') s.inputVersion = 'new-input';
      };
      expect(await h.run(h.request)).toEqual({
        status: 'failed',
        kind: 'input_changed',
        retryable: false,
      });
      expect(h.state.saved).toEqual([]);
      expect(h.messages).toHaveLength(1);
    },
  );
  it('claims one concurrent delivery and refuses an old-attempt response', async () => {
    const h = harness();
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    h.controls.beforeModel = async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const first = h.run(h.request);
    await reached;
    expect(await h.run(h.request)).toEqual({ status: 'ignored' });
    h.state.operation!.attempt = 2;
    h.state.operation!.phase = 'queued';
    release();
    expect(await first).toEqual({ status: 'ignored' });
    expect(h.messages).toHaveLength(1);
    expect(h.state.saved).toEqual([]);
  });
  it.each(['before', 'during', 'signal-before', 'signal-during'] as const)(
    'handles cancellation %s without writing drafts',
    async (when) => {
      const h = harness();
      const controller = new AbortController();
      if (when === 'before') h.state.operation!.cancelRequested = true;
      if (when === 'during')
        h.controls.beforeModel = () => {
          h.state.operation!.cancelRequested = true;
        };
      if (when === 'signal-before') controller.abort();
      if (when === 'signal-during')
        h.controls.beforeModel = () => {
          controller.abort();
        };
      expect(await h.run(h.request, controller.signal)).toEqual({
        status: 'cancelled',
      });
      expect(h.state.saved).toEqual([]);
      expect(h.messages.length).toBe(
        when === 'before' || when === 'signal-before' ? 0 : 1,
      );
    },
  );
  it('does not rebind a saved generation or re-call the model after later publication', async () => {
    const h = harness();
    const first = await h.run(h.request);
    h.state.rules.effective.effectiveUntil = '2026-11-01T00:00:00.000Z';
    expect(await h.run(h.request)).toEqual(first);
    expect(h.messages).toHaveLength(1);
    expect(h.state.saved[0].drafts[0].anchorVersionId).toBe('demo-anchor-v1');
  });
  it('keeps IDs when explicitly regenerating an existing event and advances its revision', async () => {
    const h = harness();
    await h.run(h.request);
    const first = h.state.saved[0].drafts[0];
    h.state.snapshot!.generation = {
      kind: 'revise',
      events: structuredClone(h.state.traces[0].events),
    };
    h.state.snapshot!.inputVersion = 'demo-input-v2';
    h.state.operation = {
      ...h.state.operation!,
      operationId: 'demo-operation-2',
      inputVersion: 'demo-input-v2',
      phase: 'queued',
      trace: null,
      draftSet: null,
    };
    h.modelValue.events[0].sbi.title = '演示：已补充的标题';
    expect(
      (await h.run({ ...h.request, operationId: 'demo-operation-2' })).status,
    ).toBe('drafts');
    expect(h.state.saved[1].drafts[0].draftId).toBe(first.draftId);
    expect(h.state.saved[1].drafts[0].revision).toBe(2);
  });
  it('returns retryability only for a proven retryable network failure and caps explicit attempts', async () => {
    const h = harness();
    h.controls.failure = { kind: 'network', retryable: true };
    expect(await h.run(h.request)).toEqual({
      status: 'failed',
      kind: 'network',
      retryable: true,
    });
    h.state.operation!.attempt = 2;
    h.state.operation!.phase = 'queued';
    delete h.controls.failure;
    expect((await h.run({ ...h.request, attempt: 2 })).status).toBe('drafts');
    expect(h.messages).toHaveLength(2);
    h.state.operation!.attempt = 3;
    h.state.operation!.phase = 'queued';
    expect(await h.run({ ...h.request, attempt: 3 })).toEqual({
      status: 'ignored',
    });
    expect(h.messages).toHaveLength(2);
  });
  it.each(['outcome_unknown', 'invalid_response', 'authentication'] as const)(
    'never retries %s automatically or by a forged second attempt',
    async (kind) => {
      const h = harness();
      h.controls.failure = { kind, retryable: true };
      expect(await h.run(h.request)).toEqual({
        status: 'failed',
        kind,
        retryable: false,
      });
      h.state.operation!.attempt = 2;
      h.state.operation!.phase = 'queued';
      expect(await h.run({ ...h.request, attempt: 2 })).toEqual({
        status: 'ignored',
      });
      expect(h.messages).toHaveLength(1);
    },
  );
  it('classifies thrown transport outcomes and invalid model metadata safely', async () => {
    const h = harness();
    h.controls.exception = true;
    expect(await h.run(h.request)).toEqual({
      status: 'failed',
      kind: 'outcome_unknown',
      retryable: false,
    });
    const bad = harness();
    bad.controls.wrongMetadata = true;
    expect(await bad.run(bad.request)).toEqual({
      status: 'failed',
      kind: 'invalid_response',
      retryable: false,
    });
  });
  it('rejects malformed and forged-citation proposals without storing partial drafts', async () => {
    const h = harness();
    h.modelValue.events[0].evidence[0].quote = '伪造的原话';
    expect(await h.run(h.request)).toEqual({
      status: 'failed',
      kind: 'invalid_response',
      retryable: false,
    });
    expect(h.state.saved).toEqual([]);
    const malformed = harness();
    Object.assign(malformed.modelValue, { forbiddenExtraField: 1 });
    expect(await malformed.run(malformed.request)).toEqual({
      status: 'failed',
      kind: 'invalid_response',
      retryable: false,
    });
  });
  it.each(['write', 'receipt', 'ledger'] as const)(
    'rolls back draft/identity/operation changes on %s failure without blind model resubmission',
    async (fault) => {
      const h = harness();
      if (fault === 'write') h.controls.persistFailure = true;
      if (fault === 'receipt') h.controls.corruptReceipt = true;
      if (fault === 'ledger') h.controls.invalidReservation = true;
      await expect(h.run(h.request)).rejects.toThrow();
      expect(h.state.saved).toEqual([]);
      expect(h.state.draftsByKey).toEqual({});
      expect(h.state.operation?.phase).toBe('running');
      expect(await h.run(h.request)).toEqual({ status: 'ignored' });
      expect(h.messages).toHaveLength(1);
    },
  );
  it.each([
    'missing-op',
    'op-id',
    'actor',
    'batch',
    'attempt',
    'running',
    'failed',
    'missing-snapshot',
    'snapshot-actor',
    'snapshot-input',
    'invalid-request',
  ] as const)('refuses invalid request/current state %s', async (fault) => {
    const h = harness();
    let request = h.request;
    if (fault === 'missing-op') h.state.operation = null;
    if (fault === 'op-id') request = { ...request, operationId: 'other' };
    if (fault === 'actor') request = { ...request, accountId: 'other' };
    if (fault === 'batch') request = { ...request, batchId: 'other' };
    if (fault === 'attempt') request = { ...request, attempt: 0 };
    if (fault === 'running') h.state.operation!.phase = 'running';
    if (fault === 'failed') h.state.operation!.phase = 'failed';
    if (fault === 'missing-snapshot') h.state.snapshot = null;
    if (fault === 'snapshot-actor') h.state.snapshot!.accountId = 'other';
    if (fault === 'snapshot-input') h.state.snapshot!.inputVersion = 'other';
    if (fault === 'invalid-request') request = { ...request, batchId: '' };
    expect((await h.run(request)).status).not.toBe('drafts');
    expect(h.messages).toEqual([]);
  });
  it('rechecks authorization, input and current revision before returning a cached result', async () => {
    for (const change of [
      'permission',
      'input',
      'revision',
      'missing-result',
    ] as const) {
      const h = harness();
      await h.run(h.request);
      if (change === 'permission')
        h.state.snapshot!.context.evaluationRelations[0].revokedAt =
          h.state.snapshot!.context.now;
      if (change === 'input')
        h.state.snapshot!.availableSources[0].text = '演示：新版本';
      if (change === 'revision') h.state.snapshot!.batchRevision++;
      if (change === 'missing-result') h.state.operation!.draftSet = null;
      expect((await h.run(h.request)).status).not.toBe('drafts');
      expect(h.messages).toHaveLength(1);
    }
  });
});
