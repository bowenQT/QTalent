import { describe, expect, it } from 'vitest';
import { fixtures } from '../../../tests/fixtures/p0-contracts';
import {
  QUADRANT,
  QUADRANT_CENTER,
  addDays,
  headerFirstLine,
  headerSecondLine,
  isRecent,
  monthDay,
  monthLabel,
  projectWhen,
  ruleVersions,
  sameSources,
  spectrumGroups,
  timelineMonths,
  topFacts,
  type CapabilityProfile,
  type KeyEvent,
  type TimelineEntry,
} from './person-view';

const { manager, mentor } = fixtures;
if (manager.timeline.status !== 'ready') throw new Error('fixture');
const entries = manager.timeline.data;
const key = entries.find((entry) => entry.kind === 'key_event') as KeyEvent;
const at = (
  entry: TimelineEntry,
  id: string,
  occurredOn: string,
): TimelineEntry => ({ ...entry, id, occurredOn });

describe('dates', () => {
  it('formats month-day and month labels from the date string', () => {
    expect(monthDay('2026-08-07')).toBe('08-07');
    expect(monthLabel('2026-08-07')).toBe('2026 年 8 月');
  });
  it('adds days across month and year boundaries in UTC', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-09-04', -90)).toBe('2026-06-06');
  });
  it('counts the 90th day before asOf as recent, the 91st as earlier', () => {
    expect(isRecent('2026-06-05', '2026-09-04')).toBe(false);
    expect(isRecent('2026-06-06', '2026-09-04')).toBe(true);
    expect(isRecent('2026-06-07', '2026-09-04')).toBe(true);
  });
});

describe('topFacts', () => {
  it('takes confirmed key events only, newest first, at most three', () => {
    const mixed = [
      at(
        entries.find((e) => e.kind === 'history')!,
        'h',
        '2026-09-01',
      ),
      at(
        entries.find((e) => e.kind === 'self_report')!,
        's',
        '2026-09-02',
      ),
      { ...key, id: 'pending', occurredOn: '2026-09-03', pendingScoreCount: 2 },
      { ...key, id: 'zero', occurredOn: '2026-05-01', pendingScoreCount: 0 },
      { ...key, id: 'a', occurredOn: '2026-08-01' },
      { ...key, id: 'b', occurredOn: '2026-08-01' },
      { ...key, id: 'c', occurredOn: '2026-08-20' },
    ];
    expect(topFacts(mixed).map((event) => event.id)).toEqual(['c', 'a', 'b']);
  });
  it('is empty without key events', () => {
    expect(
      topFacts(entries.filter((entry) => entry.kind !== 'key_event')),
    ).toEqual([]);
  });
});

describe('timelineMonths', () => {
  it('groups by month, newest first, and puts last year under 更早', () => {
    const months = timelineMonths(
      [
        at(key, 'old', '2025-12-31'),
        at(key, 'aug-1', '2026-08-01'),
        at(key, 'sep', '2026-09-01'),
        at(key, 'aug-2', '2026-08-28'),
        at(key, 'older', '2024-03-01'),
      ],
      '2026-09-04',
    );
    expect(
      months.map((month) => [
        month.label,
        month.entries.map((entry) => entry.id),
      ]),
    ).toEqual([
      ['2026 年 9 月', ['sep']],
      ['2026 年 8 月', ['aug-2', 'aug-1']],
      ['更早', ['old', 'older']],
    ]);
  });
  it('follows the year of asOf', () => {
    expect(
      timelineMonths([at(key, 'dec', '2026-12-01')], '2027-01-05')[0].label,
    ).toBe('更早');
  });
});

