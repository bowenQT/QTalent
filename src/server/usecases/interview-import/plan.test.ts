import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseInterviewReviewPdf } from '../../modules/records/attachments/interview-review/parser';
import type { InterviewReviewResult } from '../../modules/records/attachments/interview-review/types';
import { materialSourcesFixture } from '../../../contracts/materials.fixtures';
import {
  materialReviewItemSchema,
  materialReviewResolvedItemSchema,
  materialReviewResolutionReceiptSchema,
} from '../../../contracts/material-review';
import {
  projectInterviewReviewState,
  consumeInterviewUndoReceipt,
} from './review-state';
import { materialSourceSchema } from '../../../contracts/sources';
import directoryFixture from '../../../../tests/fixtures/bow-896/directory.json';
import candidateFixture from '../../../../tests/fixtures/bow-896/candidates.json';
import { planInterviewImport, type InterviewImportFacts } from './plan';

const parsed = new Map<string, InterviewReviewResult>();
const files = [
  'campus',
  'hr',
  'professional',
  'unknown-template',
  'score-missing',
  'score-multiple',
  'unknown-interviewer',
  'professional-duplicate',
];
beforeAll(async () => {
  // Only repository-owned synthetic PDFs. This is not an untrusted upload entry.
  for (const file of files) {
    parsed.set(
      file,
      await parseInterviewReviewPdf(
        await readFile(`tests/fixtures/bow-896/interview/${file}.pdf`),
        { positionKind: 'non_management', allowSyntheticDemo: true },
      ),
    );
  }
}, 20000);
function result(file = 'professional') {
  const value = parsed.get(file);
  if (!value) throw new Error('Synthetic parser fixture was not loaded');
  return structuredClone(value);
}
function review(file = 'professional') {
  const value = result(file);
  if (value.status === 'rejected') throw new Error(value.reason);
  return value.reviews[0];
}
function facts(file = 'professional'): InterviewImportFacts {
  const people = directoryFixture.people.map(({ id, displayName }) => ({
    id,
    name: displayName,
  }));
  const candidate = candidateFixture.rows[0];
  return {
    context: {
      now: '2026-10-31T12:00:00Z',
      account: {
        id: 'demo-hr-account',
        personId: 'p-suwan',
        isSystemAdmin: false,
      },
      grants: [
        {
          accountId: 'demo-hr-account',
          role: 'hr',
          scope: 'cohort',
          cohortId: 'demo-hiring',
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      people: people.map(({ id }) => ({ id, noReview: false })),
      enrollments: [
        {
          cohortId: 'demo-hiring',
          personId: 'p-x08',
          confirmed: true,
          validFrom: '2026-01-01',
          validTo: null,
          revokedAt: null,
        },
      ],
      assignments: [],
      projects: [],
      members: [],
      evaluationNodes: [
        { id: 'demo-interview-node', kind: 'interview', cohortId: null },
      ],
      evaluationNodeSubjects: [
        { evaluationNodeId: 'demo-interview-node', personId: 'p-x08' },
      ],
      evaluationRelations: [],
    },
    batchId: 'demo-import-batch',
    rowId: 'demo-import-row',
    evaluationNodeId: 'demo-interview-node',
    originalVersionId: 'demo-pdf-v1',
    materialId: 'demo-pdf-material',
    parsed: result(file),
    reviewIndex: 0,
    // Explicit synthetic post-adapter facts, absent from the real 900 DTO.
    // This job code is invented here, never inferred from an official template.
    observedIdentity: { name: candidate.name, positionCode: 'DEMO-JOB-01' },
    candidates: [
      {
        candidateId: candidate.candidateId,
        personId: candidate.directoryPersonId,
        name: candidate.name,
        positionCode: 'DEMO-JOB-01',
        interviewTime: review().metadata.interviewTime!.value,
        status: 'hired',
      },
    ],
    confirmedCandidateId: candidate.candidateId,
    confirmedForRowRevision: 1,
    confirmedInterviewerId: file === 'unknown-interviewer' ? null : 'p-yeqing',
    directory: people,
    employments: [
      { personId: 'p-x08', validFrom: '2026-01-01', validTo: null },
    ],
    // This is a separate 897 synthetic canonical source, not a bbox conversion
    // or evidence that the PDFs above have been persisted/cited in production.
    source: structuredClone(materialSourcesFixture[1]),
    existing: [],
    rowSnapshot: {
      batchId: 'demo-import-batch',
      rowId: 'demo-import-row',
      evaluationNodeId: 'demo-interview-node',
      materialId: 'demo-pdf-material',
      originalVersionId: 'demo-pdf-v1',
      revision: 1,
      actorAccountId: 'demo-hr-account',
      hrCohortId: 'demo-hiring',
      access: 'allowed',
      subjectPersonIds: ['p-x08'],
      hasHiddenContent: false,
      blockingReviewItemIds: [],
      import: { state: 'unimported' },
    },
    pendingCandidate: null,
    candidateResolution: null,
    resolvedCandidate: null,
    resolvedInterviewer: null,
    pendingInterviewer: null,
    resolution: null,
  };
}
function planned(input = facts()) {
  const value = planInterviewImport(input);
  expect(value.status).toBe('planned');
  if (value.status !== 'planned') throw new Error(JSON.stringify(value));
  return value;
}
function candidateHeld(input: InterviewImportFacts) {
  const value = planInterviewImport(input);
  expect(value).toMatchObject({
    status: 'needs_review',
    item: { kind: 'unknown_interview_candidate', importRowId: input.rowId },
    resume: null,
  });
  if (value.status !== 'needs_review') throw new Error('candidate fixture');
  expect(materialReviewItemSchema.safeParse(value.item).success).toBe(true);
  expect(value).not.toHaveProperty('originalReview');
  return value;
}
function pending() {
  const input = facts('unknown-interviewer');
  const value = planInterviewImport(input);
  expect(value.status).toBe('needs_review');
  if (value.status !== 'needs_review') throw new Error(JSON.stringify(value));
  return { input, value };
}
function resumeFacts() {
  const { input, value } = pending();
  input.pendingInterviewer = value.item;
  input.resolution = {
    operationId: 'demo-resolve-operation',
    batchId: input.batchId,
    itemId: value.item.itemId,
    expectedRevision: value.item.revision,
    kind: 'unknown_interviewer',
    resolution: { action: 'link_existing_interviewer', personId: 'p-yeqing' },
  };
  const item = value.item;
  if (item.kind !== 'unknown_interviewer') throw new Error('fixture');
  input.resolvedInterviewer = {
    rowRevision: 1,
    item: {
      itemId: item.itemId,
      batchId: item.batchId,
      evaluationNodeId: item.evaluationNodeId,
      materialId: item.materialId,
      originalVersionId: item.originalVersionId,
      source: item.source,
      kind: item.kind,
      importRowId: item.importRowId,
      observedName: item.observedName,
      state: 'resolved',
      revision: item.revision + 1,
      resolvedAt: '2026-10-31T11:59:00Z',
      auditId: 'demo-real-ledger-audit',
      undo: { status: 'available' },
      resolution: { action: 'link_existing_interviewer', personId: 'p-yeqing' },
    },
    receipt: {
      kind: 'unknown_interviewer',
      batchId: item.batchId,
      materialId: item.materialId,
      itemId: item.itemId,
      revision: item.revision + 1,
      resolution: { action: 'link_existing_interviewer', personId: 'p-yeqing' },
      remainingReviewItemIds: [],
      blockingReviewItemIds: [],
      invalidatedDraftIds: [],
      resume: { stage: 'interview_import', jobId: 'demo-committed-resume' },
    },
  };
  return input;
}

describe('interview import planning with frozen 900 / 899 / 897 inputs', () => {
  it('preserves the real parser values, applicability, citations and separate signatures', () => {
    const input = facts();
    const before = structuredClone(input);
    const value = planned(input);
    expect(value.originalReview).toEqual(review());
    expect(value.originalReview.dimensions.map((x) => x.selection)).toEqual([
      expect.objectContaining({ status: 'recognized', value: '4' }),
      expect.objectContaining({ status: 'recognized', value: '3' }),
      expect.objectContaining({ status: 'recognized', value: '5' }),
      { status: 'not_applicable', reason: 'non_management_position' },
    ]);
    expect(value.originalReview.interviewRating).toMatchObject({
      status: 'recognized',
      value: 'B',
    });
    expect(value.originalReview.suggestedLevel).toMatchObject({
      status: 'recognized',
      value: 'N3',
    });
    expect(value.signatures).toEqual({
      interviewerId: 'p-yeqing',
      importerPersonId: 'p-suwan',
      importerAccountId: 'demo-hr-account',
      plannedAt: input.context.now,
      interviewerConfirmedInSystem: false,
    });
    expect(value.source).toEqual(materialSourcesFixture[1]);
    expect(value).not.toHaveProperty('dimensionScores');
    expect(value).not.toHaveProperty('quadrant');
    expect(value).not.toHaveProperty('modelInput');
    expect(input).toEqual(before);
    value.originalReview.dimensions.length = 0;
    expect(input.parsed).toEqual(before.parsed);
  });
  it('keeps both signatures when the importer is the original HR interviewer', () => {
    const value = planned(facts('hr'));
    expect(value.signatures.interviewerId).toBe('p-suwan');
    expect(value.signatures.importerPersonId).toBe('p-suwan');
    expect(value.signatures.importerAccountId).toBe('demo-hr-account');
    expect(value.signatures.interviewerConfirmedInSystem).toBe(false);
  });
  it.each(['campus', 'hr', 'professional'])(
    'accepts the actual synthetic %s DTO without changing its raw scale',
    (file) => {
      const value = planned(facts(file));
      expect(value.originalReview).toEqual(review(file));
      expect(value.originalReview.templateFingerprint).toBe(
        'bow-896-synthetic-v1',
      );
      expect(value.source.sourceCategory).toBe('historical_evaluation');
    },
  );
  it('does not mistake a passing interview or hired application flag for employment', () => {
    const input = facts();
    input.employments = [];
    expect(review().metadata.interviewResult?.value).toContain('通过');
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'employment_unverified',
    });
  });
  it('does not accept a future or another person employment', () => {
    for (const entry of [
      { personId: 'p-x08', validFrom: '2027-01-01', validTo: null },
      { personId: 'p-x02', validFrom: '2026-01-01', validTo: null },
    ]) {
      const input = facts();
      input.employments = [entry];
      expect(planInterviewImport(input)).toEqual({
        status: 'not_ready',
        reason: 'employment_unverified',
      });
    }
  });
  it.each(candidateFixture.rows.slice(1))(
    'skips $status even if a same-name directory employee exists',
    (candidate) => {
      const input = facts();
      input.candidates[0].status = candidate.status as
        'rejected' | 'offer_pending' | 'offer_declined';
      expect(planInterviewImport(input)).toEqual({
        status: 'skipped',
        reason: 'not_hired',
      });
    },
  );
  it.each([
    'manager',
    'mentor',
    'employee',
    'admin',
    'expired',
    'revoked',
    'different-account',
    'other-cohort',
  ])('does not disclose a plan to %s', (role) => {
    const input = facts();
    if (role === 'employee') input.context.grants = [];
    else if (role === 'admin') input.context.account.isSystemAdmin = true;
    else if (role === 'expired')
      input.context.grants[0].validTo = input.context.now;
    else if (role === 'revoked')
      input.context.grants[0].revokedAt = input.context.now;
    else if (role === 'different-account')
      input.context.grants[0].accountId = 'other-account';
    else if (role === 'other-cohort')
      input.context.grants[0].cohortId = 'other-cohort';
    else
      input.context.grants[0] = {
        ...input.context.grants[0],
        role: role as 'manager' | 'mentor',
        scope: role === 'manager' ? 'company' : 'cohort',
        cohortId: role === 'manager' ? null : 'demo-hiring',
      };
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
  });
  it.each(['subject', 'node-kind', 'no-review'])(
    'uses actual 899 node authorization for %s',
    (change) => {
      const input = facts();
      if (change === 'subject')
        input.context.evaluationNodeSubjects[0].evaluationNodeId = 'other-node';
      if (change === 'node-kind')
        input.context.evaluationNodes[0].kind = 'defense';
      if (change === 'no-review')
        input.context.people.find((p) => p.id === 'p-x08')!.noReview = true;
      expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
    },
  );
  it('never synthesizes candidate identity from a parser DTO that lacks it', () => {
    const input = facts();
    input.observedIdentity = null;
    candidateHeld(input);
    input.observedIdentity = { name: '谷嘉树（演示）', positionCode: null };
    candidateHeld(input);
  });
  it.each(['name', 'positionCode', 'interviewTime'])(
    'requires the actual %s match and HR confirmation',
    (field) => {
      const input = facts();
      input.candidates[0][field as 'name' | 'positionCode' | 'interviewTime'] =
        'mismatch';
      candidateHeld(input);
    },
  );
  it('does not resolve ambiguous matches or a different HR-selected candidate', () => {
    const input = facts();
    input.confirmedCandidateId = null;
    candidateHeld(input);
    input.confirmedCandidateId = 'missing';
    candidateHeld(input);
    input.candidates.push({ ...input.candidates[0] });
    input.confirmedCandidateId = input.candidates[0].candidateId;
    candidateHeld(input);
  });
  it('rejects an unbound candidate or disagreement with the current directory name', () => {
    const input = facts();
    input.candidates[0].personId = null;
    candidateHeld(input);
    input.candidates[0].personId = 'p-x08';
    input.directory.find((p) => p.id === 'p-x08')!.name = 'other';
    candidateHeld(input);
  });
  it.each(['score-missing', 'score-multiple'])(
    'holds real %s results without assigning a default score',
    (file) => {
      expect(planInterviewImport(facts(file))).toEqual({
        status: 'not_ready',
        reason: 'parser_manual_input',
      });
    },
  );
  it('keeps an unknown template rejected', () => {
    expect(planInterviewImport(facts('unknown-template'))).toEqual({
      status: 'not_ready',
      reason: 'parser_rejected',
    });
  });
  it('rejects a bad review index and missing parser metadata', () => {
    const input = facts();
    input.reviewIndex = 3;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'parser_manual_input',
    });
    input.reviewIndex = 0;
    if (input.parsed.status === 'rejected') throw new Error('fixture');
    input.parsed.reviews[0].metadata.overallComment = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'parser_manual_input',
    });
  });
  it.each([
    'absent',
    'bbox',
    'another-version',
    'original-category',
    'another-page',
  ])('does not invent a 897 PDF source from %s', (change) => {
    const input = facts();
    if (change === 'absent') input.source = null;
    else if (change === 'bbox')
      input.source = {
        ...materialSourcesFixture[1],
        location: review().templateSource,
      };
    else if (change === 'another-version')
      input.originalVersionId = 'other-version';
    else if (change === 'original-category')
      input.source = {
        ...materialSourcesFixture[1],
        sourceCategory: 'original',
      };
    else
      input.source = {
        ...materialSourcesFixture[1],
        location: { kind: 'pdf', page: 99, textRange: { start: 0, end: 18 } },
      };
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'pdf_source_unverified',
    });
  });
  it('does not invent a material id and keeps an existing unresolved item unchanged', () => {
    const input = facts();
    input.materialId = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'material_identity_missing',
    });
    const held = pending();
    held.input.pendingInterviewer = held.value.item;
    expect(planInterviewImport(held.input)).toEqual(held.value);
  });
  it('creates a contract-valid pending interviewer item instead of a person or historical evaluation', () => {
    const { input, value } = pending();
    expect(materialReviewItemSchema.parse(value.item)).toEqual(value.item);
    expect(value.item).toMatchObject({
      kind: 'unknown_interviewer',
      batchId: input.batchId,
      importRowId: input.rowId,
      originalVersionId: input.originalVersionId,
      observedName: '岚舟（目录外虚构名）（演示）',
      candidates: [],
    });
    expect(value.resume).toBeNull();
    expect(value).not.toHaveProperty('originalReview');
    expect(planInterviewImport(input)).toEqual(value);
  });
  it('keeps same-name directory ambiguity pending rather than selecting the first person', () => {
    const input = facts();
    input.directory.push({ id: 'demo-duplicate-name', name: '叶青（演示）' });
    expect(planInterviewImport(input).status).toBe('needs_review');
  });
  it('links only an existing directory interviewer and resumes this batch, row and original', () => {
    const input = resumeFacts();
    const value = planned(input);
    expect(value.resume).toEqual({
      batchId: input.batchId,
      rowId: input.rowId,
      originalVersionId: input.originalVersionId,
    });
    expect(value.signatures.interviewerId).toBe('p-yeqing');
    expect(value.originalReview.metadata.interviewer?.value).toBe(
      '岚舟（目录外虚构名）（演示）',
    );
    expect(value.signatures.interviewerConfirmedInSystem).toBe(false);
  });
  it('does not create a directory person for an unresolved link or resume a deferred item', () => {
    const input = resumeFacts();
    if (input.resolution?.kind !== 'unknown_interviewer')
      throw new Error('fixture');
    input.directory = input.directory.filter((p) => p.id !== 'p-yeqing');
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'interviewer_directory_missing',
    });
    input.resolution.resolution = { action: 'defer' };
    const value = planInterviewImport(input);
    expect(value.status).toBe('needs_review');
    expect(value).toHaveProperty('resume', null);
  });
  it.each([
    'batch',
    'row',
    'version',
    'node',
    'revision',
    'item',
    'command-kind',
    'material',
    'locator',
  ])('rejects stale or foreign pending-resolution %s', (change) => {
    const input = resumeFacts();
    const item = input.pendingInterviewer!;
    if (change === 'batch') item.batchId = 'other-batch';
    if (change === 'row' && item.kind === 'unknown_interviewer')
      item.importRowId = 'other-row';
    if (change === 'version') item.originalVersionId = 'other-original';
    if (change === 'node') item.evaluationNodeId = 'other-node';
    if (change === 'revision') input.resolution!.expectedRevision++;
    if (change === 'item') input.resolution!.itemId = 'other-item';
    if (change === 'material') item.materialId = 'other-material';
    if (change === 'locator' && item.source?.location.kind === 'pdf')
      item.source.location.textRange.start++;
    if (change === 'command-kind')
      input.resolution = {
        operationId: 'demo',
        batchId: input.batchId,
        itemId: item.itemId,
        expectedRevision: item.revision,
        kind: 'unknown_person',
        resolution: { action: 'defer' },
      };
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
  });
  it('deduplicates real repeated PDF bytes and resolved interviewer resumes before a new plan', () => {
    const original = planned();
    const input = facts('professional-duplicate');
    input.existing = [
      { evaluationId: 'already-imported', ...original.identity },
    ];
    expect(planInterviewImport(input)).toEqual({
      status: 'duplicate',
      evaluationId: 'already-imported',
      batchId: input.batchId,
      rowId: input.rowId,
      resume: null,
    });
    const resumed = resumeFacts();
    resumed.existing = input.existing;
    expect(planInterviewImport(resumed)).toEqual({
      status: 'duplicate',
      evaluationId: 'already-imported',
      batchId: resumed.batchId,
      rowId: resumed.rowId,
      resume: null,
    });
  });
  it.each(['candidateId', 'interviewTime', 'interviewerId', 'template'])(
    'includes %s in duplicate identity',
    (field) => {
      const previous = planned();
      const input = facts();
      input.existing = [
        { evaluationId: 'other', ...previous.identity, [field]: 'different' },
      ];
      expect(planInterviewImport(input).status).toBe('planned');
    },
  );
  it('reauthorizes a resumed or duplicate attempt using the current context', () => {
    const input = resumeFacts();
    const previous = planned();
    input.existing = [{ evaluationId: 'old', ...previous.identity }];
    input.context.grants[0].revokedAt = input.context.now;
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
  });
});

