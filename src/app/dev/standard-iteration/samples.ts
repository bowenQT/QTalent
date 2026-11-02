import {
  COMPARISON_RATER_MIN_CASES,
  type ComparisonCase,
  type ComparisonHrPage,
  type ComparisonManagerPage,
  type ComparisonMapping,
  type ComparisonRaterPage,
} from '@/contracts/judgment-comparison';
import type {
  EffectiveRuleVersion,
  SelectionImpactPreview,
  SelectionReviewPointChange,
} from '@/contracts/selection-standard';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '@/contracts/standard-attribution';
import type { ShellData } from '@/contracts/shell';
import type { SelectionStandardContent } from '@/features/standard-iteration/ports';

/*
 * Development samples for comparing 判断对照 and 入营选拔标准修订 with prototype Y
 * while their reads and actions (BOW-918/919/921) are not on main. Every person is
 * a demo pseudonym, every quote synthetic; the pages parse these through the
 * BOW-917 schemas. Never a fallback for /judge or /rules.
 */
export const sampleHr = { id: 'p-suwan', name: '苏晚' };
export const sampleManager = { id: 'p-chengyuan', name: '程远' };
const graduationRater = { id: 's-29', name: '孟砚舟' };
export const sampleRaters = {
  gu: { id: 's-21', name: '谷牧野' },
  he: { id: 's-22', name: '贺云舒' },
  xu: { id: 's-01', name: '许致远' },
  ye: { id: 's-28', name: '叶青' },
} as const;
export type SampleRaterKey = keyof typeof sampleRaters;

const cohort = { id: 'pg-xe6', name: 'XEngineer 第六期' };
export const nextCohort = { id: 'pg-xe7', name: 'XEngineer 第七期' };
const judgment = { id: 'overall', name: '综合判断' };
const at = (day: string) => `2026-${day}T02:00:00Z`;

export const sampleMapping: ComparisonMapping = {
  versionId: 'map-xe-select-v1',
  frontScaleId: 'xe-selection-three-grades',
  backScaleId: 'xe-graduation-three-grades',
  rows: [
    { frontGrade: '优先录取', frontPosition: 'highest', backGrade: '建议留用' },
    { frontGrade: '通过', frontPosition: 'middle', backGrade: '继续观察' },
    { frontGrade: '刚过线', frontPosition: 'just_passed', backGrade: '不建议' },
  ],
  confirmedBy: sampleHr,
  confirmedAt: at('06-20'),
};

export const sampleBatch: ComparisonHrPage['batch'] = {
  id: 'jr-xe6',
  name: 'XEngineer 第六期判断对照',
  cohort,
  selectionStandardVersionId: 'xe-select-v1',
  mappingVersionId: sampleMapping.versionId,
};

const frontNote: Record<string, string> = {
  优先录取: '作品主流程完整，有一处自己的设计；路演讲清了整体架构（演示）',
  通过: '作品能跑通主要场景，细节待打磨（演示）',
  刚过线: '作品完成了基础功能，路演追问时说明较少（演示）',
};
const backNote: Record<string, string> = {
  建议留用: '课题按期交付，能独立推进（演示）',
  继续观察: '课题完成一半，推进节奏待提升（演示）',
  不建议: '课题交付延后，本人负责的部分较少（演示）',
};

type Grade = '优先录取' | '通过' | '刚过线';
type Back = '建议留用' | '继续观察' | '不建议';
type Row = [
  person: string,
  rater: SampleRaterKey,
  front: Grade | null,
  back: Back | null,
  extra?: 'team' | 'not_comparable',
];

