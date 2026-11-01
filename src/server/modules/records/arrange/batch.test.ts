import { materialReviewItemsFixture } from '../../../../contracts/materials.fixtures';
import {
  materialReviewResolvedItemSchema,
  type MaterialReviewItem,
} from '../../../../contracts/material-review';
import { describe, expect, it } from 'vitest';
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
    occurredOn: '2026-10-30',
    project: { state: 'none' },
    reviewItems: [],
    resolvedItems: [],
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
      reviewItemIds: [],
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
describe('batch preparation uses actual899 source and node policy', () => {
  it('keeps exact text and freezes category/content/dimension/anchor facts without mutation', () => {
    const { snapshot, rules } = fixture();
    const original = structuredClone(snapshot);
    const result = prepareBatch(snapshot, rules);
    expect(result.status).toBe('ready');
    expect(snapshot).toEqual(original);
    if (result.status === 'ready')
      expect(result.value.sources[0].text).toBe('演示：补齐回滚步骤。');
  });
  it.each([
    'wrong-actor',
    'no-write',
    'cross-node',
    'expired',
    'revoked',
    'system-admin',
    'hidden-co-owner',
    'performance',
    'no-node',
  ] as const)('rejects %s before projection', (fault) => {
    const { snapshot: s, rules } = fixture();
    const source = s.availableSources[0];
    if (fault === 'wrong-actor') s.accountId = 'other';
    if (fault === 'no-write') s.writeAllowed = false;
    if (fault === 'cross-node') s.evaluationNodeId = 'other';
    if (fault === 'expired')
      s.context.evaluationRelations[0].validTo = s.context.now;
    if (fault === 'revoked')
      s.context.evaluationRelations[0].revokedAt = s.context.now;
    if (fault === 'system-admin') s.context.account.isSystemAdmin = true;
    if (fault === 'hidden-co-owner')
      source.subjects.push({
        personId: 'demo-hidden',
        cohortId: 'demo-cohort',
        evaluationNodeId: 'demo-node',
      });
    if (fault === 'performance') source.requiredKinds = ['performance'];
    if (fault === 'no-node') source.subjects[0].evaluationNodeId = null;
    expect(prepareBatch(s, rules).status).toBe('not_found');
  });
  it.each([
    'no-people',
    'unresolved-identity',
    'unresolved-scope',
    'unbound-offline',
  ] as const)('keeps %s outside the model', (fault) => {
    const { snapshot: s, rules } = fixture();
    if (fault === 'no-people') s.personIds = [];
    if (fault === 'unresolved-identity') s.identities = 'unresolved';
    if (fault === 'unresolved-scope')
      s.availableSources[0].scope = 'unresolved';
    if (fault === 'unbound-offline')
      s.availableSources[0].acquisition = {
        kind: 'offline_transcript',
        recordingId: 'demo-r',
        transcriptVersionId: 'demo-t',
        bindingRevision: 1,
        binding: 'unresolved',
      };
    expect(prepareBatch(s, rules).status).toBe('needs_review');
  });
  it.each([
    'missing',
    'duplicate',
    'wrong-locator',
    'empty-text',
    'incomplete',
    'unattributed',
    'empty-version',
    'unparsed',
    'raw-recording',
  ] as const)('refuses invalid source %s', (fault) => {
    const { snapshot: s, rules } = fixture();
    const source = s.availableSources[0];
    if (fault === 'missing') s.availableSources = [];
    if (fault === 'duplicate') s.availableSources.push(structuredClone(source));
    if (fault === 'wrong-locator')
      source.reference = {
        ...source.reference,
        location: { kind: 'document', paragraph: 'other' },
      };
    if (fault === 'empty-text') source.text = ' ';
    if (fault === 'incomplete') source.complete = false;
    if (fault === 'unattributed') source.attributedPersonIds = ['other'];
    if (fault === 'empty-version')
      source.acquisition = { kind: 'text', version: '' };
    if (fault === 'unparsed')
      source.acquisition = { kind: 'parsed_attachment', parseVersionId: '' };
    if (fault === 'raw-recording')
      source.reference.location = { kind: 'recording', startMs: 1, endMs: 2 };
    expect(prepareBatch(s, rules).status).not.toBe('ready');
  });
  it('requires genuine offline version/binding facts and accepts parsed Office locators after binding', () => {
    const { snapshot: s, rules } = fixture();
    const source = s.availableSources[0];
    source.reference.location = { kind: 'recording', startMs: 0, endMs: 2000 };
    source.acquisition = {
      kind: 'offline_transcript',
      recordingId: 'demo-r',
      transcriptVersionId: 'demo-t',
      bindingRevision: 2,
      binding: 'resolved',
    };
    expect(prepareBatch(s, rules).status).toBe('ready');
    source.acquisition.bindingRevision = 0;
    expect(prepareBatch(s, rules).status).toBe('not_ready');
    source.acquisition = {
      kind: 'parsed_attachment',
      parseVersionId: 'demo-parse-v1',
    };
    source.reference.location = { kind: 'presentation', slide: 2 };
    expect(prepareBatch(s, rules).status).toBe('ready');
    source.reference.location = {
      kind: 'spreadsheet',
      sheet: '演示',
      cell: 'A3',
    };
    expect(prepareBatch(s, rules).status).toBe('ready');
  });
  it('requires behavior attribution and filters hidden ownership before exposing review or material status', () => {
    const { snapshot: s, rules } = fixture();
    const source = s.availableSources[0];
    source.attributedPersonIds = [];
    expect(prepareBatch(s, rules)).toEqual({
      status: 'needs_review',
      reason: 'identity_unresolved',
    });
    source.subjects.push({
      personId: 'demo-hidden',
      cohortId: null,
      evaluationNodeId: 'demo-node',
    });
    source.scope = 'unresolved';
    source.category = 'historical_evaluation';
    expect(prepareBatch(s, rules)).toEqual({ status: 'not_found' });
  });
  it.each(['historical', 'code', 'image', 'video'] as const)(
    'keeps %s material out of this scoring phase',
    (kind) => {
      const { snapshot: s, rules } = fixture();
      const source = s.availableSources[0];
      if (kind === 'historical') source.category = 'historical_evaluation';
      if (kind === 'code') source.category = 'submitted_code_snapshot';
      if (kind === 'image')
        source.reference.location = {
          kind: 'image',
          region: { left: 0, top: 0, right: 1, bottom: 1 },
        };
      if (kind === 'video')
        source.reference.location = { kind: 'video', startMs: 0, endMs: 1 };
      expect(prepareBatch(s, rules)).toEqual({
        status: 'not_ready',
        reason: 'unsupported_material',
      });
    },
  );
  it.each([
    'wrong-category',
    'wrong-content',
    'before',
    'expired',
    'unknown-anchor-version',
    'unknown-dimension',
    'duplicate-anchor',
    'invalid-score',
    'empty-dimensions',
  ] as const)('does not fall back from bad rubric facts %s', (fault) => {
    const { snapshot, rules: r } = fixture();
    if (fault === 'wrong-category')
      r.effective = {
        ...r.effective,
        category: 'xe_selection',
        versionId: 'xe-select-v1',
      };
    if (fault === 'wrong-content') r.contentVersionId = 'rubric-v2';
    if (fault === 'before')
      r.effective.effectiveFrom = '2026-11-01T00:00:00.000Z';
    if (fault === 'expired') r.effective.effectiveUntil = snapshot.boundAt;
    if (fault === 'unknown-anchor-version') r.anchors[0].versionId = 'other';
    if (fault === 'unknown-dimension') r.anchors[0].dimensionId = 'other';
    if (fault === 'duplicate-anchor') r.anchors.push(r.anchors[0]);
    if (fault === 'invalid-score') r.anchors[0].value = 0;
    if (fault === 'empty-dimensions') r.dimensions = [];
    expect(prepareBatch(snapshot, r)).toEqual({
      status: 'not_ready',
      reason: 'rules_unavailable',
    });
  });
  it('keeps historical binding stable after later publication closes the old effective interval', () => {
    const { snapshot, rules } = fixture();
    const a = prepareBatch(snapshot, rules);
    rules.effective.effectiveUntil = '2026-11-01T00:00:00.000Z';
    const b = prepareBatch(snapshot, rules);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    if (a.status === 'ready' && b.status === 'ready')
      expect(a.value.fingerprint).toBe(b.value.fingerprint);
  });
  it('normalizes equivalent person and manifest order without changing the input fingerprint', () => {
    const { snapshot: s, rules } = fixture();
    const secondPerson = 'demo-person-two';
    s.personIds.push(secondPerson);
    s.context.people.push({ id: secondPerson, noReview: false });
    s.context.evaluationNodeSubjects.push({
      evaluationNodeId: s.evaluationNodeId,
      personId: secondPerson,
    });
    s.context.evaluationRelations.push({
      ...s.context.evaluationRelations[0],
      id: 'demo-rel-two',
      personId: secondPerson,
    });
    s.availableSources[0].text += '另一次检查边界。';
    s.generation = {
      kind: 'revise',
      events: [
        {
          eventKey: 'proposal-a',
          draftId: 'opaque-1',
          witnesses: [
            { reference: s.requestedSources[0], quote: '补齐回滚步骤' },
          ],
        },
        {
          eventKey: 'proposal-b',
          draftId: 'opaque-2',
          witnesses: [{ reference: s.requestedSources[0], quote: '检查边界' }],
        },
      ],
    };
    const a = prepareBatch(s, rules);
    s.personIds.reverse();
    s.generation.events.reverse();
    const b = prepareBatch(s, rules);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    if (a.status === 'ready' && b.status === 'ready')
      expect(a.value.fingerprint).toBe(b.value.fingerprint);
  });
  it('requires distinguishable, authorized event witnesses before regeneration', () => {
    for (const fault of [
      'empty',
      'foreign',
      'ambiguous',
      'duplicate-id',
    ] as const) {
      const { snapshot: s, rules } = fixture();
      const witness = {
        reference: s.requestedSources[0],
        quote: '补齐回滚步骤',
      };
      s.generation = {
        kind: 'revise',
        events: [{ eventKey: 'a', draftId: 'opaque-1', witnesses: [witness] }],
      };
      if (fault === 'empty') s.generation.events[0].witnesses = [];
      if (fault === 'foreign')
        s.generation.events[0].witnesses = [{ ...witness, quote: '无出处' }];
      if (fault === 'ambiguous')
        s.generation.events.push({
          eventKey: 'b',
          draftId: 'opaque-2',
          witnesses: [witness],
        });
      if (fault === 'duplicate-id')
        s.generation.events.push({
          eventKey: 'b',
          draftId: 'opaque-1',
          witnesses: [witness],
        });
      expect(prepareBatch(s, rules)).toEqual({
        status: 'not_ready',
        reason: 'invalid_input',
      });
    }
    const { snapshot: s, rules } = fixture();
    s.availableSources[0].text = 'a'.repeat(262145);
    expect(prepareBatch(s, rules)).toEqual({
      status: 'not_ready',
      reason: 'invalid_input',
    });
  });
  it.each([
    'bad-id',
    'bad-time',
    'bad-revision',
    'duplicate-person',
    'empty-request',
    'duplicate-request',
    'bad-locator',
    'bad-revise-manifest',
  ] as const)('validates server snapshot %s', (fault) => {
    const { snapshot: s, rules } = fixture();
    if (fault === 'bad-id') s.batchId = '';
    if (fault === 'bad-time') s.boundAt = 'not-time';
    if (fault === 'bad-revision') s.batchRevision = 0;
    if (fault === 'duplicate-person') s.personIds.push(s.personIds[0]);
    if (fault === 'empty-request') s.requestedSources = [];
    if (fault === 'duplicate-request')
      s.requestedSources.push(s.requestedSources[0]);
    if (fault === 'bad-locator')
      s.requestedSources[0].location = {
        kind: 'recording',
        startMs: 0,
        endMs: 0,
      };
    if (fault === 'bad-revise-manifest')
      s.generation = { kind: 'revise', events: [] };
    expect(prepareBatch(s, rules)).toEqual({
      status: 'not_ready',
      reason: 'invalid_input',
    });
  });
});