describe('final 897 regression: row and current review facts', () => {
  function row(input: InterviewImportFacts) {
    return {
      batchId: input.batchId,
      rowId: input.rowId,
      evaluationNodeId: input.evaluationNodeId,
      materialId: input.materialId,
      originalVersionId: input.originalVersionId,
      revision: 1,
      actorAccountId: 'demo-hr-account',
      hrCohortId: 'demo-hiring',
      access: 'allowed',
      hasHiddenContent: false,
      subjectPersonIds: ['p-x08'],
      blockingReviewItemIds: [],
      import: { state: 'unimported' },
    };
  }
  it('creates a real unknown_interview_candidate item when HR has not confirmed a match', () => {
    const input = facts();
    input.confirmedCandidateId = null;
    Object.assign(input, { rowSnapshot: row(input) });
    const probe = {
      itemId: 'demo-candidate-item',
      batchId: input.batchId,
      evaluationNodeId: input.evaluationNodeId,
      materialId: input.materialId,
      originalVersionId: input.originalVersionId,
      revision: 1,
      state: 'pending',
      source: {
        fragmentId: materialSourcesFixture[1].fragmentId,
        originalVersionId: input.originalVersionId,
        location: materialSourcesFixture[1].location,
      },
      kind: 'unknown_interview_candidate',
      importRowId: input.rowId,
      observedName: input.observedIdentity?.name,
      candidates: [],
    };
    expect(materialReviewItemSchema.safeParse(probe).success).toBe(true);
    expect(planInterviewImport(input)).toMatchObject({
      status: 'needs_review',
      item: { kind: 'unknown_interview_candidate', importRowId: input.rowId },
      resume: null,
    });
  });
  it('does not reimport an imported row by changing its interviewer', () => {
    const input = resumeFacts();
    Object.assign(input, {
      rowSnapshot: {
        ...row(input),
        import: {
          state: 'imported',
          evaluationId: 'demo-existing-evaluation',
          personId: 'p-x08',
        },
      },
    });
    expect(planInterviewImport(input)).toMatchObject({
      status: 'conflict',
      reason: 'interview_row_imported',
    });
  });
  it('does not treat an uncommitted resolution command as a current resolved receipt', () => {
    const input = resumeFacts();
    Object.assign(input, {
      rowSnapshot: row(input),
      resolvedInterviewer: null,
    });
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resolution_snapshot_unavailable',
    });
  });
});

