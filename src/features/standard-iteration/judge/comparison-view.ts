import type {
  ComparisonMapping,
  ComparisonRaterPage,
} from '@/contracts/judgment-comparison';
import { stage } from '../copy';

/** A case as any audience may receive it; a withheld stage hides its outcome too. */
export type DisplayCase = ComparisonRaterPage['cases'][number];
export type DisplayOutcome = DisplayCase['outcome'];
export type RaterSample = ComparisonRaterPage['sample'];
export type JudgeState = 'same' | 'high' | 'low' | 'mid' | 'nc' | 'na' | 'deny';

const gapText = ['', '一档', '两档'] as const;
const backGrades = ['建议留用', '继续观察', '不建议'] as const;

export function outcomeState(outcome: DisplayOutcome): JudgeState {
  switch (outcome.state) {
    case 'consistent':
      return 'same';
    case 'front_higher':
      return 'high';
    case 'front_lower':
      return 'low';
    case 'middle_distribution':
      return 'mid';
    case 'not_comparable':
      return 'nc';
    case 'missing':
      return 'na';
    case 'withheld':
      return 'deny';
  }
}

export function outcomeText(outcome: DisplayOutcome): string {
  switch (outcome.state) {
    case 'consistent':
      return '一致';
    case 'front_higher':
      return `前段偏高 · 高${gapText[outcome.bands]}`;
    case 'front_lower':
      return `前段偏低 · 低${gapText[outcome.bands]}`;
    case 'middle_distribution':
      return '中间档';
    case 'not_comparable':
      return '不可比';
    case 'missing':
      return '资料不足';
    case 'withheld':
      return '无权限';
  }
}

/**
 * Column in the five-column distribution, left 前段低两档+ to right 前段高两档+.
 * Middle grades, excluded and withheld cases carry no direction: they stay off it.
 */
export function outcomeColumn(outcome: DisplayOutcome): number | null {
  if (outcome.state === 'consistent') return 2;
  if (outcome.state === 'front_higher') return outcome.bands === 2 ? 4 : 3;
  if (outcome.state === 'front_lower') return outcome.bands === 2 ? 0 : 1;
  return null;
}

export type Tally = {
  same: number;
  high: number;
  low: number;
  /** Middle-grade cases by the later stage's grade. */
  mid: Record<(typeof backGrades)[number], number>;
  nc: number;
  na: number;
  deny: number;
};

export function tally(cases: readonly DisplayCase[]): Tally {
  const result: Tally = {
    same: 0,
    high: 0,
    low: 0,
    mid: { 建议留用: 0, 继续观察: 0, 不建议: 0 },
    nc: 0,
    na: 0,
    deny: 0,
  };
  for (const { outcome } of cases) {
    if (outcome.state === 'middle_distribution')
      result.mid[outcome.backGrade]++;
    else {
      const key = outcomeState(outcome);
      if (key !== 'mid') result[key]++;
    }
  }
  return result;
}

const midTotal = (t: Tally) => backGrades.reduce((n, g) => n + t.mid[g], 0);
const midBackText = (t: Tally) =>
  backGrades
    .filter((grade) => t.mid[grade])
    .map((grade) => `${grade} ${t.mid[grade]}`);

export const middleGrade = (mapping: ComparisonMapping) =>
  mapping.rows.find((row) => row.frontPosition === 'middle')?.frontGrade ?? '';

/** One judgment's summary sentence (prototype tallyText, grade scale). */
export function tallyText(
  cases: readonly DisplayCase[],
  mapping: ComparisonMapping,
): string {
  const t = tally(cases);
  const clear = t.same + t.high + t.low;
  const diff = t.high + t.low;
  const mid = midTotal(t);
  if (!clear && !mid) return `${cases.length} 人的判断都标为不可比或资料不足`;
  const parts = [
    t.high && `${t.high} 人前段偏高`,
    t.low && `${t.low} 人前段偏低`,
  ].filter(Boolean);
  const clearText = diff
    ? `${diff} 人前后判断不一致（${parts.join('、')}）`
    : '前后判断都一致';
  const midText = mid
    ? `；前段在中间档「${middleGrade(mapping)}」的 ${mid} 人，${stage.back}${midBackText(t).join('、')}`
    : '';
  return `前段评为最高或最低一档的 ${clear} 人里，${clearText}${midText}`;
}

