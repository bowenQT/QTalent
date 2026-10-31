import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export const CONTRACT_SHA = '2fe52fa46a0003762b5090b0d5af97654f7f5b2c';
export const FRONT_DATE = '2026-03-02T01:00:00.000Z';
export const BACK_DATE = '2026-06-12T06:00:00.000Z';
export const FRONT_SCALE = 'demo-xe-select-three-bands-v1';
export const BACK_SCALE = 'demo-xe-graduation-three-bands-v1';
export const cohort = { id: 'b-xe6', name: 'XEngineer 第六期（演示）' };
export const batch = {
  id: 'bow-923-xe6-selection-graduation-v1',
  name: '第六期选拔与结营对照（演示）',
  cohort,
  selectionStandardVersionId: 'xe-select-v1',
  mappingVersionId: 'map-xe-select-v1',
};
export const originals = {
  front: {
    file: '作品评审表.xlsx',
    originalVersionId: 'bow-923-xe6-selection-original-v1',
    sheet: '作品评审（演示）',
    lastColumn: 'P',
    excerptColumn: 'P',
    dateColumn: 'M',
  },
  back: {
    file: '结营评审表.xlsx',
    originalVersionId: 'bow-923-xe6-graduation-original-v1',
    sheet: '结营评审（演示）',
    lastColumn: 'J',
    excerptColumn: 'J',
    dateColumn: 'G',
  },
};
export const frontHeaders = [
  '人员ID',
  '学员（演示）',
  '期次（演示）',
  '作品ID',
  '作品形式',
  '同队标记',
  '作品完整度与创新性（原档位）',
  '开发过程与质量（原档位）',
  '演示与表达（原档位）',
  '选拔原档位',
  '评价人ID',
  '评价人（演示）',
  '评价时间（UTC）',
  '选拔标准版本',
  '记录状态',
  '重建评语（演示）',
];
export const backHeaders = [
  '人员ID',
  '学员（演示）',
  '期次（演示）',
  '结营原档位',
  '评价人ID',
  '评价人（演示）',
  '评价时间（UTC）',
  '结营原量表ID',
  '记录状态',
  '重建评语（演示）',
];