function scope(input: InterviewImportFacts) {
  return { ...input, source: materialSourceSchema.parse(input.source) };
}
function ledger(
  item: ReturnType<typeof pending>['value']['item'],
  resolution: unknown,
) {
  const base = Object.fromEntries(
    Object.entries(item).filter(([key]) => key !== 'candidates'),
  );
  return {
    rowRevision: 1,
    item: materialReviewResolvedItemSchema.parse({
      ...base,
      state: 'resolved',
      revision: item.revision + 1,
      resolvedAt: '2026-10-31T11:59:00Z',
      auditId: 'demo-committed-audit',
      undo: { status: 'available' },
      resolution,
    }),
    receipt: materialReviewResolutionReceiptSchema.parse({
      kind: item.kind,
      batchId: item.batchId,
      materialId: item.materialId,
      itemId: item.itemId,
      revision: item.revision + 1,
      resolution,
      remainingReviewItemIds: [],
      blockingReviewItemIds: [],
      invalidatedDraftIds: [],
      resume:
        resolution &&
        typeof resolution === 'object' &&
        'action' in resolution &&
        resolution.action === 'keep_original_only'
          ? null
          : { stage: 'interview_import', jobId: 'demo-committed-resume' },
    }),
  };
}
function candidateResumeFacts(
  action:
    | 'link_existing_candidate'
    | 'keep_original_only' = 'link_existing_candidate',
) {
  const input = facts();
  input.confirmedCandidateId = null;
  const held = candidateHeld(input);
  input.pendingCandidate = held.item;
  input.confirmedCandidateId = input.candidates[0].candidateId;
  const resolution =
    action === 'keep_original_only'
      ? { action }
      : { action, personId: 'p-x08' };
  input.candidateResolution = {
    operationId: 'demo-candidate-operation',
    batchId: input.batchId,
    itemId: held.item.itemId,
    expectedRevision: held.item.revision,
    kind: 'unknown_interview_candidate',
    resolution,
  };
  input.resolvedCandidate = ledger(held.item, resolution);
  return input;
}
function undoFixture() {
  const input = resumeFacts();
  const resolved = input.resolvedInterviewer!.item;
  const pendingItem = input.pendingInterviewer!;
  const command = {
    kind: resolved.kind,
    action: 'undo',
    operationId: 'demo-undo',
    batchId: input.batchId,
    itemId: resolved.itemId,
    expectedRevision: resolved.revision,
  };
  const receipt = {
    previousRevision: resolved.revision,
    item: { ...pendingItem, revision: resolved.revision + 1, state: 'pending' },
    invalidatedDraftIds: ['demo-unconfirmed-draft'],
    auditId: 'demo-committed-undo-audit',
    resume: null,
  };
  return { input, resolved, command, receipt };
}
describe('final 897 current snapshot, receipt, privacy and withdrawal boundary', () => {
  it.each(['missing', 'scope', 'hidden-bit', 'blockers', 'permission'])(
    'keeps unknown %s facts unavailable rather than manufacturing defaults',
    (kind) => {
      const input = facts();
      if (kind === 'missing') input.rowSnapshot = null;
      if (kind === 'scope') input.rowSnapshot!.subjectPersonIds = null;
      if (kind === 'hidden-bit') input.rowSnapshot!.hasHiddenContent = null;
      if (kind === 'blockers') input.rowSnapshot!.blockingReviewItemIds = null;
      if (kind === 'permission') input.rowSnapshot!.access = 'unavailable';
      expect(planInterviewImport(input)).toEqual({
        status: 'not_ready',
        reason: 'row_snapshot_unavailable',
      });
    },
  );
  it.each([
    'batchId',
    'rowId',
    'evaluationNodeId',
    'materialId',
    'originalVersionId',
  ] as const)('rejects a current row snapshot bound to another %s', (key) => {
    const input = facts();
    input.rowSnapshot![key] = 'other';
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
  });
  it('rechecks all current scope subjects and full-original permission', () => {
    const input = facts();
    input.rowSnapshot!.subjectPersonIds!.push('outside-scope');
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
    input.rowSnapshot!.subjectPersonIds = ['p-x08'];
    input.rowSnapshot!.access = 'forbidden';
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
  });
  it('returns an imported row read-only regardless of a different PDF interviewer name', () => {
    const input = facts();
    input.rowSnapshot!.import = {
      state: 'imported',
      evaluationId: 'demo-existing',
      personId: 'p-x08',
    };
    if (input.parsed.status === 'rejected') throw new Error('fixture');
    input.parsed.reviews[0].metadata.interviewer!.value = 'different';
    expect(planInterviewImport(input)).toEqual({
      status: 'duplicate',
      evaluationId: 'demo-existing',
      batchId: input.batchId,
      rowId: input.rowId,
      resume: null,
    });
    input.rowSnapshot!.import.personId = 'outside-scope';
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
  });
  it('permits a fresh plan only after an explicit newer audited import withdrawal', () => {
    const input = facts();
    input.rowSnapshot!.revision = 2;
    input.rowSnapshot!.import = {
      state: 'withdrawn',
      previousRevision: 1,
      withdrawalAuditId: 'demo-import-withdrawal-audit',
      withdrawnAt: '2026-10-31T11:59:00Z',
    };
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_confirmation_stale',
    });
    input.confirmedForRowRevision = 2;
    input.confirmedInterviewerId = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'interviewer_confirmation_stale',
    });
    input.confirmedInterviewerId = 'p-yeqing';
    expect(planInterviewImport(input).status).toBe('planned');
    input.rowSnapshot!.import.previousRevision = 2;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
    input.rowSnapshot!.import.previousRevision = 1;
    input.rowSnapshot!.import.withdrawalAuditId = '';
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'row_snapshot_unavailable',
    });
  });
  it('does not bypass other current target blockers after a resolution', () => {
    const input = resumeFacts();
    input.rowSnapshot!.blockingReviewItemIds = ['another-current-target-item'];
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'remaining_review_blockers',
    });
  });
  it('links a candidate only using a committed current resolution, exact match, employment and current permission', () => {
    const input = candidateResumeFacts();
    expect(planned(input).personId).toBe('p-x08');
    input.resolvedCandidate = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resolution_snapshot_unavailable',
    });
  });
  it('retains only the original for the actual committed keep_original_only decision', () => {
    const input = candidateResumeFacts('keep_original_only');
    expect(planInterviewImport(input)).toEqual({
      status: 'skipped',
      reason: 'original_only',
    });
    input.rowSnapshot!.import = {
      state: 'imported',
      evaluationId: 'demo-existing',
      personId: 'p-x08',
    };
    expect(planInterviewImport(input)).toEqual({
      status: 'conflict',
      reason: 'interview_row_imported',
    });
  });
  it('keeps a deferred candidate pending without a job or an import plan', () => {
    const input = candidateResumeFacts();
    input.candidateResolution!.resolution = { action: 'defer' };
    expect(planInterviewImport(input)).toMatchObject({
      status: 'needs_review',
      item: { kind: 'unknown_interview_candidate' },
      resume: null,
    });
  });
  it('never fills the synthetic parser null positionNumber with DEMO-JOB-01 or a manual link', () => {
    const input = candidateResumeFacts();
    if (input.parsed.status === 'rejected') throw new Error('fixture');
    expect(input.parsed.reviews[0].identity.positionNumber).toBeNull();
    input.observedIdentity!.positionCode = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_identity_missing',
    });
  });
  it.each([
    'kind',
    'batch',
    'revision',
    'resolution',
    'source',
    'row-version',
    'audit',
    'receipt-item',
    'receipt-resolution',
  ])('rejects a stale or mismatched committed candidate %s', (change) => {
    const input = candidateResumeFacts();
    const evidence = input.resolvedCandidate!;
    if (change === 'kind')
      Reflect.set(evidence.item, 'kind', 'unknown_interviewer');
    if (change === 'batch') evidence.item.batchId = 'other';
    if (change === 'revision') evidence.item.revision++;
    if (change === 'resolution')
      Reflect.set(evidence.item, 'resolution', {
        action: 'keep_original_only',
      });
    if (change === 'source') evidence.item.source = null;
    if (change === 'row-version') evidence.rowRevision++;
    if (change === 'audit') evidence.item.auditId = '';
    if (change === 'receipt-item') evidence.receipt.itemId = 'other';
    if (change === 'receipt-resolution')
      Reflect.set(evidence.receipt, 'resolution', {
        action: 'keep_original_only',
      });
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
  });
  it('keeps a committed candidate link from bypassing a missing HR confirmation or current person scope', () => {
    const input = candidateResumeFacts();
    input.confirmedCandidateId = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_match_unconfirmed',
    });
    input.confirmedCandidateId = input.candidates[0].candidateId;
    const resolution = {
      action: 'link_existing_candidate',
      personId: 'outside-scope',
    };
    Reflect.set(input.candidateResolution!, 'resolution', resolution);
    input.resolvedCandidate = ledger(input.pendingCandidate!, resolution);
    expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
  });
  it('filters hidden candidate suggestions to one boolean without names, IDs or counts', () => {
    const input = facts();
    input.confirmedCandidateId = null;
    input.candidates.push({
      ...input.candidates[0],
      candidateId: 'hidden-candidate',
      personId: 'hidden-person',
      name: input.candidates[0].name,
    });
    input.directory.push({ id: 'hidden-person', name: '隐藏化名（演示）' });
    const value = candidateHeld(input);
    expect(value.hasHiddenContent).toBe(true);
    expect(JSON.stringify(value)).not.toContain('hidden-person');
    expect(JSON.stringify(value)).not.toContain('隐藏化名');
    expect(value).not.toHaveProperty('hiddenCount');
    input.pendingCandidate = value.item;
    if (input.pendingCandidate.kind !== 'unknown_interview_candidate')
      throw new Error('fixture');
    input.pendingCandidate.candidates.push({
      personId: 'hidden-person',
      displayName: '隐藏化名（演示）',
    });
    const replay = planInterviewImport(input);
    expect(replay).toMatchObject({
      status: 'needs_review',
      hasHiddenContent: true,
    });
    expect(JSON.stringify(replay)).not.toContain('hidden-person');
  });
  it('projects current resolved items read-only and masks current invisible links', () => {
    const input = resumeFacts();
    const original = structuredClone(input.resolvedInterviewer!.item);
    input.rowSnapshot!.import = {
      state: 'imported',
      evaluationId: 'demo-existing',
      personId: 'p-x08',
    };
    const value = projectInterviewReviewState(
      scope(input),
      input.rowSnapshot,
      [original],
      input.directory.map((p) => p.id),
    );
    expect(value).toMatchObject({
      status: 'projected',
      resolvedItems: [
        { undo: { status: 'blocked', reason: 'interview_row_imported' } },
      ],
      hasHiddenContent: false,
    });
    expect(original.undo).toEqual({ status: 'available' });
    expect(
      projectInterviewReviewState(
        scope(input),
        input.rowSnapshot,
        [original],
        [],
      ),
    ).toEqual({
      status: 'projected',
      resolvedItems: [],
      hasHiddenContent: true,
    });
  });
  it('does not disclose decisions to expired HR or accept another row in a projection', () => {
    const input = resumeFacts();
    const item = structuredClone(input.resolvedInterviewer!.item);
    input.context.grants[0].validTo = input.context.now;
    expect(
      projectInterviewReviewState(scope(input), input.rowSnapshot, [item], []),
    ).toEqual({ status: 'forbidden' });
    input.context.grants[0].validTo = null;
    item.batchId = 'other';
    expect(
      projectInterviewReviewState(scope(input), input.rowSnapshot, [item], []),
    ).toEqual({ status: 'conflict' });
  });
  it('consumes only an actual valid undo receipt with revision+1 and resume:null', () => {
    const f = undoFixture();
    const value = consumeInterviewUndoReceipt(
      scope(f.input),
      f.input.rowSnapshot,
      f.resolved,
      f.command,
      f.receipt,
      f.input.directory.map((p) => p.id),
    );
    expect(value).toEqual({ status: 'accepted', receipt: f.receipt });
    expect(f.receipt.resume).toBeNull();
  });
  it('rejects undo after import until audited import withdrawal; dependent confirmations stay blocked', () => {
    const f = undoFixture();
    f.input.rowSnapshot!.import = {
      state: 'imported',
      evaluationId: 'demo-existing',
      personId: 'p-x08',
    };
    const consume = () =>
      consumeInterviewUndoReceipt(
        scope(f.input),
        f.input.rowSnapshot,
        f.resolved,
        f.command,
        f.receipt,
        f.input.directory.map((p) => p.id),
      );
    expect(consume()).toEqual({
      status: 'conflict',
      reason: 'interview_row_imported',
    });
    f.input.rowSnapshot!.revision = 2;
    f.input.rowSnapshot!.import = {
      state: 'withdrawn',
      previousRevision: 1,
      withdrawalAuditId: 'demo-withdrawal',
      withdrawnAt: '2026-10-31T11:59:00Z',
    };
    expect(consume().status).toBe('accepted');
    f.resolved.undo = {
      status: 'blocked',
      reason: 'dependent_draft_confirmed',
    };
    expect(consume()).toEqual({ status: 'conflict' });
  });
  it.each([
    'kind',
    'revision',
    'audit',
    'resume',
    'material',
    'source',
    'stale-pending',
    'hidden-candidate',
  ])('rejects invalid or stale undo %s without echoing input', (change) => {
    const f = undoFixture();
    if (change === 'kind') Reflect.set(f.command, 'kind', 'unknown_person');
    if (change === 'revision') f.command.expectedRevision++;
    if (change === 'audit') f.receipt.auditId = '';
    if (change === 'resume')
      Reflect.set(f.receipt, 'resume', {
        stage: 'interview_import',
        jobId: 'fake',
      });
    if (change === 'material') f.receipt.item.materialId = 'other';
    if (change === 'source') f.receipt.item.source = null;
    if (change === 'stale-pending') f.receipt.item.revision++;
    if (change === 'hidden-candidate') {
      if (f.receipt.item.kind !== 'unknown_interviewer')
        throw new Error('fixture');
      f.receipt.item.candidates = [
        { personId: 'hidden-person', displayName: '隐藏化名（演示）' },
      ];
    }
    expect(
      consumeInterviewUndoReceipt(
        scope(f.input),
        f.input.rowSnapshot,
        f.resolved,
        f.command,
        f.receipt,
        f.input.directory.map((p) => p.id),
      ),
    ).toEqual({ status: 'conflict' });
  });
  it('keeps unknown directory visibility unavailable and reauthorizes receipt replays', () => {
    const f = undoFixture();
    expect(
      consumeInterviewUndoReceipt(
        scope(f.input),
        f.input.rowSnapshot,
        f.resolved,
        f.command,
        f.receipt,
        null,
      ),
    ).toEqual({ status: 'unavailable' });
    f.input.context.grants[0].revokedAt = f.input.context.now;
    expect(
      consumeInterviewUndoReceipt(
        scope(f.input),
        f.input.rowSnapshot,
        f.resolved,
        f.command,
        f.receipt,
        f.input.directory.map((p) => p.id),
      ),
    ).toEqual({ status: 'forbidden' });
  });
});