export function restText(cases: readonly DisplayCase[]): string {
  const t = tally(cases);
  return [t.nc && `不可比 ${t.nc}`, t.na && `资料不足 ${t.na}`]
    .filter(Boolean)
    .join(' · ');
}

/** Grades the front stage gave, highest first; flags a narrow spread for attribution. */
export function frontSpread(
  cases: readonly DisplayCase[],
  mapping: ComparisonMapping,
): string {
  const grades = cases.flatMap(({ front }) =>
    front.state === 'present' ? [front.judgment.grade] : [],
  );
  if (!grades.length) return '';
  const order = ['highest', 'middle', 'just_passed'] as const;
  const counts = order
    .map((position) =>
      mapping.rows.find((row) => row.frontPosition === position),
    )
    .flatMap((row) => (row ? [row.frontGrade] : []))
    .map((grade) => [grade, grades.filter((g) => g === grade).length] as const)
    .filter(([, n]) => n);
  const top = Math.max(...counts.map(([, n]) => n), 0);
  const narrow = grades.length >= 6 && top / grades.length >= 0.75;
  return `${stage.front} ${counts.map(([g, n]) => `${g} ${n}`).join(' · ')}${narrow ? ' · 区分度低' : ''}`;
}

/** Who entered the comparison and why the others did not (one row per person). */
export function scopeLine(cases: readonly DisplayCase[]): string {
  const people = new Map<string, DisplayCase[]>();
  for (const unit of cases)
    people.set(unit.person.id, [...(people.get(unit.person.id) ?? []), unit]);
  const groups = [...people.values()];
  if (!groups.length) return '';
  const has = (units: DisplayCase[], test: (o: DisplayOutcome) => boolean) =>
    units.some((unit) => test(unit.outcome));
  const comparable = groups.filter((units) =>
    has(
      units,
      (o) => outcomeColumn(o) !== null || o.state === 'middle_distribution',
    ),
  ).length;
  const rest = groups.filter(
    (units) =>
      !has(
        units,
        (o) => outcomeColumn(o) !== null || o.state === 'middle_distribution',
      ),
  );
  const both = rest.filter((units) =>
    has(units, (o) => o.state === 'missing' && o.missing === 'both'),
  ).length;
  const nc = rest.filter((units) =>
    has(units, (o) => o.state === 'not_comparable'),
  ).length;
  const one = rest.length - both - nc;
  return [
    `共 ${groups.length} 人，${comparable} 人进入对照`,
    one > 0 && `另有 ${one} 人缺少${stage.front}或${stage.back}的判断`,
    both > 0 && `${both} 人两段的判断都待补`,
    nc > 0 && `${nc} 人标为不可比`,
  ]
    .filter(Boolean)
    .join('；');
}

export type JudgmentGroup = { id: string; name: string; cases: DisplayCase[] };

export function groupByJudgment(
  cases: readonly DisplayCase[],
): JudgmentGroup[] {
  const groups = new Map<string, JudgmentGroup>();
  for (const unit of cases) {
    const group = groups.get(unit.judgment.id) ?? {
      id: unit.judgment.id,
      name: unit.judgment.name,
      cases: [],
    };
    group.cases.push(unit);
    groups.set(unit.judgment.id, group);
  }
  return [...groups.values()];
}

const caseOrder: JudgeState[] = [
  'high',
  'low',
  'nc',
  'mid',
  'same',
  'na',
  'deny',
];
const byName = new Intl.Collator('zh-CN');

/** Cases to read first: disagreements, then the rest, by name within a state. */
export function sortCases(cases: readonly DisplayCase[]): DisplayCase[] {
  return cases
    .slice()
    .sort(
      (a, b) =>
        caseOrder.indexOf(outcomeState(a.outcome)) -
          caseOrder.indexOf(outcomeState(b.outcome)) ||
        byName.compare(a.person.name, b.person.name),
    );
}

