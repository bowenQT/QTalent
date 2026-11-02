import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

export const FIXTURE_VERSION = 'bow-923-v3';
export const CONTRACT_SHA = '832209d177944b5ce18577794acb88314a6460da';
// Prototype Y: selection on 06-30, graduation review on 08-31, Asia/Shanghai.
export const FRONT_DATE = '2026-06-30T01:00:00.000Z';
export const BACK_DATE = '2026-08-31T06:00:00.000Z';
export const MAPPING_DATE = '2026-06-20T01:00:00.000Z';
export const MARK_DATE = '2026-09-02T01:00:00.000Z';
// Owner/orchestrator decision: xe-select-v1 effective 2026-06-15 Asia/Shanghai.
export const STANDARD_EFFECTIVE_FROM = '2026-06-14T16:00:00.000Z';
export const FRONT_SCALE = 'demo-xe-select-three-bands-v1';
export const BACK_SCALE = 'demo-xe-graduation-three-bands-v1';
export const FRONT_NODE = 'xe6-select';
export const BACK_NODE = 'xe6-end';
export const cohort = { id: 'b-xe6', name: 'XEngineer 第六期（演示）' };
export const batch = {
  id: 'bow-923-xe6-selection-graduation-v2',
  name: '第六期选拔与结营对照（演示）',
  cohort,
  selectionStandardVersionId: 'xe-select-v1',
  mappingVersionId: 'map-xe-select-v1',
};
export const originals = {
  front: {
    file: '作品评审表.xlsx',
    originalVersionId: 'bow-923-xe6-selection-original-v2',
    sheet: '作品评审（演示）',
    lastColumn: 'P',
    excerptColumn: 'P',
    dateColumn: 'M',
  },
  back: {
    file: '结营评审表.xlsx',
    originalVersionId: 'bow-923-xe6-graduation-original-v2',
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
export const ITEM_GRADES = ['A', 'B', 'C'];
export const RATER_MIN_CASES = 5;

// Fixture-authored excerpts. Prototype comments are deliberately not copied.
const frontComments = {
  优先录取:
    '演示重建：作品主流程完整，能说明一次方案取舍，并现场复现失败后的恢复步骤。',
  通过: '演示重建：作品可运行，说明了基本实现；异常场景的取舍仍需补充证据。',
  刚过线:
    '演示重建：完成了最小主流程；评审时未充分展示边界场景，按原档位记录。',
};
const teamComment =
  '演示重建：组队作品，三人分工完成整套流程，演示由队长主讲；按同队各自一行记录。';
const backComments = {
  不建议: '演示重建：营内独立交付多次未闭合，复盘未给出可复现的改进证据。',
  继续观察: '演示重建：能在明确任务下交付，独立拆解与跨环节协作仍需继续观察。',
  建议留用:
    '演示重建：能独立闭合任务，复盘给出可复现步骤，并帮助同伴定位一次故障。',
};
const markedBackComment =
  '演示重建：营内转到另一方向的课题，结营评审针对新方向的任务。';
const missingFrontComment =
  '演示重建：第二批次补录入营，没有参加作品评审，未补造评价或评价人。';
const missingBackComment = '演示重建：缺少结营评审记录，未补造评价或评价人。';

const readJson = async (name) =>
  JSON.parse(await fs.readFile(new URL(`./${name}`, import.meta.url), 'utf8'));

/** Same rule as the contract: only the highest/just-passed front band is clear. */
export function outcomeOf(mapping, front, back, mark) {
  // Missing stages win over a human mark, as in the contract calculation.
  if (!front || !back)
    return {
      state: 'missing',
      missing: !front && !back ? 'both' : !front ? 'front' : 'back',
    };
  if (mark)
    return {
      state: 'not_comparable',
      reason: mark.reason,
      markedBy: mark.markedBy,
      markedAt: mark.markedAt,
    };
  const row = mapping.rows.find((entry) => entry.frontGrade === front);
  assert(row, `unmapped front band: ${front}`);
  if (row.frontPosition === 'middle')
    return { state: 'middle_distribution', backGrade: back };
  const rank = (grade) =>
    mapping.rows.findIndex((entry) => entry.backGrade === grade);
  const diff = rank(back) - rank(row.backGrade);
  if (diff === 0) return { state: 'consistent' };
  // Rows run highest → just_passed; a later back row means the front was higher.
  return {
    state: diff > 0 ? 'front_higher' : 'front_lower',
    bands: Math.abs(diff),
  };
}

const emptyDistribution = () => ({
  clear: { consistent: 0, frontHigher: 0, frontLower: 0 },
  middleDistribution: { notRecommended: 0, observe: 0, recommended: 0 },
  excluded: {
    missingFront: 0,
    missingBack: 0,
    missingBoth: 0,
    notComparable: 0,
  },
});
const backKey = {
  不建议: 'notRecommended',
  继续观察: 'observe',
  建议留用: 'recommended',
};
function tally(target, outcome) {
  if (outcome.state === 'consistent') target.clear.consistent++;
  else if (outcome.state === 'front_higher') target.clear.frontHigher++;
  else if (outcome.state === 'front_lower') target.clear.frontLower++;
  else if (outcome.state === 'middle_distribution')
    target.middleDistribution[backKey[outcome.backGrade]]++;
  else if (outcome.state === 'not_comparable') target.excluded.notComparable++;
  else
    target.excluded[
      { front: 'missingFront', back: 'missingBack', both: 'missingBoth' }[
        outcome.missing
      ]
    ]++;
  return target;
}

export async function buildScene() {
  const roster = await readJson('roster.json');
  const prototype = await readJson('prototype-judgments.json');
  assert.equal(roster.provenance.commit, prototype.provenance.commit);
  const actor = (id) => {
    const person = roster.directory.find((entry) => entry.id === id);
    assert(person, `demo evaluator not in directory: ${id}`);
    return person;
  };
  const hr = actor(prototype.dates.mappingConfirmedBy);
  const [justPassed, middle, highest] = prototype.scale.front;
  const [notRecommended, observe, recommended] = prototype.scale.back;
  const mapping = {
    versionId: 'map-xe-select-v1',
    frontScaleId: FRONT_SCALE,
    backScaleId: BACK_SCALE,
    rows: [
      { frontGrade: highest, frontPosition: 'highest', backGrade: recommended },
      { frontGrade: middle, frontPosition: 'middle', backGrade: observe },
      {
        frontGrade: justPassed,
        frontPosition: 'just_passed',
        backGrade: notRecommended,
      },
    ],
    confirmedBy: hr,
    confirmedAt: MAPPING_DATE,
  };
  assert.equal(`${prototype.dates.mapping}T01:00:00.000Z`, MAPPING_DATE);
  assert.equal(`${prototype.dates.front}T01:00:00.000Z`, FRONT_DATE);
  assert.equal(`${prototype.dates.back}T06:00:00.000Z`, BACK_DATE);
  assert.equal(prototype.dates.standardEffective, '2026-06-15');
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
  assert.deepEqual(
    standard.reviewPoints.map(({ title }) => title),
    prototype.scale.items,
  );
  const sequenceOf = (personId) =>
    String(roster.students.findIndex(({ id }) => id === personId) + 1).padStart(
      3,
      '0',
    );
  const marks = prototype.marks.map((mark) => {
    const sequence = sequenceOf(mark.personId);
    return {
      id: `bow-923-hr-mark-${sequence}`,
      nature: 'demo_human_mark',
      caseId: `bow-923-case-${sequence}`,
      batchId: batch.id,
      personId: mark.personId,
      frontNodeId: FRONT_NODE,
      backNodeId: BACK_NODE,
      reason: `${mark.reason}（演示）`,
      markedBy: actor(mark.markedBy),
      markedAt: MARK_DATE,
    };
  });
  assert(prototype.marks.every((mark) => mark.date === MARK_DATE.slice(0, 10)));
  const manualComparability = {
    fixtureVersion: FIXTURE_VERSION,
    demo: true,
    notice:
      '演示 HR 人工不可比标记，取自原型 Y 的判断对照数据；不是两份原表的单元格，也不是对照算法结果或真实历史操作。',
    scenarioProvenance: {
      commit: prototype.provenance.commit,
      path: 'prototype/y/app/js/data.js',
      meaning:
        'JUDGE.marks 里 HR 预先标为不可比的案例；不读取 expected 文件回填。',
    },
    actorAuthority: {
      person: hr,
      role: 'hrbp',
      provenance: {
        commit: prototype.provenance.commit,
        path: 'prototype/y/app/js/data.js',
        blob: prototype.provenance.files.find(
          (file) => file.path === 'prototype/y/app/js/data.js',
        ).blob,
        roleKey: 'ROLES.hrbp',
      },
    },
    marks,
  };

  const teamPeople = prototype.judgments
    .filter(({ front }) => front?.team)
    .map(({ personId }) => personId);
  const sourceRows = [];
  const frontRows = [];
  const backRows = [];
  const cases = [];
  for (const [index, person] of roster.students.entries()) {
    const facts = prototype.judgments[index];
    assert.equal(facts.personId, person.id);
    const row = index + 2;
    const sequence = String(index + 1).padStart(3, '0');
    const caseId = `bow-923-case-${sequence}`;
    const mark = marks.find((entry) => entry.personId === person.id);
    const team = facts.front?.team ? facts.front.team : null;
    const work = team
      ? {
          kind: 'team',
          workId: 'bow-923-team-work-seven',
          teamId: 'bow-923-team-seven',
        }
      : { kind: 'individual', workId: `bow-923-work-${sequence}` };
    const frontGrade = facts.front?.grade ?? null;
    const backGrade = facts.back?.grade ?? null;
    const frontComment = !frontGrade
      ? missingFrontComment
      : team
        ? teamComment
        : frontComments[frontGrade];
    const backComment = !backGrade
      ? missingBackComment
      : mark
        ? markedBackComment
        : backComments[backGrade];
    const frontRater = frontGrade ? actor(facts.front.evaluatorId) : null;
    const backRater = backGrade ? actor(facts.back.evaluatorId) : null;
    assert(
      !frontRater || !backRater || frontRater.id !== backRater.id,
      'one person must not judge both stages',
    );
    const grades = frontGrade ? facts.front.items : [null, null, null];
    assert(
      grades.every((grade) => grade === null || ITEM_GRADES.includes(grade)),
    );
    frontRows.push([
      person.id,
      person.name,
      cohort.name,
      work.workId,
      work.kind === 'team' ? '组队作品' : '个人作品',
      team ? `${team}（演示）` : null,
      ...grades,
      frontGrade,
      frontRater?.id ?? null,
      frontRater?.name ?? null,
      frontGrade ? FRONT_DATE : null,
      'xe-select-v1',
      frontGrade ? '已确认（演示）' : '缺段',
      frontComment,
    ]);
    backRows.push([
      person.id,
      person.name,
      cohort.name,
      backGrade,
      backRater?.id ?? null,
      backRater?.name ?? null,
      backGrade ? BACK_DATE : null,
      BACK_SCALE,
      backGrade ? '已确认（演示）' : '缺段',
      backComment,
    ]);
    const rows = {};
    for (const side of ['front', 'back']) {
      const original = originals[side];
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
          excerpt: side === 'front' ? frontComment : backComment,
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
      const grade = side === 'front' ? frontGrade : backGrade;
      if (!grade)
        return {
          state: 'missing',
          reason:
            side === 'front'
              ? '第二批次补录，没有入营选拔评审记录（演示）'
              : '缺少结营评审记录（演示）',
        };
      return {
        state: 'present',
        judgment: {
          judgmentId: `bow-923-${side}-judgment-${sequence}`,
          nodeId: side === 'front' ? FRONT_NODE : BACK_NODE,
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
      frontNodeId: FRONT_NODE,
      backNodeId: BACK_NODE,
      work,
      front: stage('front'),
      back: stage('back'),
      outcome: outcomeOf(mapping, frontGrade, backGrade, mark),
    });
  }
  assert.equal(cases.length, 93);
  assert.equal(marks.length, prototype.marks.length);

  const counts = cases.reduce(
    (target, unit) => tally(target, unit.outcome),
    emptyDistribution(),
  );
  const comparable = (unit) =>
    !['missing', 'not_comparable'].includes(unit.outcome.state);
  const collator = new Intl.Collator('zh-CN');
  const raterIds = [
    ...new Set(
      cases
        .filter((unit) => unit.front.state === 'present')
        .map((unit) => unit.front.judgment.evaluator.id),
    ),
  ];
  const raters = raterIds
    .map(actor)
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((evaluator) => {
      const sample = cases.filter(
        (unit) =>
          comparable(unit) &&
          unit.front.state === 'present' &&
          unit.front.judgment.evaluator.id === evaluator.id,
      );
      const caseIds = sample.map(({ id }) => id);
      return {
        evaluator,
        sample:
          sample.length >= RATER_MIN_CASES
            ? {
                state: 'sufficient_sample',
                threshold: RATER_MIN_CASES,
                comparableCaseCount: sample.length,
                caseIds,
                distribution: sample.reduce(
                  (target, unit) => tally(target, unit.outcome),
                  emptyDistribution(),
                ),
              }
            : {
                state: 'insufficient_sample',
                label: '样本不足',
                threshold: RATER_MIN_CASES,
                comparableCaseCount: sample.length,
                caseIds,
              },
      };
    });
  const teamCase = cases.find(
    (unit) =>
      unit.work.kind === 'team' && unit.outcome.state === 'front_higher',
  );
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
    counts,
    controls: {
      people: 93,
      frontPresent: cases.filter((unit) => unit.front.state === 'present')
        .length,
      backPresent: cases.filter((unit) => unit.back.state === 'present').length,
      comparable: cases.filter(comparable).length,
      sameTeamPeople: teamPeople.length,
    },
    raters,
    middleBand: {
      countsForMismatch: false,
      countsForComparableThreshold: true,
    },
    attributions: teamCase
      ? [
          {
            caseId: teamCase.id,
            category: 'person_or_environment',
            demoHumanNote:
              '组队作品的高档位不能替代个人营内表现。此例归因于本人或环境变化，保留标准 v1。',
            changesStandard: false,
          },
        ]
      : [],
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
        selectionStandardEffectiveFrom: STANDARD_EFFECTIVE_FROM,
        mappingVersionId: mapping.versionId,
        nodes: { front: FRONT_NODE, back: BACK_NODE },
      },
    ],
    liveScenario: {
      cohort: { id: 'b-xe7-demo', name: 'XEngineer 第七期（演示）' },
      prerequisite:
        '先经有权限的人确认并发布 xe-select-v2，再创建并绑定第七期。',
      schedule:
        '按真实时钟：创建后的下一个周一开营，时长与第六期相同；不固定为历史日期。',
      beforeCreation: { cohortExists: false, boundVersionId: null },
      expectedAtCreation: { boundSelectionVersionId: 'xe-select-v2' },
      preservedSixthVersionId: 'xe-select-v1',
      execution: 'pending_demo_initialization',
    },
  };
  return {
    roster,
    prototype,
    manualComparability,
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