describe('current interview review replay privacy', () => {
  it('does not accept a prior hidden association through an otherwise empty undo item', () => {
    const f = undoFixture();
    const value = consumeInterviewUndoReceipt(
      scope(f.input),
      f.input.rowSnapshot,
      f.resolved,
      f.command,
      f.receipt,
      [],
    );
    expect(value).toEqual({ status: 'conflict' });
    expect(JSON.stringify(value)).not.toContain('p-yeqing');
  });
  it('rejects duplicate or malformed resolved decisions instead of inflating the read projection', () => {
    const input = resumeFacts();
    const decision = input.resolvedInterviewer!.item;
    const visible = input.directory.map((p) => p.id);
    expect(
      projectInterviewReviewState(
        scope(input),
        input.rowSnapshot,
        [decision, decision],
        visible,
      ),
    ).toEqual({ status: 'conflict' });
    Reflect.set(decision, 'state', 'pending');
    expect(
      projectInterviewReviewState(
        scope(input),
        input.rowSnapshot,
        [decision],
        visible,
      ),
    ).toEqual({ status: 'conflict' });
  });
  it('removes stale interviewer suggestions on a pending replay', () => {
    const { input, value } = pending();
    input.pendingInterviewer = value.item;
    if (input.pendingInterviewer.kind !== 'unknown_interviewer')
      throw new Error('fixture');
    input.pendingInterviewer.candidates = [
      {
        personId: 'outside-current-directory',
        displayName: '隐藏化名（演示）',
      },
    ];
    const replay = planInterviewImport(input);
    expect(replay).toMatchObject({
      status: 'needs_review',
      hasHiddenContent: true,
      item: { candidates: [] },
    });
    expect(JSON.stringify(replay)).not.toContain('outside-current-directory');
    expect(JSON.stringify(replay)).not.toContain('隐藏化名');
  });
});