/** One row of the mapping table: front grade ↔ back grade, lowest first. */
export function mappingText(mapping: ComparisonMapping): string {
  return (['just_passed', 'middle', 'highest'] as const)
    .map((position) => mapping.rows.find((r) => r.frontPosition === position))
    .flatMap((row) => (row ? [`${row.frontGrade} ↔ ${row.backGrade}`] : []))
    .join('；');
}

/** The rater card's second line: a count of disagreements, or 样本不足 with cases only. */
export function raterLine(sample: RaterSample): string {
  if (sample.state === 'insufficient_sample')
    return `只有 ${sample.comparableCaseCount} 个可对照案例（门槛 ${sample.threshold} 个），只列案例`;
  const { consistent, frontHigher, frontLower } = sample.distribution.clear;
  return [
    frontHigher && `前段偏高 ${frontHigher}`,
    frontLower && `前段偏低 ${frontLower}`,
    consistent && `一致 ${consistent}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The sample card on a rater page. Withheld stages add nothing to it. */
export function sampleSummary(
  sample: RaterSample,
  cases: readonly DisplayCase[],
): string {
  if (sample.state === 'insufficient_sample')
    return `样本不足：可对照案例 ${sample.comparableCaseCount} 个（含中间档），门槛 ${sample.threshold} 个。下面列出案例。`;
  const { clear, middleDistribution } = sample.distribution;
  const clearTotal = clear.consistent + clear.frontHigher + clear.frontLower;
  const parts = [
    clear.frontHigher && `前段偏高 ${clear.frontHigher} 个`,
    clear.frontLower && `前段偏低 ${clear.frontLower} 个`,
    clear.consistent && `一致 ${clear.consistent} 个`,
  ].filter(Boolean);
  const mid: [string, number][] = [
    ['建议留用', middleDistribution.recommended],
    ['继续观察', middleDistribution.observe],
    ['不建议', middleDistribution.notRecommended],
  ];
  const midCount = mid.reduce((n, [, k]) => n + k, 0);
  const midText = midCount
    ? `中间档 ${midCount} 个，只看结营结论：${mid
        .filter(([, k]) => k)
        .map(([g, k]) => `${g} ${k}`)
        .join(' · ')}。`
    : '';
  const shown = new Set(sample.caseIds);
  const byJudgment = groupByJudgment(
    cases.filter(
      (unit) => shown.has(unit.id) && outcomeColumn(unit.outcome) !== null,
    ),
  )
    .map(({ name, cases: units }) => {
      const high = units.filter(
        (u) => u.outcome.state === 'front_higher',
      ).length;
      return `${name} ${units.length} 个${high ? `里 ${high} 个前段偏高` : ''}`;
    })
    .join('；');
  return `前段给了最高或最低一档的 ${clearTotal} 个里，${parts.join('，') || '待结营结论'}。${midText}${byJudgment}`;
}

/** The grades this rater gave in the front stage, highest first. */
export function gradeLine(
  who: string,
  cases: readonly DisplayCase[],
  mapping: ComparisonMapping | null,
): string {
  const grades = cases.flatMap(({ front }) =>
    front.state === 'present' ? [front.judgment.grade] : [],
  );
  const order = mapping
    ? (['highest', 'middle', 'just_passed'] as const).flatMap((position) => {
        const row = mapping.rows.find((r) => r.frontPosition === position);
        return row ? [row.frontGrade] : [];
      })
    : [...new Set(grades)];
  const line = order
    .map((grade) => [grade, grades.filter((g) => g === grade).length] as const)
    .filter(([, n]) => n)
    .map(([grade, n]) => `${grade} ${n}`)
    .join(' · ');
  return line ? `${who}给出的等级：${line}。` : '';
}

/** Cases outside the sample on a rater page: excluded, or a stage outside the relation. */
export function restLine(cases: readonly DisplayCase[]): string {
  const t = tally(cases);
  const denied = (side: 'front' | 'back') =>
    cases.filter((unit) => unit[side].state === 'withheld').length;
  const parts = [
    t.nc + t.na && `${t.nc + t.na} 个是不可比或资料不足`,
    denied('front') && `${denied('front')} 个前段无权限`,
    denied('back') && `${denied('back')} 个后段无权限`,
  ].filter(Boolean);
  return parts.length ? `另有 ${parts.join('；')}。` : '';
}
