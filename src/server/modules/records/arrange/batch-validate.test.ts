import { describe, expect, it } from 'vitest';
import type { BatchIdentityLedger, PreparedBatch } from './batch';
import type { ModelBatch } from './batch-prompt';
import {
  materializeBatch,
  validateBatchModel,
  type ValidatedBatch,
} from './batch-validate';
import {
  prepareBatch,
  type BatchSnapshot,
  type BatchRuleBundle,
} from './batch';
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
function prepared() {
  const { snapshot, rules } = fixture();
  const p = prepareBatch(snapshot, rules);
  if (p.status !== 'ready') throw new Error('fixture');
  return p.value;
}
function model(p: PreparedBatch): ModelBatch {
  const q = {
    reference: structuredClone(p.sources[0].reference),
    quote: '补齐回滚步骤',
  };
  return {
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
}
function ledger(p: PreparedBatch, plan: ValidatedBatch): BatchIdentityLedger {
  const assigned: Record<string, string> = {
    'proposal-a': 'server-opaque-7f3',
    'proposal-b': 'server-opaque-9d2',
    'proposal-c': 'server-opaque-1a8',
  };
  return {
    expectedBatchRevision: p.snapshot.batchRevision,
    drafts: plan.events.map((e) => ({
      eventKey: e.eventKey,
      draftId: assigned[e.eventKey],
      previous: null,
    })),
    candidates: plan.groups.map((g) => ({
      key: g.key,
      candidateId: 'server-candidate-6b1',
    })),
  };
}
describe('batch output and server ledger validation', () => {
  it('preserves two events for one person and unions multiple corroborating sources in one event', () => {
    const p = prepared();
    p.sources[0].text += '另一次检查边界。';
    const second = structuredClone(p.sources[0]);
    second.reference.fragmentId = 'demo-second';
    second.text = '演示：补齐回滚步骤。';
    p.sources.push(second);
    const raw = model(p);
    raw.events[0].evidence.push(
      { reference: second.reference, quote: '补齐回滚步骤' },
      raw.events[0].evidence[0],
    );
    raw.events.push({
      ...structuredClone(raw.events[0]),
      eventKey: 'proposal-b',
      sbi: {
        title: '演示：另一件事',
        situation: '',
        behavior: '检查边界',
        impact: '',
      },
      evidence: [{ reference: p.sources[0].reference, quote: '检查边界' }],
      scores: [],
    });
    const plan = validateBatchModel(p, raw);
    const result = materializeBatch(p, plan, ledger(p, plan));
    expect(result.drafts.map((d) => d.draftId)).toEqual([
      'server-opaque-7f3',
      'server-opaque-9d2',
    ]);
    expect(result.drafts[0].sourceReferences).toHaveLength(2);
    expect(result.drafts).toHaveLength(2);
    expect(result.duplicateCandidates).toEqual([]);
    expect(result.drafts[0]).toMatchObject({
      origin: 'ai_suggestion',
      dimensionVersionId: 'demo-dimension-v1',
      anchorVersionId: 'demo-anchor-v1',
      revision: 1,
    });
  });
  it.each([
    'forged-evidence',
    'wrong-version',
    'wrong-locator',
    'unknown-person',
    'duplicate-event',
    'unknown-dimension',
    'duplicate-score',
    'bad-shape',
  ] as const)('rejects %s without creating a draft plan', (fault) => {
    const p = prepared();
    const raw = model(p);
    if (fault === 'forged-evidence')
      raw.events[0].evidence[0].quote = '不存在的行为';
    if (fault === 'wrong-version')
      raw.events[0].evidence[0].reference.originalVersionId = 'other';
    if (fault === 'wrong-locator')
      raw.events[0].evidence[0].reference.location = {
        kind: 'document',
        paragraph: 'other',
      };
    if (fault === 'unknown-person') raw.events[0].personIds = ['other'];
    if (fault === 'duplicate-event')
      raw.events.push(structuredClone(raw.events[0]));
    if (fault === 'unknown-dimension')
      raw.events[0].scores[0].dimensionId = 'other';
    if (fault === 'duplicate-score')
      raw.events[0].scores.push(structuredClone(raw.events[0].scores[0]));
    expect(() =>
      validateBatchModel(p, fault === 'bad-shape' ? null : raw),
    ).toThrow('invalid_response');
  });
  it.each([
    'anchor',
    'quote',
    'attribution',
    'outside-event-source',
    'other-event-same-fragment',
  ] as const)(
    'downgrades an invalid %s suggestion to unknown without score/citation residue',
    (fault) => {
      const p = prepared();
      const raw = model(p);
      const score = raw.events[0].scores[0];
      if (score.state !== 'suggested') throw new Error('fixture');
      // Separate score citation object from the narrative evidence object.
      score.citations = structuredClone(score.citations);
      if (fault === 'anchor') score.anchor.ruleVersion = 'unpublished';
      if (fault === 'quote') score.citations[0].quote = '伪造引用';
      if (fault === 'attribution') {
        p.sources.push({
          ...structuredClone(p.sources[0]),
          reference: { ...p.sources[0].reference, fragmentId: 'other-author' },
          attributedPersonIds: [],
        });
        score.citations[0].reference = p.sources[1].reference;
        raw.events[0].evidence.push({
          reference: p.sources[1].reference,
          quote: '补齐回滚步骤',
        });
      }
      if (fault === 'outside-event-source') {
        p.sources.push({
          ...structuredClone(p.sources[0]),
          reference: { ...p.sources[0].reference, fragmentId: 'other-source' },
        });
        score.citations[0].reference = p.sources[1].reference;
      }
      if (fault === 'other-event-same-fragment') {
        p.sources[0].text += '检查边界。';
        score.citations[0].quote = '检查边界';
      }
      const plan = validateBatchModel(p, raw);
      expect(plan.events[0].scores[0]).toMatchObject({ state: 'unknown' });
      expect(plan.events[0].scores[0]).not.toHaveProperty('value');
      expect(plan.events[0].scores[0]).not.toHaveProperty('citations');
    },
  );
  it('unions overlapping uncertain groups, keeps all events, and rejects foreign group membership', () => {
    const p = prepared();
    const raw = model(p);
    raw.events.push(
      { ...structuredClone(raw.events[0]), eventKey: 'proposal-b' },
      { ...structuredClone(raw.events[0]), eventKey: 'proposal-c' },
    );
    raw.similarGroups = [
      { eventKeys: ['proposal-a', 'proposal-b'], reason: '同一线索待人确认' },
      { eventKeys: ['proposal-b', 'proposal-c'], reason: '可能相关' },
    ];
    const plan = validateBatchModel(p, raw);
    expect(plan.groups).toHaveLength(1);
    const result = materializeBatch(p, plan, ledger(p, plan));
    expect(result.drafts).toHaveLength(3);
    expect(result.duplicateCandidates[0].draftIds).toHaveLength(3);
    raw.similarGroups[0].eventKeys.push('outside');
    expect(() => validateBatchModel(p, raw)).toThrow('invalid_response');
  });
  it('does not let exact duplicate suggestions bypass the human duplicate choice', () => {
    const p = prepared();
    const raw = model(p);
    raw.events.push({
      ...structuredClone(raw.events[0]),
      eventKey: 'proposal-b',
    });
    const plan = validateBatchModel(p, raw);
    expect(plan.groups).toHaveLength(1);
    const result = materializeBatch(p, plan, ledger(p, plan));
    expect(result.duplicateCandidates[0].draftIds).toEqual([
      'server-opaque-7f3',
      'server-opaque-9d2',
    ]);
  });
  it('detects exact duplicates despite nested citation order or repeated evidence', () => {
    const p = prepared();
    p.sources[0].text += '检查边界。';
    const raw = model(p);
    const second = {
      reference: structuredClone(p.sources[0].reference),
      quote: '检查边界',
    };
    raw.events[0].evidence.push(second);
    const score = raw.events[0].scores[0];
    if (score.state !== 'suggested') throw new Error('fixture');
    score.citations.push(second);
    const copy = structuredClone(raw.events[0]);
    copy.eventKey = 'proposal-b';
    copy.evidence.reverse();
    copy.evidence.push(copy.evidence[0]);
    const copiedScore = copy.scores[0];
    if (copiedScore.state !== 'suggested') throw new Error('fixture');
    copiedScore.citations.reverse();
    raw.events.push(copy);
    expect(validateBatchModel(p, raw).groups).toHaveLength(1);
  });
  it('does not treat a different AI score or paraphrased title as proof of a separate event', () => {
    const p = prepared();
    const raw = model(p);
    const copy = structuredClone(raw.events[0]);
    copy.eventKey = 'proposal-b';
    copy.sbi.title = '演示：同一行为的另一种概括';
    copy.scores = [
      {
        state: 'unknown',
        personId: 'demo-person',
        dimensionId: 'demo-dimension',
        reason: '资料不足',
      },
    ];
    raw.events.push(copy);
    const plan = validateBatchModel(p, raw);
    expect(plan.events).toHaveLength(2);
    expect(plan.groups).toHaveLength(1);
  });
  it('does not score a revised event using another event exclusive witness in the same fragment', () => {
    const p = prepared();
    p.sources[0].text += '检查边界。';
    const raw = model(p);
    const own = {
      reference: structuredClone(p.sources[0].reference),
      quote: '演示：补齐回滚步骤。检查边界。',
    };
    const other = {
      reference: structuredClone(p.sources[0].reference),
      quote: '检查边界',
    };
    raw.events[0].evidence = [own];
    const score = raw.events[0].scores[0];
    if (score.state !== 'suggested') throw new Error('fixture');
    score.citations = [other];
    raw.events.push({
      ...structuredClone(raw.events[0]),
      eventKey: 'proposal-b',
      evidence: [other],
      scores: [],
    });
    p.snapshot.generation = {
      kind: 'revise',
      events: [
        {
          eventKey: 'proposal-a',
          draftId: 'server-opaque-7f3',
          witnesses: [own],
        },
        {
          eventKey: 'proposal-b',
          draftId: 'server-opaque-9d2',
          witnesses: [other],
        },
      ],
    };
    expect(validateBatchModel(p, raw).events[0].scores[0]).toMatchObject({
      state: 'unknown',
    });
  });
  it('rejects swapping two event witnesses under otherwise valid stable keys', () => {
    const p = prepared();
    p.sources[0].text += '另一次检查边界。';
    const raw = model(p);
    raw.events.push({
      ...structuredClone(raw.events[0]),
      eventKey: 'proposal-b',
      evidence: [
        {
          reference: structuredClone(p.sources[0].reference),
          quote: '检查边界',
        },
      ],
      scores: [],
    });
    p.snapshot.generation = {
      kind: 'revise',
      events: [
        {
          eventKey: 'proposal-a',
          draftId: 'server-opaque-7f3',
          witnesses: structuredClone(raw.events[0].evidence),
        },
        {
          eventKey: 'proposal-b',
          draftId: 'server-opaque-9d2',
          witnesses: structuredClone(raw.events[1].evidence),
        },
      ],
    };
    expect(validateBatchModel(p, raw).events).toHaveLength(2);
    const [a, b] = raw.events;
    a.evidence = structuredClone(p.snapshot.generation.events[1].witnesses);
    b.evidence = structuredClone(p.snapshot.generation.events[0].witnesses);
    expect(() => validateBatchModel(p, raw)).toThrow('invalid_response');
    a.evidence = [
      ...p.snapshot.generation.events[0].witnesses,
      ...p.snapshot.generation.events[1].witnesses,
    ];
    expect(() => validateBatchModel(p, raw)).toThrow('invalid_response');
  });
  it('keeps server IDs across regeneration, increments only changed draft content, and requires a complete stored manifest', () => {
    const p = prepared();
    const raw = model(p);
    const plan = validateBatchModel(p, raw);
    const first = materializeBatch(p, plan, ledger(p, plan));
    p.snapshot.generation = {
      kind: 'revise',
      events: [
        {
          eventKey: 'proposal-a',
          draftId: first.drafts[0].draftId,
          witnesses: raw.events[0].evidence,
        },
      ],
    };
    p.snapshot.batchRevision = first.revision;
    const reservation = ledger(p, plan);
    reservation.drafts[0].previous = first.drafts[0];
    expect(materializeBatch(p, plan, reservation).drafts[0]).toEqual(
      first.drafts[0],
    );
    raw.events[0].sbi.title = '演示：补充标题';
    const updated = materializeBatch(
      p,
      validateBatchModel(p, raw),
      reservation,
    );
    expect(updated.drafts[0].draftId).toBe(first.drafts[0].draftId);
    expect(updated.drafts[0].revision).toBe(2);
    raw.events[0].eventKey = 'renamed';
    expect(() => validateBatchModel(p, raw)).toThrow('invalid_response');
  });
  it.each([
    'revision',
    'missing-slot',
    'missing-id',
    'wrong-key',
    'duplicate-id',
    'previous-batch',
    'previous-node',
    'previous-id',
    'missing-previous',
    'candidate-key',
    'candidate-id',
  ] as const)('refuses invalid server ledger %s', (fault) => {
    const p = prepared();
    const raw = model(p);
    raw.events.push({
      ...structuredClone(raw.events[0]),
      eventKey: 'proposal-b',
    });
    raw.similarGroups = [
      { eventKeys: ['proposal-a', 'proposal-b'], reason: '演示待确认' },
    ];
    const plan = validateBatchModel(p, raw);
    const r = ledger(p, plan);
    const first = materializeBatch(p, plan, r);
    if (fault === 'revision') r.expectedBatchRevision++;
    if (fault === 'missing-slot') r.drafts.pop();
    if (fault === 'missing-id') r.drafts[0].draftId = '';
    if (fault === 'wrong-key') r.drafts[0].eventKey = 'other';
    if (fault === 'duplicate-id') r.drafts[1].draftId = r.drafts[0].draftId;
    if (fault.startsWith('previous')) {
      r.drafts[0].previous = structuredClone(first.drafts[0]);
      if (fault === 'previous-batch') r.drafts[0].previous.batchId = 'other';
      if (fault === 'previous-node')
        r.drafts[0].previous.evaluationNodeId = 'other';
      if (fault === 'previous-id') r.drafts[0].previous.draftId = 'other';
    }
    if (fault === 'missing-previous')
      p.snapshot.generation = {
        kind: 'revise',
        events: first.drafts.map((d, i) => ({
          eventKey: raw.events[i].eventKey,
          draftId: d.draftId,
          witnesses: raw.events[i].evidence,
        })),
      };
    if (fault === 'candidate-key') r.candidates[0].key = 'other';
    if (fault === 'candidate-id') r.candidates[0].candidateId = '';
    expect(() => materializeBatch(p, plan, r)).toThrow('invalid_ledger');
  });
});