// Authored examples, not an implementation of BOW-919. Every outcome is stated
// explicitly. Authored groups retain AC-Y02's 24 clear judgments (8 different)
// and 54 middle-band cases, with another 15 missing/incomparable controls.
const examples = [
  {
    front: '高分档',
    back: '不建议',
    rater: 'p-yeqing',
    outcome: { state: 'front_higher', bands: 2 },
    team: true,
  },
  {
    front: '刚过线档',
    back: '建议留用',
    rater: 'p-yeqing',
    outcome: { state: 'front_lower', bands: 2 },
  },
  {
    front: '高分档',
    back: '继续观察',
    rater: 'p-yeqing',
    outcome: { state: 'front_higher', bands: 1 },
    team: true,
  },
  {
    front: '中间档',
    back: '不建议',
    rater: 'p-yeqing',
    outcome: { state: 'middle_distribution', backGrade: '不建议' },
  },
  {
    front: '高分档',
    back: '建议留用',
    rater: 'p-yeqing',
    outcome: { state: 'consistent' },
  },
  {
    front: '高分档',
    back: null,
    rater: 'p-yeqing',
    outcome: { state: 'missing', missing: 'back' },
  },
  { front: '高分档', back: '不建议', rater: 'p-yeqing', incomparable: true },
  {
    front: '高分档',
    back: '不建议',
    rater: 's-01',
    outcome: { state: 'front_higher', bands: 2 },
  },
  {
    front: '刚过线档',
    back: '建议留用',
    rater: 's-01',
    outcome: { state: 'front_lower', bands: 2 },
  },
  {
    front: '中间档',
    back: '继续观察',
    rater: 's-01',
    outcome: { state: 'middle_distribution', backGrade: '继续观察' },
  },
  {
    front: '高分档',
    back: '建议留用',
    rater: 's-01',
    outcome: { state: 'consistent' },
  },
  {
    front: '中间档',
    back: null,
    rater: 's-01',
    outcome: { state: 'missing', missing: 'back' },
  },
  { front: '高分档', back: '继续观察', rater: 's-01', incomparable: true },
  {
    front: null,
    back: '继续观察',
    rater: null,
    outcome: { state: 'missing', missing: 'front' },
  },
  {
    front: null,
    back: null,
    rater: null,
    outcome: { state: 'missing', missing: 'both' },
  },
];
examples.push(
  {
    front: '高分档',
    back: '不建议',
    rater: 's-04',
    outcome: { state: 'front_higher', bands: 2 },
  },
  {
    front: '刚过线档',
    back: '建议留用',
    rater: 's-04',
    outcome: { state: 'front_lower', bands: 2 },
  },
  {
    front: '高分档',
    back: '继续观察',
    rater: 's-04',
    outcome: { state: 'front_higher', bands: 1 },
  },
  ...Array.from({ length: 7 }, () => ({
    front: '高分档',
    back: '建议留用',
    rater: 's-04',
    outcome: { state: 'consistent' },
  })),
  ...Array.from({ length: 7 }, () => ({
    front: '刚过线档',
    back: '不建议',
    rater: 's-04',
    outcome: { state: 'consistent' },
  })),
  ...Array.from({ length: 14 }, () => ({
    front: '中间档',
    back: '不建议',
    rater: 's-04',
    outcome: { state: 'middle_distribution', backGrade: '不建议' },
  })),
  ...Array.from({ length: 24 }, () => ({
    front: '中间档',
    back: '继续观察',
    rater: 's-04',
    outcome: { state: 'middle_distribution', backGrade: '继续观察' },
  })),
  ...Array.from({ length: 14 }, () => ({
    front: '中间档',
    back: '建议留用',
    rater: 's-04',
    outcome: { state: 'middle_distribution', backGrade: '建议留用' },
  })),
  ...Array.from({ length: 3 }, () => ({
    front: null,
    back: '继续观察',
    rater: null,
    outcome: { state: 'missing', missing: 'front' },
  })),
  ...Array.from({ length: 3 }, () => ({
    front: '高分档',
    back: null,
    rater: 's-04',
    outcome: { state: 'missing', missing: 'back' },
  })),
  {
    front: null,
    back: null,
    rater: null,
    outcome: { state: 'missing', missing: 'both' },
  },
  ...Array.from({ length: 2 }, () => ({
    front: '高分档',
    back: '继续观察',
    rater: 's-04',
    incomparable: true,
  })),
);
assert.equal(examples.length, 93);

const frontComments = {
  高分档:
    '演示重建：作品主流程完整，能说明一次方案取舍，并现场复现失败后的恢复步骤。',
  中间档: '演示重建：作品可运行，说明了基本实现；异常场景的取舍仍需补充证据。',
  刚过线档:
    '演示重建：完成了最小主流程；评审时未充分展示边界场景，按原档位记录。',
};
const backComments = {
  不建议: '演示重建：营内独立交付多次未闭合，复盘未给出可复现的改进证据。',
  继续观察: '演示重建：能在明确任务下交付，独立拆解与跨环节协作仍需继续观察。',
  建议留用:
    '演示重建：能独立闭合任务，复盘给出可复现步骤，并帮助同伴定位一次故障。',
};

