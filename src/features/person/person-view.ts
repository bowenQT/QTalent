import type { Person } from '@/contracts/person';
import type { Quadrant } from '@/components/ui/MiniQuad';
import type { ScoreValue } from '@/components/ui/Score';
import type {
  SpectrumDimension,
  SpectrumEvent,
  SpectrumGroup,
} from '@/components/ui/Spectrum';

type Ready<B> =
  Extract<B, { status: 'ready' }> extends { data: infer D } ? D : never;
export type TimelineEntry = Ready<Person['timeline']>[number];
export type KeyEvent = Extract<TimelineEntry, { kind: 'key_event' }>;
export type EventScore = KeyEvent['scores'][number];
export type CapabilityProfile = Ready<Person['capabilityProfile']>;
export type ProjectParticipation = Ready<Person['projects']>[number];
type ManagerPerson = Extract<Person, { role: 'manager' | 'hr' }>;
export type ReferenceQuadrant = Ready<
  ManagerPerson['referencePosition']
>['quadrant'];

/** 日期一律是 `YYYY-MM-DD` 串：按串截取与比较，不经客户端时区。 */
export const monthDay = (day: string) => day.slice(5);
export const monthLabel = (day: string) =>
  `${day.slice(0, 4)} 年 ${Number(day.slice(5, 7))} 月`;

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 原型的「近 3 个月」：发生在 asOf 前 90 天当天及之后。 */
export const isRecent = (day: string, asOf: string) =>
  day >= addDays(asOf, -90);

const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const newestFirst = (a: TimelineEntry, b: TimelineEntry) =>
  byCodePoint(b.occurredOn, a.occurredOn) || byCodePoint(a.id, b.id);

/**
 * 「关键事件与证据」的前 3 条：只取关键事件（不含本人自述、历史资料），排除还有待确认
 * AI 建议分的事件（原型 person.js:42），按发生日期倒序。
 */
export function topFacts(entries: readonly TimelineEntry[]): KeyEvent[] {
  return entries
    .filter(
      (entry): entry is KeyEvent =>
        entry.kind === 'key_event' && !entry.pendingScoreCount,
    )
    .sort(newestFirst)
    .slice(0, 3);
}

export type TimelineMonth = { label: string; entries: TimelineEntry[] };

/** 按月分组、倒序；早于 asOf 所在年 1 月 1 日的归「更早」。 */
export function timelineMonths(
  entries: readonly TimelineEntry[],
  asOf: string,
): TimelineMonth[] {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const months: TimelineMonth[] = [];
  for (const entry of [...entries].sort(newestFirst)) {
    const label =
      entry.occurredOn < yearStart ? '更早' : monthLabel(entry.occurredOn);
    const last = months[months.length - 1];
    if (last?.label === label) last.entries.push(entry);
    else months.push({ label, entries: [entry] });
  }
  return months;
}

const GROUPS: readonly [
  CapabilityProfile['dimensions'][number]['group'],
  (level: string | null) => string,
][] = [
  ['professional', (level) => (level ? `专业度（对标 ${level}）` : '专业度')],
  ['potential_core', () => '潜力 · 核心'],
  ['potential_bonus', () => '潜力 · 加分项'],
];
/** 原型展开一行最多列 6 条事件分，余下在时间线里看。 */
const LISTED = 6;

/**
 * 能力谱的分组与分箱。窗口由服务端切好，这里只做「近 3 个月」二分；每个维度只有
 * 自己的分布与条数，不跨维度汇总。
 */
export function spectrumGroups(
  profile: CapabilityProfile,
  level: string | null,
  asOf: string,
): SpectrumGroup[] {
  return GROUPS.flatMap(([group, title]) => {
    const dimensions = profile.dimensions
      .filter((dimension) => dimension.group === group)
      .map((dimension): SpectrumDimension => {
        if (dimension.state === 'insufficient')
          return {
            id: dimension.id,
            name: dimension.label,
            state: 'insufficient',
            missing: dimension.missing ?? '',
          };
        const scores = profile.scores.filter(
          (score) => score.dimensionId === dimension.id,
        );
        const bins: Partial<
          Record<ScoreValue, { earlier: number; recent: number }>
        > = {};
        const events: SpectrumEvent[] = [];
        for (const score of scores) {
          const value = score.value as ScoreValue;
          const recent = isRecent(score.occurredOn, asOf);
          const bin = (bins[value] ??= { earlier: 0, recent: 0 });
          if (recent) bin.recent += 1;
          else bin.earlier += 1;
          if (events.length < LISTED)
            events.push({
              value,
              dateLabel: monthDay(score.occurredOn),
              by: score.scoredByName,
              title: score.eventTitle,
              href: `#ev-${score.eventId}`,
              recent,
            });
        }
        return {
          id: dimension.id,
          name: dimension.label,
          state: 'scored',
          bins,
          events,
        };
      });
    return dimensions.length ? [{ title: title(level), dimensions }] : [];
  });
}

/** 能力谱里这些分各自保存时的规则版本，只放进 title 供追溯，不上界面。 */
export const ruleVersions = (profile: CapabilityProfile) =>
  [...new Set(profile.scores.map((score) => score.ruleVersionId))].sort(
    byCodePoint,
  );

export const QUADRANT: Record<ReferenceQuadrant, Quadrant> = {
  high_professional_high_potential: 'hh',
  low_professional_high_potential: 'hl',
  high_professional_low_potential: 'lh',
  low_professional_low_potential: 'll',
};
/**
 * 参考点画在所在象限的中心：契约没有坐标，2×2 里不画像精确位置的点。
 * x 随专业度增大，y 向下增大（高潜力在上）。
 */
export const QUADRANT_CENTER: Record<Quadrant, { x: number; y: number }> = {
  hh: { x: 0.75, y: 0.25 },
  hl: { x: 0.25, y: 0.25 },
  lh: { x: 0.75, y: 0.75 },
  ll: { x: 0.25, y: 0.75 },
};

export const projectWhen = (project: ProjectParticipation) =>
  project.to
    ? `${monthDay(project.from)} – ${monthDay(project.to)}`
    : `${monthDay(project.from)} 起`;

/** 头部第二行：入营 / 入职时长 · 批次 · 课题 · 导师，缺的段省略。 */
export function headerSecondLine(person: Person): string {
  const { tenureLabel, batch } = person.person;
  const landing = person.landing;
  return [
    tenureLabel,
    batch?.name,
    landing?.topicName ? `课题「${landing.topicName}」` : null,
    landing?.mentorNames.length
      ? `导师 ${landing.mentorNames.join('、')}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function headerFirstLine(person: Person): string {
  const { teamPath, jobTitle, level } = person.person;
  return [teamPath, jobTitle, level].filter(Boolean).join(' · ');
}

/** 事件卡标题上的引用与某个分自己的引用是同一组时，分数行不再重复画角标。 */
export function sameSources(
  a: readonly { fragmentId: string; originalVersionId: string }[],
  b: readonly { fragmentId: string; originalVersionId: string }[],
): boolean {
  const key = (list: typeof a) =>
    list
      .map((x) => `${x.fragmentId}\u0000${x.originalVersionId}`)
      .sort()
      .join('\u0001');
  return key(a) === key(b);
}