describe('import withdrawal preserves association version fences', () => {
  it('requires a real current pending revision instead of recreating revision 1 after withdrawal', () => {
    const input = facts();
    input.confirmedCandidateId = null;
    input.rowSnapshot!.revision = 2;
    input.rowSnapshot!.import = {
      state: 'withdrawn',
      previousRevision: 1,
      withdrawalAuditId: 'demo-audited-withdrawal',
      withdrawnAt: '2026-10-31T11:59:00Z',
    };
    input.confirmedForRowRevision = 2;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'review_revision_unavailable',
    });
  });
  it('does not reuse a resolution from an earlier import-row version or ignore incomplete decision history', () => {
    const input = candidateResumeFacts();
    input.rowSnapshot!.revision = 2;
    input.confirmedForRowRevision = 2;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
    input.resolvedCandidate!.rowRevision = 2;
    input.pendingCandidate = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'resume_conflict',
    });
  });
  it('keeps the imported-row command cutoff ahead of parsing or proposed association changes', () => {
    const input = resumeFacts();
    input.rowSnapshot!.import = {
      state: 'imported',
      evaluationId: 'demo-existing',
      personId: 'p-x08',
    };
    input.parsed = {
      status: 'rejected',
      reason: 'unknown_template',
      message: '演示未知模板',
    };
    expect(planInterviewImport(input)).toEqual({
      status: 'conflict',
      reason: 'interview_row_imported',
    });
  });
});

