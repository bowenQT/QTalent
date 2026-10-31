import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseInterviewReviewPdf } from '../../modules/records/attachments/interview-review/parser';
import type { InterviewReviewResult } from '../../modules/records/attachments/interview-review/types';
import { materialSourcesFixture } from '../../../contracts/materials.fixtures';
import { materialReviewItemSchema } from '../../../contracts/material-review';
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
    directory: people,
    employments: [
      { personId: 'p-x08', validFrom: '2026-01-01', validTo: null },
    ],
    // This is a separate 897 synthetic canonical source, not a bbox conversion
    // or evidence that the PDFs above have been persisted/cited in production.
    source: structuredClone(materialSourcesFixture[1]),
    existing: [],
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
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_identity_missing',
    });
    input.observedIdentity = { name: '谷嘉树（演示）', positionCode: null };
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_identity_missing',
    });
  });
  it.each(['name', 'positionCode', 'interviewTime'])(
    'requires the actual %s match and HR confirmation',
    (field) => {
      const input = facts();
      input.candidates[0][field as 'name' | 'positionCode' | 'interviewTime'] =
        'mismatch';
      expect(planInterviewImport(input)).toEqual({
        status: 'not_ready',
        reason: 'candidate_match_unconfirmed',
      });
    },
  );
  it('does not resolve ambiguous matches or a different HR-selected candidate', () => {
    const input = facts();
    input.confirmedCandidateId = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_match_unconfirmed',
    });
    input.confirmedCandidateId = 'missing';
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_match_unconfirmed',
    });
    input.candidates.push({ ...input.candidates[0] });
    input.confirmedCandidateId = input.candidates[0].candidateId;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_match_unconfirmed',
    });
  });
  it('rejects an unbound candidate or disagreement with the current directory name', () => {
    const input = facts();
    input.candidates[0].personId = null;
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_directory_missing',
    });
    input.candidates[0].personId = 'p-x08';
    input.directory.find((p) => p.id === 'p-x08')!.name = 'other';
    expect(planInterviewImport(input)).toEqual({
      status: 'not_ready',
      reason: 'candidate_directory_missing',
    });
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
    input.resolution.resolution = {
      action: 'link_existing_interviewer',
      personId: 'missing',
    };
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
