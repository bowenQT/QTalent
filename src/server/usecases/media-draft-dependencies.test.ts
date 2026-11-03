import { expect, it } from 'vitest';
import { recordBatchDraftFixture } from '../../contracts/materials.fixtures';
import { arrangeOperationFingerprint } from '../modules/records/arrange/input-state/bind';
import {
  currentMediaDraftDependency,
  type MediaDraftDependencyFacts,
} from './media-draft-dependencies';

function fixture() {
  const draft = structuredClone(recordBatchDraftFixture);
  const command = {
    operationId: 'demo-bind',
    batchId: draft.batchId,
    itemId: 'demo-item',
    expectedRevision: 1,
    kind: 'unknown_person' as const,
    resolution: {
      action: 'bind_people' as const,
      personIds: [...draft.personIds],
    },
  };
  const at = new Date('2026-11-03T00:00:00Z');
  const facts: MediaDraftDependencyFacts = {
    dependency: {
      operationId: 'demo-op',
      itemId: 'demo-item',
      draftId: draft.draftId,
      draftRevision: 1,
    },
    material: {
      id: 'demo-material',
      inputId: 'demo-input',
      inputVersion: 'demo-input-v1',
      clientFileId: 'demo-file',
      uploadId: 'demo-upload',
      recordCollectionId: 'demo-collection',
      originalVersionId: draft.sourceReferences[0]!.originalVersionId,
      parseJobId: 'demo-parse-job',
      revision: 1,
      intakeScope: null,
      scopeAuditId: null,
      createdAt: at,
    },
    item: {
      id: 'demo-item',
      materialId: 'demo-material',
      kind: 'unknown_person',
      revision: 2,
      state: 'resolved',
      currentOperationId: 'demo-op',
      question: {
        itemId: 'demo-item',
        materialId: 'demo-material',
        batchId: draft.batchId,
        evaluationNodeId: draft.evaluationNodeId,
        originalVersionId: draft.sourceReferences[0]!.originalVersionId,
        revision: 1,
        state: 'pending',
        source: null,
        kind: 'unknown_person',
        observedName: null,
        candidates: [],
      },
    },
    operation: {
      id: 'demo-op',
      actorAccountId: 'demo-account',
      actorPersonId: 'demo-evaluator',
      operationId: command.operationId,
      fingerprint: arrangeOperationFingerprint(command),
      itemId: 'demo-item',
      materialId: 'demo-material',
      action: 'resolve',
      sourceOperationId: null,
      command,
      receipt: {
        batchId: draft.batchId,
        materialId: 'demo-material',
        itemId: 'demo-item',
        revision: 2,
        kind: 'unknown_person',
        resolution: command.resolution,
        remainingReviewItemIds: [],
        blockingReviewItemIds: [],
        invalidatedDraftIds: [],
        resume: { stage: 'organizing', jobId: 'demo-arrange-job' },
      },
      changes: [{ itemId: 'demo-item', previousRevision: 1, revision: 2 }],
      auditId: 'demo-audit',
      createdAt: at,
    },
    audit: {
      id: 'demo-audit',
      actorId: 'demo-account',
      action: 'material.review',
      resourceId: 'demo-material',
      metadata: null,
      at,
    },
  };
  return { draft, facts };
}
it('recognizes the exact current binding without treating it as a complete source-scope grant', () => {
  const { draft, facts } = fixture();
  // Initial scope is deliberately unknown: this helper checks attribution only.
  expect(facts.material.intakeScope).toBeNull();
  expect(currentMediaDraftDependency(draft, facts)).toBe(true);
  draft.revision = 3; // Human ledger advances do not alter binding provenance.
  expect(currentMediaDraftDependency(draft, facts)).toBe(true);
});
it('rejects the old draft after undo, and still rejects it after a new bind', () => {
  const { draft, facts } = fixture();
  facts.item.state = 'pending';
  facts.item.currentOperationId = 'demo-undo';
  facts.item.revision = 3;
  expect(currentMediaDraftDependency(draft, facts)).toBe(false);
  facts.item.state = 'resolved';
  facts.item.currentOperationId = 'demo-new-bind';
  facts.item.revision = 4;
  expect(currentMediaDraftDependency(draft, facts)).toBe(false);
});
it.each([
  'audit',
  'revision',
  'fingerprint',
  'source',
  'person',
  'receipt',
  'changes',
])(
  'rejects changed %s facts rather than trusting the dependency ID',
  (what) => {
    const { draft, facts } = fixture();
    if (what === 'audit') facts.audit.action = 'unrelated';
    if (what === 'revision') facts.dependency.draftRevision = 4;
    if (what === 'fingerprint') facts.operation.fingerprint = '0'.repeat(64);
    if (what === 'source') facts.material.originalVersionId = 'another-version';
    if (what === 'person') draft.personIds = ['another-person'];
    if (what === 'receipt') {
      if (!('revision' in facts.operation.receipt))
        throw new Error('Expected resolution fixture');
      facts.operation.receipt.revision = 9;
    }
    if (what === 'changes') facts.operation.changes = [];
    expect(currentMediaDraftDependency(draft, facts)).toBe(false);
  },
);