// Who the 入营选拔 rater was and both stages' grades; outcomes follow the mapping.
const rows: Row[] = [
  ['余景行', 'xu', '优先录取', '不建议'],
  ['谢怀瑾', 'xu', '优先录取', '不建议'],
  ['杜一舟', 'xu', '优先录取', '继续观察'],
  ['罗慕白', 'xu', '优先录取', '不建议'],
  ['谷时雨', 'xu', '优先录取', '建议留用'],
  ['唐宁', 'xu', '通过', '建议留用'],
  ['韩笑', 'xu', '刚过线', '不建议'],
  ['沈亦初', 'ye', '优先录取', '不建议', 'team'],
  ['季叙白', 'ye', '优先录取', '不建议', 'team'],
  ['周初晴', 'ye', '优先录取', '继续观察', 'team'],
  ['方景深', 'ye', '通过', '继续观察'],
  ['孟逸尘', 'ye', '刚过线', '继续观察'],
  ['季思齐', 'ye', '刚过线', '不建议'],
  ['孟映雪', 'ye', '优先录取', '建议留用'],
  ['谷嘉树', 'he', '优先录取', '建议留用'],
  ['沈承宇', 'he', '刚过线', '建议留用'],
  ['云致远', 'he', '通过', '不建议'],
  ['乔木', 'he', '刚过线', '不建议'],
  ['池雨', 'he', '优先录取', '建议留用'],
  ['白露', 'he', '通过', '继续观察'],
  ['魏然', 'he', '优先录取', null],
  ['萧然', 'gu', '优先录取', '建议留用'],
  ['夏至', 'gu', '通过', '建议留用'],
  ['林溪', 'gu', '刚过线', '继续观察'],
  ['苏禾', 'gu', '优先录取', '不建议', 'not_comparable'],
  ['庄白', 'gu', '刚过线', '不建议'],
  ['宁远', 'gu', null, null],
];

const order: Back[] = ['建议留用', '继续观察', '不建议'];
function outcomeOf(
  front: Grade | null,
  back: Back | null,
  extra: Row[4],
): ComparisonCase['outcome'] {
  if (!front || !back)
    return {
      state: 'missing',
      missing: !front && !back ? 'both' : !front ? 'front' : 'back',
    };
  if (extra === 'not_comparable')
    return {
      state: 'not_comparable',
      reason: '入营后从全栈组转到前端方向，选拔作品和营内课题考的是不同方向',
      markedBy: sampleHr,
      markedAt: at('09-02'),
    };
  const row = sampleMapping.rows.find((r) => r.frontGrade === front)!;
  if (row.frontPosition === 'middle')
    return { state: 'middle_distribution', backGrade: back };
  const gap = order.indexOf(back) - order.indexOf(row.backGrade);
  if (gap === 0) return { state: 'consistent' };
  return {
    state: gap > 0 ? 'front_higher' : 'front_lower',
    bands: Math.abs(gap) as 1 | 2,
  };
}

function stageOf(
  side: 'front' | 'back',
  index: number,
  personId: string,
  grade: string | null,
  rater: { id: string; name: string },
): ComparisonCase['front'] {
  if (!grade)
    return {
      state: 'missing',
      reason:
        side === 'front' ? '作品评审表待补这一行' : '结营评审表待补这一行',
    };
  const front = side === 'front';
  const row = index + 2;
  return {
    state: 'present',
    judgment: {
      judgmentId: `${side}-${personId}`,
      nodeId: front ? 'xe6-selection' : 'xe6-graduation',
      cohortId: cohort.id,
      standardVersionId: front ? 'xe-select-v1' : 'xe-graduation-v1',
      scaleId: front ? sampleMapping.frontScaleId : sampleMapping.backScaleId,
      grade,
      evaluator: rater,
      evaluatedAt: at(front ? '06-30' : '08-31'),
      confirmation: 'human_confirmed',
      row: {
        personId,
        row,
        source: {
          fragmentId: `${side}-row-${row}`,
          originalVersionId: front
            ? 'xe6-selection-sheet-v1'
            : 'xe6-graduation-sheet-v1',
          location: {
            kind: 'spreadsheet',
            sheet: front ? '第六期入营选拔' : '第六期结营评审',
            cell: front ? `D${row}:H${row}` : `E${row}:F${row}`,
          },
          excerpt: `${front ? '选拔档位' : '综合判断'} ${grade}：${(front ? frontNote : backNote)[grade]}`,
          sourceType: 'spreadsheet',
          originalTitle: front ? '作品评审表.xlsx' : '结营评审表.xlsx',
          recordedByName: null,
          sourceCategory: 'original',
          demo: true,
        },
      },
    },
  };
}

