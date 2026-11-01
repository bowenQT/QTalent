import { describe, expect, it } from 'vitest';
import { quadrantNames } from '@/components/ui/MiniQuad';
import {
  allTeams,
  groups,
  kinds,
  monthDay,
  onlyBatch,
  quadrantKey,
  reference,
  rowMeta,
  teams,
  visible,
  type Filter,
} from './people-view';
import { peopleList, seeds } from './people-test-data';

const hr = peopleList('hr', seeds);
const mentor = peopleList('mentor', seeds);
const ids = (people: { person: { id: string } }[]) =>
  people.map((view) => view.person.id);
const filter = (change: Partial<Filter>): Filter => ({
  query: '',
  teamId: allTeams,
  kind: 'all',
  ...change,
});

describe('people view', () => {
  it('names the four quadrants the prototype way (potential first)', () => {
    expect(
      Object.fromEntries(
        Object.entries(quadrantKey).map(([key, value]) => [
          key,
          quadrantNames[value],
        ]),
      ),
    ).toEqual({
      high_professional_high_potential: '双高',
      low_professional_high_potential: '高潜待练',
      high_professional_low_potential: '专业骨干',
      low_professional_low_potential: '待观察',
    });
  });

  it('keeps the server order and groups teams without re-sorting', () => {
    expect(ids(visible(hr.people, filter({})))).toEqual([
      'p1',
      'p2',
      'p3',
      'p4',
    ]);
    expect(
      groups(hr.people).map((group) => [group.teamPath, ids(group.people)]),
    ).toEqual([
      ['演示中心 / 平台组', ['p1', 'p2']],
      ['演示中心 / 数据组', ['p3', 'p4']],
    ]);
    expect(teams(hr.people)).toEqual([
      { id: 't-a', name: '平台组' },
      { id: 't-b', name: '数据组' },
    ]);
  });

  it('filters by name or job title, team, cohort and 资料不足 only', () => {
    expect(ids(visible(hr.people, filter({ query: ' 乙 ' })))).toEqual(['p2']);
    expect(ids(visible(hr.people, filter({ query: '后端' })))).toHaveLength(4);
    expect(ids(visible(hr.people, filter({ teamId: 't-b' })))).toEqual([
      'p3',
      'p4',
    ]);
    expect(ids(visible(hr.people, filter({ kind: 'batch' })))).toEqual([
      'p1',
      'p3',
    ]);
    // 「暂时无法判断」 is not 资料不足 and is not treated as missing material.
    expect(ids(visible(hr.people, filter({ kind: 'insufficient' })))).toEqual([
      'p2',
    ]);
    expect(
      ids(visible(mentor.people, filter({ kind: 'insufficient' }))),
    ).toEqual([]);
  });

  it('offers chips by what the list carries', () => {
    expect(kinds(hr).map((kind) => kind.label)).toEqual([
      '全部',
      '第六期学员',
      '资料不足',
    ]);
    expect(kinds(mentor).map((kind) => kind.label)).toEqual([
      '全部',
      '第六期学员',
    ]);
    const mixed = peopleList('hr', [
      seeds[0],
      { ...seeds[2], batch: 'XEngineer 第七期' },
    ]);
    expect(onlyBatch(mixed.people)).toBeNull();
    expect(kinds(mixed)[1].label).toBe('训练营学员');
    expect(kinds(peopleList('hr', [seeds[1]])).map((k) => k.value)).toEqual([
      'all',
      'insufficient',
    ]);
  });

  it('writes row facts and leaves out a missing project count', () => {
    expect(hr.people.map(rowMeta)).toEqual([
      '后端工程师 · P5 · 在 1 个项目 · XEngineer 第六期',
      '后端工程师 · P5 · 参与过 2 个项目',
      '后端工程师 · P5 · XEngineer 第六期',
      '后端工程师 · P5',
    ]);
  });

  it('gives managers and HR the reference position, mentors none', () => {
    expect(hr.people.map(reference)).toEqual([
      { state: 'placed', quadrant: 'll', label: '待观察' },
      { state: 'insufficient', reason: '潜力轴缺 2 条事件' },
      { state: 'placed', quadrant: 'hh', label: '双高' },
      { state: 'unknown', reason: '评价规则正在切换' },
    ]);
    expect(mentor.people.map(reference)).toEqual([null, null, null, null]);
    expect(monthDay('2026-09-04')).toBe('09-04');
  });
});