describe('current lookup labels and execution-time provenance', () => {
  it('uses current visible directory labels rather than stale suggestion names', () => {
    const { input, value } = pending();
    input.pendingInterviewer = value.item;
    if (input.pendingInterviewer.kind !== 'unknown_interviewer')
      throw new Error('fixture');
    input.pendingInterviewer.candidates = [
      { personId: 'p-yeqing', displayName: '旧显示名（演示）' },
    ];
    input.directory.find((p) => p.id === 'p-yeqing')!.name =
      '当前显示名（演示）';
    const shown = planInterviewImport(input);
    expect(shown).toMatchObject({
      status: 'needs_review',
      item: {
        candidates: [
          { personId: 'p-yeqing', displayName: '当前显示名（演示）' },
        ],
      },
    });
    expect(JSON.stringify(shown)).not.toContain('旧显示名');
  });
  it('does not use the permission business clock as the audit execution clock', () => {
    const input = resumeFacts();
    input.context.now = '2026-09-04T00:00:00Z';
    input.resolvedInterviewer!.item.resolvedAt = '2026-11-01T01:00:00Z';
    expect(planInterviewImport(input).status).toBe('planned');
    const fresh = facts();
    fresh.context.now = input.context.now;
    fresh.rowSnapshot!.revision = 2;
    fresh.rowSnapshot!.import = {
      state: 'withdrawn',
      previousRevision: 1,
      withdrawalAuditId: 'demo-actual-audit',
      withdrawnAt: '2026-11-01T01:00:00Z',
    };
    fresh.confirmedForRowRevision = 2;
    fresh.confirmedInterviewerId = 'p-yeqing';
    expect(planInterviewImport(fresh).status).toBe('planned');
  });
});