export async function buildScene() {
  const roster = JSON.parse(
    await fs.readFile(new URL('./roster.json', import.meta.url), 'utf8'),
  );
  const actor = (id) => {
    const person = roster.directory.find((entry) => entry.id === id);
    assert(person, `demo evaluator not in directory: ${id}`);
    return person;
  };
  const hr = actor('p-suwan');
  const mapping = {
    versionId: 'map-xe-select-v1',
    frontScaleId: FRONT_SCALE,
    backScaleId: BACK_SCALE,
    rows: [
      { frontGrade: '高分档', frontPosition: 'highest', backGrade: '建议留用' },
      { frontGrade: '中间档', frontPosition: 'middle', backGrade: '继续观察' },
      {
        frontGrade: '刚过线档',
        frontPosition: 'just_passed',
        backGrade: '不建议',
      },
    ],
    confirmedBy: hr,
    confirmedAt: '2026-02-26T01:00:00.000Z',
  };
  const standard = {
    reviewPoints: [
      {
        id: 'work-completeness-innovation',
        title: '作品完整度与创新性',
        description:
          '演示要点：检查可运行的主流程、作品边界与有依据的方案取舍。',
      },
      {
        id: 'development-process-quality',
        title: '开发过程与质量',
        description: '演示要点：检查过程记录、失败恢复与可复现的验证步骤。',
      },
      {
        id: 'demo-expression',
        title: '演示与表达',
        description: '演示要点：说明本人贡献、现场演示过程，并回应具体问题。',
      },
    ],
  };
  const sourceRows = [];
  const frontRows = [];
  const backRows = [];
  const cases = [];
  for (const [index, person] of roster.students.entries()) {
    const example = examples[index];
    assert(
      example,
      'every admitted student must have an explicitly authored scenario',
    );
    const row = index + 2;
    const sequence = String(index + 1).padStart(3, '0');
    const caseId = `bow-923-case-${sequence}`;
    const work = example.team
      ? {
          kind: 'team',
          workId: 'bow-923-team-work-orbit',
          teamId: 'bow-923-team-orbit',
        }
      : { kind: 'individual', workId: `bow-923-work-${sequence}` };
    const frontComment = example.front
      ? frontComments[example.front]
      : '演示重建：缺少入营选拔评审记录，未补造评价或评价人。';
    const backComment = !example.back
      ? '演示重建：缺少结营评审记录，未补造评价或评价人。'
      : example.incomparable
        ? '演示重建：本次仅记录替代课题的演示配合，未评价入营作品所涉任务。'
        : backComments[example.back];
    const frontRater = example.front ? actor(example.rater) : null;
    const backRater = example.back ? actor('s-28') : null;
    const grades = example.front
      ? [
          example.front,
          example.front === '高分档' ? '中间档' : example.front,
          example.front,
        ]
      : [null, null, null];
    frontRows.push([
      person.id,
      person.name,
      cohort.name,
      work.workId,
      work.kind === 'team' ? '组队作品' : '个人作品',
      work.kind === 'team' ? '轨道队（演示）' : null,
      ...grades,
      example.front,
      frontRater?.id ?? null,
      frontRater?.name ?? null,
      example.front ? FRONT_DATE : null,
      'xe-select-v1',
      example.front ? '已确认（演示）' : '缺段',
      frontComment,
    ]);
    backRows.push([
      person.id,
      person.name,
      cohort.name,
      example.back,
      backRater?.id ?? null,
      backRater?.name ?? null,
      example.back ? BACK_DATE : null,
      BACK_SCALE,
      example.back ? '已确认（演示）' : '缺段',
      backComment,
    ]);
    const rows = {};
    for (const side of ['front', 'back']) {
      const original = originals[side];
      const excerpt = side === 'front' ? frontComment : backComment;
      rows[side] = {
        personId: person.id,
        row,
        source: {
          fragmentId: `bow-923-${side}-row-${sequence}`,
          originalVersionId: original.originalVersionId,
          location: {
            kind: 'spreadsheet',
            sheet: original.sheet,
            cell: `A${row}:${original.lastColumn}${row}`,
          },
          excerpt,
          sourceType: 'spreadsheet',
          sourceCategory: 'original',
          demo: true,
        },
      };
    }
    sourceRows.push({
      personId: person.id,
      front: rows.front,
      back: rows.back,
    });
    const stage = (side) => {
      const grade = example[side];
      if (!grade)
        return {
          state: 'missing',
          reason:
            side === 'front'
              ? '缺少入营选拔评审记录（演示）'
              : '缺少结营评审记录（演示）',
        };
      return {
        state: 'present',
        judgment: {
          judgmentId: `bow-923-${side}-judgment-${sequence}`,
          nodeId:
            side === 'front'
              ? 'bow-923-xe6-selection'
              : 'bow-923-xe6-graduation',
          cohortId: cohort.id,
          standardVersionId:
            side === 'front' ? 'xe-select-v1' : 'demo-xe-graduation-v1',
          scaleId: side === 'front' ? FRONT_SCALE : BACK_SCALE,
          grade,
          evaluator: side === 'front' ? frontRater : backRater,
          evaluatedAt: side === 'front' ? FRONT_DATE : BACK_DATE,
          confirmation: 'human_confirmed',
          row: rows[side],
        },
      };
    };
    const outcome = example.incomparable
      ? {
          state: 'not_comparable',
          reason: '两段判断的任务范围不同，由 HR 标注不可比（演示）',
          markedBy: hr,
          markedAt: '2026-06-15T01:00:00.000Z',
        }
      : example.outcome;
    cases.push({
      id: caseId,
      batchId: batch.id,
      person,
      judgment: {
        id: 'bow-923-entry-to-graduation',
        name: '入营选拔与结营评审（演示）',
      },
      cohort,
      selectionStandardVersionId: 'xe-select-v1',
      mappingVersionId: mapping.versionId,
      frontNodeId: 'bow-923-xe6-selection',
      backNodeId: 'bow-923-xe6-graduation',
      work,
      front: stage('front'),
      back: stage('back'),
      outcome,
    });
  }
  assert.equal(cases.length, 93);
  const expected = {
    evidenceStatus: 'expected_only_actual_query_not_run',
    contractSha: CONTRACT_SHA,
    audience: 'hr',
    policy: {
      conclusionScope: 'evaluation_system_only',
      laterStageUse: 'comparison_not_ground_truth',
    },
    batch,
    mapping,
    counts: {
      clear: { consistent: 16, frontHigher: 5, frontLower: 3 },
      middleDistribution: { notRecommended: 15, observe: 25, recommended: 14 },
      excluded: {
        missingFront: 4,
        missingBack: 5,
        missingBoth: 2,
        notComparable: 4,
      },
    },
    controls: {
      people: 93,
      frontPresent: 87,
      backPresent: 86,
      comparable: 78,
      sameTeamPeople: 2,
    },
    raters: [
      {
        evaluator: actor('p-yeqing'),
        sample: {
          state: 'sufficient_sample',
          threshold: 5,
          comparableCaseCount: 5,
          caseIds: cases.slice(0, 5).map(({ id }) => id),
          distribution: {
            clear: { consistent: 1, frontHigher: 2, frontLower: 1 },
            middleDistribution: {
              notRecommended: 1,
              observe: 0,
              recommended: 0,
            },
            excluded: {
              missingFront: 0,
              missingBack: 1,
              missingBoth: 0,
              notComparable: 1,
            },
          },
        },
      },
      {
        evaluator: actor('s-01'),
        sample: {
          state: 'insufficient_sample',
          label: '样本不足',
          threshold: 5,
          comparableCaseCount: 4,
          caseIds: cases.slice(7, 11).map(({ id }) => id),
        },
      },
      {
        evaluator: actor('s-04'),
        sample: {
          state: 'sufficient_sample',
          threshold: 5,
          comparableCaseCount: 69,
          caseIds: cases.slice(15, 84).map(({ id }) => id),
          distribution: {
            clear: { consistent: 14, frontHigher: 2, frontLower: 1 },
            middleDistribution: {
              notRecommended: 14,
              observe: 24,
              recommended: 14,
            },
            excluded: {
              missingFront: 0,
              missingBack: 3,
              missingBoth: 0,
              notComparable: 2,
            },
          },
        },
      },
    ],
    middleBand: {
      countsForMismatch: false,
      countsForComparableThreshold: true,
    },
    attributions: [
      {
        caseId: cases[2].id,
        category: 'person_or_environment',
        demoHumanNote:
          '组队作品的高档位不能替代个人营内表现。此例归因于本人或环境变化，保留标准 v1。',
        changesStandard: false,
      },
    ],
    pending: [
      'actual_demo_database_import',
      'database_repeat_import_deduplication',
      'authorized_original_read_to_both_rows',
      'bow_919_actual_query_matches_expected',
      'prototype_and_script_use_actual_query_counts',
    ],
  };
  const cohortScenarios = {
    demo: true,
    contractSha: CONTRACT_SHA,
    evidenceStatus: 'scenario_only_not_executed',
    fixedBackground: [
      {
        cohort,
        boundSelectionVersionId: 'xe-select-v1',
        mappingVersionId: mapping.versionId,
      },
    ],
    liveScenario: {
      cohort: { id: 'b-xe7-demo', name: 'XEngineer 第七期（演示）' },
      prerequisite:
        '先经有权限的人确认并发布 xe-select-v2，再创建并绑定第七期。',
      beforeCreation: { cohortExists: false, boundVersionId: null },
      expectedAtCreation: { boundSelectionVersionId: 'xe-select-v2' },
      preservedSixthVersionId: 'xe-select-v1',
      execution:
        'pending_bow_922_version_binding_and_published_contract_refresh',
    },
  };
  return {
    roster,
    standard,
    mapping,
    cases,
    sourceRows,
    frontRows,
    backRows,
    expected,
    cohortScenarios,
  };
}