function reviewFixture(kind: MaterialReviewItem['kind']) {
  const result = fixture();
  const item = structuredClone(
    materialReviewItemsFixture.find((entry) => entry.kind === kind)!,
  );
  const source = result.snapshot.availableSources[0];
  source.reference = item.source ?? {
    ...source.reference,
    originalVersionId: item.originalVersionId,
  };
  result.snapshot.requestedSources = [source.reference];
  source.reviewItemIds = [item.itemId];
  source.acquisition =
    source.reference.location.kind === 'recording'
      ? {
          kind: 'offline_transcript',
          recordingId: 'demo-recording',
          transcriptVersionId: 'demo-transcript',
          bindingRevision: 1,
          binding: 'resolved',
        }
      : source.reference.location.kind === 'document'
        ? { kind: 'text', version: 'demo-text' }
        : { kind: 'parsed_attachment', parseVersionId: 'demo-parse' };
  result.snapshot.reviewItems = [item];
  return result;
}
describe('final897 selected-fragment review, project and source-date facts', () => {
  it.each(materialReviewItemsFixture.map((item) => item.kind))(
    'blocks the actual %s dependency before model preparation',
    (kind) => {
      const { snapshot, rules } = reviewFixture(kind);
      expect(prepareBatch(snapshot, rules)).toEqual({
        status: 'needs_review',
        reason: kind,
      });
    },
  );
  it('does not block a known fragment merely because the batch has another pending target', () => {
    const { snapshot, rules } = reviewFixture('unknown_person');
    snapshot.availableSources[0].reviewItemIds = [];
    expect(prepareBatch(snapshot, rules).status).toBe('ready');
  });
  it('requires an explicit native dependency result rather than assuming an empty list', () => {
    const { snapshot, rules } = fixture();
    snapshot.availableSources[0].reviewItemIds = null;
    expect(prepareBatch(snapshot, rules)).toEqual({
      status: 'not_ready',
      reason: 'source_unavailable',
    });
    snapshot.availableSources[0].reviewItemIds = ['demo-not-loaded'];
    expect(prepareBatch(snapshot, rules)).toEqual({
      status: 'not_ready',
      reason: 'invalid_input',
    });
  });
  it('retained original content is excluded only for the declared affected fragment', () => {
    const { snapshot, rules } = reviewFixture('unknown_person');
    const item = snapshot.reviewItems[0];
    if (item.kind !== 'unknown_person') throw new Error('fixture');
    snapshot.resolvedItems = [
      materialReviewResolvedItemSchema.parse({
        itemId: item.itemId,
        batchId: item.batchId,
        evaluationNodeId: item.evaluationNodeId,
        materialId: item.materialId,
        originalVersionId: item.originalVersionId,
        source: item.source,
        kind: item.kind,
        revision: 2,
        state: 'resolved',
        observedName: item.observedName,
        resolution: { action: 'keep_original_only' },
        resolvedAt: '2026-11-01T00:00:00Z',
        auditId: 'demo-audit',
        undo: { status: 'available' },
      }),
    ];
    snapshot.reviewItems = [];
    expect(prepareBatch(snapshot, rules)).toEqual({
      status: 'not_ready',
      reason: 'retained_material',
    });
    snapshot.availableSources[0].reviewItemIds = [];
    expect(prepareBatch(snapshot, rules).status).toBe('ready');
  });
  it('checks later hidden sources before revealing an earlier visible source status', () => {
    const { snapshot, rules } = fixture();
    snapshot.availableSources[0].scope = 'unresolved';
    const hidden = structuredClone(snapshot.availableSources[0]);
    hidden.reference.fragmentId = 'demo-hidden-fragment';
    hidden.subjects[0].personId = 'demo-hidden-person';
    hidden.attributedPersonIds = ['demo-hidden-person'];
    snapshot.availableSources.push(hidden);
    snapshot.requestedSources.push(hidden.reference);
    expect(prepareBatch(snapshot, rules)).toEqual({ status: 'not_found' });
  });
  it('does not invent a project or use an inaccessible project', () => {
    const { snapshot, rules } = fixture();
    snapshot.project = { state: 'unresolved' };
    expect(prepareBatch(snapshot, rules)).toEqual({
      status: 'needs_review',
      reason: 'unknown_project',
    });
    snapshot.project = { state: 'resolved', id: 'demo-hidden-project' };
    expect(prepareBatch(snapshot, rules)).toEqual({ status: 'not_found' });
  });
  it('keeps the source date distinct from rule binding time in the immutable fingerprint', () => {
    const { snapshot, rules } = fixture();
    const before = prepareBatch(snapshot, rules);
    snapshot.occurredOn = '2026-10-29';
    const after = prepareBatch(snapshot, rules);
    if (before.status !== 'ready' || after.status !== 'ready')
      throw new Error('fixture');
    expect(after.value.snapshot.boundAt).toBe('2026-10-31T12:00:00.000Z');
    expect(after.value.fingerprint).not.toBe(before.value.fingerprint);
    snapshot.occurredOn = '2026-02-30';
    expect(prepareBatch(snapshot, rules)).toEqual({
      status: 'not_ready',
      reason: 'invalid_input',
    });
  });
});