export const sampleCases: ComparisonCase[] = rows.map(
  ([name, rater, front, back, extra], index) => {
    const personId = `p-x${String(index + 1).padStart(2, '0')}`;
    return {
      id: `jr-xe6:${personId}:overall`,
      batchId: sampleBatch.id,
      person: { id: personId, name },
      judgment,
      cohort,
      selectionStandardVersionId: 'xe-select-v1',
      mappingVersionId: sampleMapping.versionId,
      frontNodeId: 'xe6-selection',
      backNodeId: 'xe6-graduation',
      work:
        extra === 'team'
          ? { kind: 'team', workId: 'work-team-7', teamId: 'team-7' }
          : { kind: 'individual', workId: `work-${personId}` },
      front: stageOf('front', index, personId, front, sampleRaters[rater]),
      back: stageOf('back', index, personId, back, graduationRater),
      outcome: outcomeOf(front, back, extra),
    };
  },
);

type Counts = ComparisonHrPage['counts'];
const emptyCounts = (): Counts => ({
  clear: { consistent: 0, frontHigher: 0, frontLower: 0 },
  middleDistribution: { notRecommended: 0, observe: 0, recommended: 0 },
  excluded: {
    missingFront: 0,
    missingBack: 0,
    missingBoth: 0,
    notComparable: 0,
  },
});
function count(cases: readonly { outcome: ComparisonCase['outcome'] }[]) {
  const counts = emptyCounts();
  const mid = {
    不建议: 'notRecommended',
    继续观察: 'observe',
    建议留用: 'recommended',
  } as const;
  for (const { outcome } of cases) {
    if (outcome.state === 'consistent') counts.clear.consistent++;
    else if (outcome.state === 'front_higher') counts.clear.frontHigher++;
    else if (outcome.state === 'front_lower') counts.clear.frontLower++;
    else if (outcome.state === 'middle_distribution')
      counts.middleDistribution[mid[outcome.backGrade]]++;
    else if (outcome.state === 'not_comparable')
      counts.excluded.notComparable++;
    else if (outcome.state === 'missing')
      counts.excluded[
        outcome.missing === 'front'
          ? 'missingFront'
          : outcome.missing === 'back'
            ? 'missingBack'
            : 'missingBoth'
      ]++;
  }
  return counts;
}
const comparable = (outcome: { state: string }) =>
  !['missing', 'not_comparable', 'withheld'].includes(outcome.state);
function sampleOf(
  cases: readonly {
    id: string;
    outcome: ComparisonCase['outcome'] | { state: 'withheld' };
  }[],
): ComparisonRaterPage['sample'] {
  const units = cases.filter((unit) => comparable(unit.outcome)) as {
    id: string;
    outcome: ComparisonCase['outcome'];
  }[];
  const caseIds = units.map((unit) => unit.id);
  return units.length < COMPARISON_RATER_MIN_CASES
    ? {
        state: 'insufficient_sample',
        label: '样本不足',
        threshold: COMPARISON_RATER_MIN_CASES,
        comparableCaseCount: units.length,
        caseIds,
      }
    : {
        state: 'sufficient_sample',
        threshold: COMPARISON_RATER_MIN_CASES,
        comparableCaseCount: units.length,
        caseIds,
        distribution: { ...count(units), excluded: emptyCounts().excluded },
      };
}
const frontRater = (unit: ComparisonCase) =>
  unit.front.state === 'present' ? unit.front.judgment.evaluator.id : null;

export const sampleHrPage: ComparisonHrPage = {
  audience: 'hr',
  policy: {
    conclusionScope: 'evaluation_system_only',
    laterStageUse: 'comparison_not_ground_truth',
  },
  batch: sampleBatch,
  mapping: sampleMapping,
  counts: count(sampleCases),
  cases: sampleCases,
  // Name order, as the server returns it (zh-CN).
  raters: [
    sampleRaters.gu,
    sampleRaters.he,
    sampleRaters.xu,
    sampleRaters.ye,
  ].map((evaluator) => ({
    evaluator,
    sample: sampleOf(
      sampleCases.filter((unit) => frontRater(unit) === evaluator.id),
    ),
  })),
};

/** The rater's own view: the 结营评审 relation ended for the team cases. */
export function sampleRaterPage(key: SampleRaterKey): ComparisonRaterPage {
  const rater = sampleRaters[key];
  const cases: ComparisonRaterPage['cases'] = sampleCases
    .filter((unit) => frontRater(unit) === rater.id)
    .map((unit) =>
      unit.work.kind === 'team' && unit.person.name !== '沈亦初'
        ? {
            ...unit,
            back: { state: 'withheld' },
            outcome: { state: 'withheld' },
          }
        : unit,
    );
  return {
    audience: 'rater',
    viewerId: rater.id,
    policy: sampleHrPage.policy,
    cases,
    sample: sampleOf(cases),
  };
}