describe('spectrumGroups', () => {
  const score = (
    id: string,
    dimensionId: string,
    value: number,
    occurredOn: string,
  ) => ({
    id,
    dimensionId,
    dimensionLabel: dimensionId,
    status: 'confirmed' as const,
    sourceCategory: 'original' as const,
    value,
    anchor: '锚点',
    scoredByName: '评价人',
    ruleVersionId: id === 's1' ? 'rule-b' : 'rule-a',
    eventId: `e-${id}`,
    eventTitle: `事件 ${id}`,
    occurredOn,
    sources: key.sources,
  });
  const profile: CapabilityProfile = {
    windowFrom: '2025-09-04',
    dimensions: [
      {
        id: 'mot',
        label: '内生动力',
        group: 'potential_core',
        state: 'scored',
      },
      { id: 'prof', label: '专业度', group: 'professional', state: 'scored' },
      {
        id: 'lead',
        label: '领导力',
        group: 'potential_bonus',
        state: 'insufficient',
        missing: '待补带动他人的事件',
      },
    ],
    scores: [
      score('s1', 'prof', 4, '2026-08-01'),
      score('s2', 'prof', 4, '2026-01-01'),
      score('s3', 'prof', 3, '2026-06-06'),
      ...Array.from({ length: 6 }, (_, i) =>
        score(`m${i}`, 'mot', 5, '2026-02-01'),
      ),
    ],
  };
  it('groups in prototype order with the level in the professional title', () => {
    const groups = spectrumGroups(profile, 'P5', '2026-09-04');
    expect(groups.map((group) => group.title)).toEqual([
      '专业度（对标 P5）',
      '潜力 · 核心',
      '潜力 · 加分项',
    ]);
    expect(spectrumGroups(profile, null, '2026-09-04')[0].title).toBe('专业度');
  });
  it('bins each value into earlier and recent by asOf - 90 days', () => {
    const [prof] = spectrumGroups(profile, null, '2026-09-04')[0].dimensions;
    expect(prof).toMatchObject({
      state: 'scored',
      bins: { 4: { earlier: 1, recent: 1 }, 3: { earlier: 0, recent: 1 } },
    });
    if (prof.state !== 'scored') throw new Error('scored');
    expect(prof.events[0]).toEqual({
      value: 4,
      dateLabel: '08-01',
      by: '评价人',
      title: '事件 s1',
      href: '#ev-e-s1',
      recent: true,
    });
  });
  it('lists at most six events and keeps missing dimensions without a score', () => {
    const groups = spectrumGroups(profile, null, '2026-09-04');
    const mot = groups[1].dimensions[0];
    if (mot.state !== 'scored') throw new Error('scored');
    expect(mot.events).toHaveLength(6);
    expect(groups[2].dimensions[0]).toEqual({
      id: 'lead',
      name: '领导力',
      state: 'insufficient',
      missing: '待补带动他人的事件',
    });
  });
  it('drops groups without dimensions', () => {
    expect(
      spectrumGroups(
        { ...profile, dimensions: [profile.dimensions[1]] },
        null,
        '2026-09-04',
      ).map((group) => group.title),
    ).toEqual(['专业度']);
  });
  it('collects the rule versions once, sorted', () => {
    expect(ruleVersions(profile)).toEqual(['rule-a', 'rule-b']);
  });
});

describe('quadrants and projects', () => {
  it('maps every contract quadrant to one 2x2 cell and its centre', () => {
    expect(Object.values(QUADRANT).sort()).toEqual(['hh', 'hl', 'lh', 'll']);
    expect(QUADRANT_CENTER[QUADRANT.high_professional_high_potential]).toEqual({
      x: 0.75,
      y: 0.25,
    });
    expect(QUADRANT_CENTER[QUADRANT.low_professional_low_potential]).toEqual({
      x: 0.25,
      y: 0.75,
    });
  });
  it('writes ongoing and ended participation', () => {
    if (manager.projects.status !== 'ready') throw new Error('fixture');
    expect(manager.projects.data.map(projectWhen)).toEqual([
      '07-01 起',
      '03-01 – 06-30',
    ]);
  });
});

describe('header lines', () => {
  it('joins the facts that exist and skips the missing ones', () => {
    expect(headerFirstLine(manager)).toContain(manager.person.teamPath);
    expect(headerSecondLine(manager)).toContain('课题「演示课题」');
    expect(headerSecondLine(manager)).toContain('导师 演示导师');
    expect(
      headerSecondLine({
        ...mentor,
        person: { ...mentor.person, tenureLabel: null, batch: null },
        landing: null,
      }),
    ).toBe('');
    expect(
      headerSecondLine({
        ...mentor,
        landing: { topicName: null, mentorNames: [] },
      }),
    ).not.toMatch(/课题|导师/);
  });
});

describe('sameSources', () => {
  const a = { fragmentId: 'f1', originalVersionId: 'v1' };
  const b = { fragmentId: 'f2', originalVersionId: 'v1' };
  it('compares sources as sets', () => {
    expect(sameSources([a, b], [b, a])).toBe(true);
    expect(sameSources([a], [b])).toBe(false);
  });
});
