import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { parseInterviewReviewPdf } from '../modules/records/attachments/interview-review/parser';
import type { InterviewReviewResult } from '../modules/records/attachments/interview-review/types';
import {
  archiveScale,
  INTERVIEW_HISTORY_KIND,
} from '../usecases/interview-import/archive-model';
import { archiveFragmentId } from '../usecases/interview-import/archive';
import { personInterviewArchiveFromData } from './person-interviews';
import { completeTalentSources, type PersonData } from './person-data';
import { fixture } from './person-test-helpers';
let parsed: Exclude<InterviewReviewResult, { status: 'rejected' }>;
beforeAll(async () => {
  const result = await parseInterviewReviewPdf(
    await readFile('tests/fixtures/bow-896/interview/campus.pdf'),
    { positionKind: 'non_management', allowSyntheticDemo: true },
  );
  if (result.status === 'rejected')
    throw new Error('Synthetic fixture rejected');
  parsed = result;
});
function archived() {
  const data = fixture('hr');
  Object.assign(data.context, {
    evaluationNodes: [{ id: 'interview', kind: 'interview', cohortId: null }],
    evaluationNodeSubjects: [
      { evaluationNodeId: 'interview', personId: 'one' },
    ],
    evaluationRelations: [],
  });
  data.originals[0].kind = 'original';
  data.originals[0].displayNotice = null;
  const review = parsed.reviews[0];
  const scale = archiveScale(review, {});
  const at = '2026-11-01T12:00:00.000Z';
  const history: PersonData['historical'][number] = {
    id: 'history',
    sourceRecordId: 'batch:row',
    evaluationNodeId: 'interview',
    personId: 'one',
    recorderId: 'two',
    occurredOn: '2026-05-01',
    kind: INTERVIEW_HISTORY_KIND,
    period: review.template,
    scale: scale.map(({ item, value }) => [item, value]),
    ruleVersionId: null,
    originalVersionId: 'version',
    fragmentId: archiveFragmentId('canonical', 'overview'),
    sourceCategory: 'original',
  };
  data.historical.push(history);
  const regions = [
    { field: 'overview', regions: [review.templateSource] },
    ...scale.map((item, index) => ({
      field: `scale-${index}`,
      regions: item.regions,
    })),
  ];
  data.fragments.push(
    ...regions.flatMap(({ field, regions }) =>
      regions.map((region, index) => ({
        id: archiveFragmentId('canonical', field, index),
        originalVersionId: 'version',
        parseVersionId: 'canonical',
        sourceCategory: 'historical_evaluation' as const,
        evaluationKind: 'interview' as const,
        demo: true,
        excerpt: parsed.pageTexts
          .find((page) => page.page === region.page)!
          .text.slice(region.textRange.start, region.textRange.end),
        location: {
          kind: 'pdf' as const,
          page: region.page,
          textRange: region.textRange,
        },
      })),
    ),
  );
  data.interviewArchives.push({
    archive: {
      evaluationId: history.id,
      batchId: 'batch',
      rowId: 'row',
      importRevision: 2,
      duplicateKey: '0'.repeat(64),
      importerPersonId: 'actor',
      withdrawnAt: null,
      withdrawalAuditId: null,
    },
    history,
    row: {
      batchId: 'batch',
      rowId: 'row',
      ordinal: 1,
      materialId: 'original',
      originalVersionId: 'version',
      parseVersionId: 'original-parse',
      fragmentId: 'old-fragment',
      reviewIndex: 0,
      parsed,
      revision: 2,
      confirmedCandidateId: 'candidate',
      confirmedForRevision: 2,
      confirmedByAccountId: 'account',
      confirmedAt: at,
      filled: {},
      decision: null,
      decisionRevision: null,
    },
    operation: {
      id: 'confirm-operation',
      batchId: 'batch',
      rowId: 'row',
      action: 'confirm',
      actorAccountId: 'account',
      at,
      fromRevision: 1,
      toRevision: 2,
      before: { confirmation: null, decision: null, filled: {} },
      after: {
        confirmation: {
          candidateId: 'candidate',
          forRevision: 2,
          byAccountId: 'account',
          at,
        },
        decision: null,
        filled: {},
      },
      auditId: 'confirm-audit',
    },
  });
  return data;
}
it('projects the authorized historical original scale with separate signatures and real field references', async () => {
  const data = archived();
  const result = await personInterviewArchiveFromData(data, 'one');
  expect(result?.status).toBe('ready');
  if (result?.status !== 'ready') throw new Error('Expected archive');
  expect(result.data[0]).toMatchObject({
    id: 'history',
    interviewerName: 'Synthetic two（演示）',
    importedByName: 'Synthetic actor（演示）',
    interviewerConfirmedInSystem: false,
  });
  const item = result.data[0].scale.find((item) => item.item === '专业能力')!;
  expect(item).toMatchObject({ value: '2', origin: 'parser' });
  expect(item.sources[0].location).toEqual({
    kind: 'pdf',
    page:
      parsed.reviews[0].dimensions[0].selection.status === 'not_applicable'
        ? 1
        : parsed.reviews[0].dimensions[0].selection.source.page,
    textRange:
      parsed.reviews[0].dimensions[0].selection.status === 'not_applicable'
        ? {}
        : parsed.reviews[0].dimensions[0].selection.source.textRange,
  });
  expect(JSON.stringify(result)).not.toContain('overallComment');
  expect(result.data[0].scale.map(({ item, value }) => [item, value])).toEqual(
    data.historical[0].scale,
  );
});
it('withdrawal hides the current archive but does not discard historical source subjects', async () => {
  const data = archived();
  data.interviewArchives[0].archive.withdrawnAt = '2026-11-02T00:00:00.000Z';
  data.interviewArchives[0].archive.withdrawalAuditId = 'withdraw-audit';
  expect(await personInterviewArchiveFromData(data, 'one')).toEqual({
    status: 'empty',
  });
  const source = completeTalentSources(data).find(
    (source) => source.fragmentId === data.historical[0].fragmentId,
  )!;
  expect(source.requiredKinds).toContain('interview-evaluation');
  expect(source.subjects).toEqual([
    expect.objectContaining({ personId: 'one', evaluationNodeId: 'interview' }),
  ]);
});
it('omits the block for a real evaluator, system admin, missing target and out-of-scope HR', async () => {
  const evaluator = archived();
  evaluator.context.grants = [];
  evaluator.context.evaluationRelations = [
    {
      id: 'real-relation',
      evaluationNodeId: 'interview',
      personId: 'one',
      evaluatorId: 'actor',
      kind: 'interviewer',
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    },
  ];
  expect(
    await personInterviewArchiveFromData(evaluator, 'one'),
  ).toBeUndefined();
  const admin = archived();
  admin.context.account.isSystemAdmin = true;
  expect(await personInterviewArchiveFromData(admin, 'one')).toBeUndefined();
  expect(
    await personInterviewArchiveFromData(archived(), 'missing'),
  ).toBeUndefined();
  const outside = archived();
  outside.context.enrollments = [];
  expect(await personInterviewArchiveFromData(outside, 'one')).toBeUndefined();
});
it('one hidden subject on a shared field suppresses the complete archive; unknown history and invalid classification stay closed', async () => {
  const shared = archived();
  const field = shared.fragments.find(
    (fragment) => fragment.id === archiveFragmentId('canonical', 'scale-0'),
  )!;
  const event = {
    ...shared.events[0],
    id: 'hidden-event',
    personId: 'two',
    evaluationNodeId: 'interview',
  };
  shared.events.push(event);
  shared.context.evaluationNodeSubjects!.push({
    personId: 'two',
    evaluationNodeId: 'interview',
  });
  shared.eventSources.push({
    eventId: event.id,
    fragmentId: field.id,
    originalVersionId: field.originalVersionId,
  });
  expect(await personInterviewArchiveFromData(shared, 'one')).toEqual({
    status: 'empty',
  });
  const unknown = archived();
  unknown.historical[0].kind = 'unapproved-history';
  expect(await personInterviewArchiveFromData(unknown, 'one')).toEqual({
    status: 'empty',
  });
  const misclassified = archived();
  misclassified.fragments.find(
    (fragment) => fragment.id === misclassified.historical[0].fragmentId,
  )!.evaluationKind = null;
  expect(await personInterviewArchiveFromData(misclassified, 'one')).toEqual({
    status: 'empty',
  });
  const inconsistent = archived();
  inconsistent.historical[0].scale[0][1] = '5';
  expect(await personInterviewArchiveFromData(inconsistent, 'one')).toEqual({
    status: 'empty',
  });
});