const discrepancy = sampleCases.filter((unit) =>
  ['front_higher', 'front_lower'].includes(unit.outcome.state),
).length;
export function sampleManagerPage(
  categories: ComparisonManagerPage['batches'][number]['attributionCategories'],
): ComparisonManagerPage {
  return {
    audience: 'manager',
    policy: sampleHrPage.policy,
    batches: [
      {
        batch: sampleBatch,
        discrepancyPeople: discrepancy,
        attributionCategories: categories,
      },
    ],
  };
}

const citeFront = (name: string) => {
  const unit = sampleCases.find((item) => item.person.name === name)!;
  if (unit.front.state !== 'present')
    throw new Error(`${name} has no front stage`);
  return {
    caseId: unit.id,
    side: 'front' as const,
    nodeId: unit.front.judgment.nodeId,
    standardVersionId: unit.front.judgment.standardVersionId,
    row: unit.front.judgment.row,
  };
};
const model = {
  service: 'demo',
  model: 'demo-model',
  promptVersion: 'attribution-v1',
};

export const sampleHypotheses: StandardAttributionHypothesis[] = [
  {
    id: 'hyp-xe6-1',
    batchId: sampleBatch.id,
    origin: 'ai_hypothesis',
    text: '入营选拔评为「优先录取」、有结营结论的 13 人里，5 人结营不建议。这几位的评审记录多写作品成品，较少写本人做了哪部分；xe-select-v1 只要求三项各评 A / B / C，没有写每一档要看到什么。',
    categories: ['evaluation_standard'],
    citations: ['余景行', '谢怀瑾', '罗慕白', '沈亦初', '季叙白'].map(
      citeFront,
    ),
    model,
    generatedAt: at('09-02'),
  },
  {
    id: 'hyp-xe6-2',
    batchId: sampleBatch.id,
    origin: 'ai_hypothesis',
    text: '许致远评审的 7 个可对照案例里，4 个前段偏高，方向一致；评语多写作品完成度，较少写路演交流中追问的结果。样本达到 5 个案例的门槛。',
    categories: ['evaluator'],
    citations: ['余景行', '谢怀瑾', '杜一舟', '罗慕白'].map(citeFront),
    model,
    generatedAt: at('09-02'),
  },
  {
    id: 'hyp-xe6-3',
    batchId: sampleBatch.id,
    origin: 'ai_hypothesis',
    text: '七号队是组队作品，三位成员的选拔档位都是优先录取。入营后分到不同课题，结营时 2 人不建议、1 人继续观察：作品档位反映的是团队，个人在营内的表现要另看。',
    categories: ['person_or_environment'],
    citations: ['沈亦初', '季叙白', '周初晴'].map(citeFront),
    model,
    generatedAt: at('09-02'),
  },
];

export const sampleAttribution: ConfirmedStandardAttribution = {
  id: 'attr-xe6-1',
  revision: 1,
  batchId: sampleBatch.id,
  origin: 'human_conclusion',
  hypothesisId: 'hyp-xe6-1',
  categories: ['evaluation_standard'],
  rationale:
    '优先录取一档只看作品成品，组队和个人分不开；先在选拔标准里写清每一档要看到本人做了哪部分，下一期按新标准选拔。',
  citations: sampleHypotheses[0].citations,
  confirmedBy: sampleHr,
  confirmedAt: at('09-03'),
};

export const sampleStandard: SelectionStandardContent = {
  reviewPoints: [
    {
      id: 'work',
      title: '作品完整度与创新性',
      description: '看 72 小时作品的完成度和自己的设计，评 A / B / C',
    },
    {
      id: 'process',
      title: '开发过程与质量',
      description: '看开发过程和代码质量，评 A / B / C',
    },
    {
      id: 'demo',
      title: '演示与表达',
      description: '看演示和路演交流，评 A / B / C',
    },
    {
      id: 'grade',
      title: '选拔档位',
      description: '路演交流后给选拔档位：优先录取 / 通过 / 刚过线',
    },
  ],
};
export const sampleStandardVersion: EffectiveRuleVersion = {
  category: 'xe_selection',
  versionId: 'xe-select-v1',
  provenance: 'demo_import_snapshot',
  effectiveFrom: at('06-15'),
  effectiveUntil: null,
};

