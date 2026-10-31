import type {
  ComparisonCase,
  ComparisonHrPage,
  ComparisonMapping,
  ComparisonManagerPage,
  ComparisonRaterAccess,
  ComparisonRaterPage,
} from './judgment-comparison';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from './standard-attribution';
import type {
  SelectionImpactPreview,
  SelectionPublicationReceipt,
  SelectionRevision,
  SelectionManagerRevision,
} from './selection-standard';

export const iterationDemoHr = { id: 'demo-hr', name: '澄夏（演示）' };
export const iterationDemoManager = {
  id: 'demo-manager',
  name: '江舟（演示）',
};
export const iterationDemoCohort = { id: 'demo-xe6', name: '第六期（演示）' };
export const iterationDemoNextCohort = {
  id: 'demo-xe7',
  name: '第七期（演示）',
};
export const iterationDemoPolicy = {
  conclusionScope: 'evaluation_system_only',
  laterStageUse: 'comparison_not_ground_truth',
} as const;
const now = '2026-10-31T10:00:00Z';
const highest = '高分档';
const middle = '中间档';
const lowest = '刚过线档';

// All names, text, row numbers and grades are synthetic contract examples, not
// copies of private HR data or the seed's prototype-snapshot graduation rows.
export function comparisonMappingFixture(): ComparisonMapping {
  return {
    versionId: 'map-xe-select-v1',
    frontScaleId: 'demo-work-review-three-grades',
    backScaleId: 'demo-graduation-three-grades',
    rows: [
      { frontGrade: highest, frontPosition: 'highest', backGrade: '建议留用' },
      { frontGrade: middle, frontPosition: 'middle', backGrade: '继续观察' },
      { frontGrade: lowest, frontPosition: 'just_passed', backGrade: '不建议' },
    ],
    confirmedBy: iterationDemoHr,
    confirmedAt: now,
  };
}
function demoCase(
  index: number,
  frontGrade: string,
  backGrade: string,
  outcome: ComparisonCase['outcome'],
  evaluatorId = 'demo-evaluator-five',
): ComparisonCase {
  const person = { id: `demo-person-${index}`, name: `演示学员${index}` };
  const stage = (
    side: 'front' | 'back',
    grade: string,
  ): ComparisonCase['front'] => {
    const front = side === 'front';
    const row = front ? index + 1 : index + 20;
    return {
      state: 'present',
      judgment: {
        judgmentId: `demo-${side}-judgment-${index}`,
        nodeId: front ? 'demo-xe6-selection' : 'demo-xe6-graduation',
        cohortId: iterationDemoCohort.id,
        standardVersionId: front ? 'xe-select-v1' : 'demo-graduation-v1',
        scaleId: front
          ? 'demo-work-review-three-grades'
          : 'demo-graduation-three-grades',
        grade,
        evaluator: front
          ? { id: evaluatorId, name: '演示作品评审人' }
          : { id: 'demo-graduation-evaluator', name: '演示结营评审人' },
        evaluatedAt: now,
        confirmation: 'human_confirmed',
        row: {
          personId: person.id,
          row,
          source: {
            fragmentId: `demo-${side}-row-${index}`,
            originalVersionId: `demo-${side}-table-v1`,
            location: {
              kind: 'spreadsheet',
              sheet: front ? '作品评审表' : '结营评审表',
              cell: `A${row}:H${row}`,
            },
            excerpt: `演示：${person.name}的${front ? '作品评审' : '结营评审'}，原量表为「${grade}」。`,
            sourceType: 'spreadsheet',
            sourceCategory: 'original',
            demo: true,
          },
        },
      },
    };
  };
  return {
    id: `demo-comparison-${index}`,
    batchId: 'demo-selection-graduation-xe6',
    person,
    judgment: { id: 'selection_outcome', name: '入营选拔判断（演示）' },
    cohort: iterationDemoCohort,
    selectionStandardVersionId: 'xe-select-v1',
    mappingVersionId: 'map-xe-select-v1',
    frontNodeId: 'demo-xe6-selection',
    backNodeId: 'demo-xe6-graduation',
    front: stage('front', frontGrade),
    back: stage('back', backGrade),
    work: { kind: 'individual', workId: `demo-work-${index}` },
    outcome,
  };
}
export function comparisonCasesFixture(): ComparisonCase[] {
  const missingBack = demoCase(6, highest, '建议留用', {
    state: 'missing',
    missing: 'back',
  });
  missingBack.back = { state: 'missing', reason: '演示：结营表没有这一行' };
  const missingFront = demoCase(7, middle, '继续观察', {
    state: 'missing',
    missing: 'front',
  });
  missingFront.front = {
    state: 'missing',
    reason: '演示：作品评审表没有这一行',
  };
  const missingBoth = demoCase(8, middle, '继续观察', {
    state: 'missing',
    missing: 'both',
  });
  missingBoth.front = { state: 'missing', reason: '演示：缺少前段判断' };
  missingBoth.back = { state: 'missing', reason: '演示：缺少后段判断' };
  const team = demoCase(1, highest, '不建议', {
    state: 'front_higher',
    bands: 2,
  });
  team.work = {
    kind: 'team',
    teamId: 'demo-team-a',
    workId: 'demo-team-work-a',
  };
  const teammate = demoCase(3, highest, '建议留用', { state: 'consistent' });
  teammate.work = structuredClone(team.work);
  return [
    team,
    demoCase(2, lowest, '建议留用', { state: 'front_lower', bands: 2 }),
    teammate,
    demoCase(4, middle, '不建议', {
      state: 'middle_distribution',
      backGrade: '不建议',
    }),
    demoCase(5, middle, '建议留用', {
      state: 'middle_distribution',
      backGrade: '建议留用',
    }),
    missingBack,
    missingFront,
    missingBoth,
    demoCase(9, highest, '不建议', {
      state: 'not_comparable',
      reason: '演示：两段任务情境不可比',
      markedBy: iterationDemoHr,
      markedAt: now,
    }),
    demoCase(
      10,
      highest,
      '建议留用',
      { state: 'consistent' },
      'demo-evaluator-four',
    ),
    demoCase(
      11,
      lowest,
      '不建议',
      { state: 'consistent' },
      'demo-evaluator-four',
    ),
    demoCase(
      12,
      middle,
      '继续观察',
      { state: 'middle_distribution', backGrade: '继续观察' },
      'demo-evaluator-four',
    ),
    demoCase(
      13,
      highest,
      '继续观察',
      { state: 'front_higher', bands: 1 },
      'demo-evaluator-four',
    ),
  ];
}
export function comparisonHrFixture(): ComparisonHrPage {
  return {
    audience: 'hr',
    policy: iterationDemoPolicy,
    batch: {
      id: 'demo-selection-graduation-xe6',
      name: '第六期入营选拔与结营判断对照（演示）',
      cohort: iterationDemoCohort,
      selectionStandardVersionId: 'xe-select-v1',
      mappingVersionId: 'map-xe-select-v1',
    },
    mapping: comparisonMappingFixture(),
    cases: comparisonCasesFixture(),
    counts: {
      clear: { consistent: 3, frontHigher: 2, frontLower: 1 },
      middleDistribution: { notRecommended: 1, observe: 1, recommended: 1 },
      excluded: {
        missingFront: 1,
        missingBack: 1,
        missingBoth: 1,
        notComparable: 1,
      },
    },
    raters: [
      {
        evaluator: { id: 'demo-evaluator-five', name: '演示作品评审人甲' },
        sample: {
          state: 'sufficient_sample',
          threshold: 5,
          comparableCaseCount: 5,
          caseIds: [
            'demo-comparison-1',
            'demo-comparison-2',
            'demo-comparison-3',
            'demo-comparison-4',
            'demo-comparison-5',
          ],
          distribution: {
            clear: { consistent: 1, frontHigher: 1, frontLower: 1 },
            middleDistribution: {
              notRecommended: 1,
              observe: 0,
              recommended: 1,
            },
            excluded: {
              missingFront: 0,
              missingBack: 0,
              missingBoth: 0,
              notComparable: 0,
            },
          },
        },
      },
      {
        evaluator: { id: 'demo-evaluator-four', name: '演示作品评审人乙' },
        sample: {
          state: 'insufficient_sample',
          label: '样本不足',
          threshold: 5,
          comparableCaseCount: 4,
          caseIds: [
            'demo-comparison-10',
            'demo-comparison-11',
            'demo-comparison-12',
            'demo-comparison-13',
          ],
        },
      },
    ],
  };
}
export function comparisonManagerFixture(): ComparisonManagerPage {
  return {
    audience: 'manager',
    policy: iterationDemoPolicy,
    batches: [
      {
        batch: comparisonHrFixture().batch,
        discrepancyPeople: 3,
        attributionCategories: ['evaluation_standard', 'person_or_environment'],
      },
    ],
  };
}
export function comparisonRaterFixture(): {
  page: ComparisonRaterPage;
  access: ComparisonRaterAccess;
} {
  const unit = comparisonCasesFixture()[0];
  return {
    page: {
      audience: 'rater',
      viewerId: 'demo-evaluator-five',
      policy: iterationDemoPolicy,
      cases: [
        {
          ...unit,
          back: { state: 'withheld' },
          outcome: { state: 'withheld' },
        },
      ],
      sample: {
        state: 'insufficient_sample',
        label: '样本不足',
        threshold: 5,
        comparableCaseCount: 0,
        caseIds: [],
      },
    },
    access: {
      viewerId: 'demo-evaluator-five',
      now,
      ownCaseIds: [unit.id],
      mapping: comparisonMappingFixture(),
      grants: [
        {
          personId: unit.person.id,
          nodeId: unit.frontNodeId,
          validFrom: now,
          validUntil: null,
        },
      ],
    },
  };
}
export function standardHypothesisFixture(): StandardAttributionHypothesis {
  const unit = comparisonCasesFixture()[0];
  if (unit.front.state !== 'present') throw new Error('演示前段必须存在');
  return {
    id: 'demo-hypothesis',
    batchId: unit.batchId,
    origin: 'ai_hypothesis',
    text: '演示假设：组队作品的评价方式可能没有区分个人贡献。',
    categories: ['method_or_information'],
    citations: [
      {
        caseId: unit.id,
        side: 'front',
        nodeId: unit.frontNodeId,
        standardVersionId: unit.selectionStandardVersionId,
        row: unit.front.judgment.row,
      },
    ],
    model: {
      service: 'Modelink',
      model: 'demo-gemini',
      promptVersion: 'demo-selection-attribution-v1',
    },
    generatedAt: now,
  };
}
export function confirmedStandardAttributionFixture(): ConfirmedStandardAttribution {
  const hypothesis = standardHypothesisFixture();
  return {
    id: 'demo-attribution',
    revision: 1,
    batchId: hypothesis.batchId,
    origin: 'human_conclusion',
    hypothesisId: hypothesis.id,
    categories: ['evaluation_standard', 'method_or_information'],
    rationale:
      '演示：原评审要点没有要求区分个人贡献，补充可核验的个人交付说明。',
    citations: hypothesis.citations,
    confirmedBy: iterationDemoHr,
    confirmedAt: now,
  };
}
export function selectionImpactPreviewFixture(): SelectionImpactPreview {
  return {
    id: 'demo-preview-r1',
    contentRevision: 1,
    generatedAt: now,
    nextCohort: iterationDemoNextCohort,
    newStandardVersionId: 'xe-select-v2',
    existingResults: [
      {
        cohortId: iterationDemoCohort.id,
        standardVersionId: 'xe-select-v1',
        count: 11,
      },
    ],
    preservedBindings: [
      {
        cohort: iterationDemoCohort,
        standardVersionId: 'xe-select-v1',
        boundAt: '2026-07-01T00:00:00Z',
      },
    ],
    existingResultsPolicy: 'preserve_original_version',
    recomputeHistoricalResults: false,
    nextComparisonGrouping: 'selection_standard_version',
  };
}
export function selectionRevisionFixture(): SelectionRevision {
  const changes = [
    {
      kind: 'add' as const,
      after: {
        id: 'demo-individual-contribution',
        title: '个人贡献核验',
        description: '演示：组队成员分别说明本人交付并引用作品记录。',
      },
    },
  ];
  return {
    id: 'demo-revision',
    category: 'xe_selection',
    versionId: 'xe-select-v2',
    baseVersionId: 'xe-select-v1',
    revision: 1,
    contentRevision: 1,
    reason: '演示：补充个人贡献的评审要点',
    effect: 'next_selection_cohort',
    basis: confirmedStandardAttributionFixture(),
    aiDraft: {
      origin: 'ai_draft',
      basis: confirmedStandardAttributionFixture(),
      model: standardHypothesisFixture().model,
      changes,
      generatedAt: now,
    },
    humanVersion: {
      origin: 'hr_edited',
      changes: [
        {
          kind: 'add',
          after: {
            ...changes[0].after,
            description:
              '演示：每位成员用可追溯交付材料说明个人贡献，HR 核对后再采用。',
          },
        },
      ],
      editedBy: iterationDemoHr,
      editedAt: now,
    },
    impactPreview: selectionImpactPreviewFixture(),
    state: 'pending_confirmation',
    submittedBy: iterationDemoHr,
    submittedAt: now,
  };
}
export function selectionManagerRevisionFixture(): SelectionManagerRevision {
  const draft = selectionRevisionFixture();
  return {
    id: draft.id,
    category: draft.category,
    versionId: draft.versionId,
    baseVersionId: draft.baseVersionId,
    revision: draft.revision,
    contentRevision: draft.contentRevision,
    reason: draft.reason,
    effect: draft.effect,
    humanVersion: draft.humanVersion,
    impactPreview: draft.impactPreview,
    state: draft.state,
    basis: comparisonManagerFixture().batches,
  };
}
export function selectionPublicationFixture(): SelectionPublicationReceipt {
  return {
    publicationId: 'demo-publication',
    publishedBy: iterationDemoManager,
    publishedAt: now,
    undoUntil: '2026-10-31T10:00:05Z',
    versionId: 'xe-select-v2',
    previousVersionId: 'xe-select-v1',
    revision: 2,
    previewId: 'demo-preview-r1',
    nextCohort: iterationDemoNextCohort,
  };
}