describe('unknown candidate rows use current explicit HR material scope', () => {
  it('can create the real review kind for a known-empty subject set without inventing a person', () => {
    const input = facts();
    input.candidates = [];
    input.confirmedCandidateId = null;
    input.rowSnapshot!.subjectPersonIds = [];
    input.observedIdentity = null;
    const value = candidateHeld(input);
    expect(value.item).toMatchObject({
      kind: 'unknown_interview_candidate',
      observedName: null,
      candidates: [],
    });
    expect(value).toHaveProperty('hasHiddenContent', false);
  });
  it.each(['actor', 'hr-scope'])(
    'rejects a stale %s material permission even with known-empty subjects',
    (change) => {
      const input = facts();
      input.rowSnapshot!.subjectPersonIds = [];
      input.confirmedCandidateId = null;
      if (change === 'actor')
        input.rowSnapshot!.actorAccountId = 'another-account';
      else input.rowSnapshot!.hrCohortId = 'another-hr-scope';
      expect(planInterviewImport(input)).toEqual({ status: 'forbidden' });
    },
  );
});

describe('candidate suggestions preserve strict identity fields', () => {
  it.each(['name', 'positionCode', 'interviewTime'] as const)(
    'does not suggest a directory person from a mismatched %s record',
    (key) => {
      const input = facts();
      input.confirmedCandidateId = null;
      input.candidates[0][key] = 'mismatch';
      const value = candidateHeld(input);
      expect(value.item).toMatchObject({
        kind: 'unknown_interview_candidate',
        candidates: [],
      });
      expect(value.hasHiddenContent).toBe(false);
    },
  );
});