export const sampleAiChanges: SelectionReviewPointChange[] = [
  {
    kind: 'edit',
    before: sampleStandard.reviewPoints[1],
    after: {
      ...sampleStandard.reviewPoints[1],
      description:
        '看开发过程和代码质量，评 A / B / C；每一档写清要看到本人做了哪部分',
    },
  },
  {
    kind: 'add',
    after: {
      id: 'individual',
      title: '个人贡献核验',
      description: '组队作品里每位成员说明本人做了哪部分，评审按本人部分给档位',
    },
  },
];

export function samplePreview(
  contentRevision: number,
  generatedAt: string,
): SelectionImpactPreview {
  return {
    id: `preview-xe-select-v2-${contentRevision}`,
    contentRevision,
    generatedAt,
    nextCohort,
    newStandardVersionId: 'xe-select-v2',
    existingResults: [
      { cohortId: cohort.id, standardVersionId: 'xe-select-v1', count: 83 },
    ],
    preservedBindings: [
      { cohort, standardVersionId: 'xe-select-v1', boundAt: at('06-15') },
    ],
    existingResultsPolicy: 'preserve_original_version',
    recomputeHistoricalResults: false,
    nextComparisonGrouping: 'selection_standard_version',
  };
}

export type SampleRole = 'hr' | 'manager' | 'rater';
const roleLines: Record<SampleRole, [string, string, string, number]> = {
  hr: ['苏晚', 'HR', '人才项目：XEngineer、Landing、校招、黑客松', 28],
  manager: ['程远', '管理者', '公司层：看人、找人，确认规则与方案', 210],
  rater: ['叶青', '导师', '分镜工厂 · 二组、口语搭子 · 一组的学员', 150],
};
const nav = {
  work: {
    id: 'work',
    label: '工作台',
    href: '/work',
    icon: 'home',
    group: null,
  },
  people: {
    id: 'people',
    label: '人才',
    href: '/people',
    icon: 'users',
    group: '人',
  },
  review: {
    id: 'review',
    label: '盘点',
    href: '/reviews',
    icon: 'layers',
    group: '人',
  },
  queue: {
    id: 'queue',
    label: '评分复核',
    href: '/queue',
    icon: 'check2',
    group: '人',
  },
  programs: {
    id: 'programs',
    label: '人才项目',
    href: '/programs',
    icon: 'book',
    group: '项目',
  },
  projects: {
    id: 'projects',
    label: '项目与课题',
    href: '/projects',
    icon: 'folder',
    group: '项目',
  },
  rules: {
    id: 'rules',
    label: '人才评价规则',
    href: '/rules',
    icon: 'grid',
    group: '规则',
  },
  judge: {
    id: 'judge',
    label: '我的判断对照',
    href: '/judge?rater=me',
    icon: 'swap',
    group: '规则',
  },
  tags: {
    id: 'tags',
    label: '标签库',
    href: '/tags',
    icon: 'tag',
    group: '规则',
  },
} as const;

export function sampleShell(role: SampleRole): ShellData {
  const [name, roleLabel, scopeLabel, hue] = roleLines[role];
  return {
    account: {
      id: `sample-${role}`,
      name,
      email: `${role}@sample.test`,
      roles: [role === 'rater' ? 'mentor' : role],
      hue,
      roleLabel,
      scopeLabel,
    },
    navigation:
      role === 'hr'
        ? [
            nav.work,
            nav.people,
            nav.review,
            nav.queue,
            nav.programs,
            nav.projects,
            nav.rules,
            nav.tags,
          ]
        : role === 'manager'
          ? [
              nav.work,
              nav.people,
              nav.review,
              nav.programs,
              nav.projects,
              nav.rules,
            ]
          : [nav.work, nav.people, nav.programs, nav.projects, nav.judge],
    counts: { status: 'not_connected' },
    recent: { status: 'not_connected' },
    canSearch: false,
    isAdmin: false,
    role: role === 'rater' ? 'mentor' : role,
  };
}
