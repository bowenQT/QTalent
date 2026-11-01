// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { fixtures } from '../../../tests/fixtures/p0-contracts';
import type { TraineeView, WorkbenchView } from './view';
import { toWorkbenchView } from './view';
import { testView } from './test-helpers';
import { Workbench } from './Workbench';
import { Greeting } from './sections/head/Greeting';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const trainee = (id: string, name: string): TraineeView => ({
  id,
  name,
  hue: null,
  photo: null,
  topic: '口语搭子 · 一组',
  activity: {
    status: 'ready',
    data: { recordedThisWeek: 0, lastRecordedOn: '2026-08-28' },
  },
});
const mentorView = (overrides: Partial<WorkbenchView> = {}) =>
  testView({
    role: 'mentor',
    displayName: '演示导师',
    entries: { record: true, findPeople: false },
    trainees: {
      status: 'ready',
      data: [trainee('p-2', '演示乙'), trainee('p-1', '演示甲')],
    },
    ...overrides,
  });
const options = { accountId: 'a', namedExamples: false };
// Blocks not connected yet: none of their titles may appear (BOW-867 and later
// cards update this list when they connect a block). The materials section (BOW-861)
// is drawn without a backend and says 待接入 instead; see its own tests.
const notConnected = [
  '值得关注的人',
  '值得关注的项目',
  '我的关注',
  '有变化的人',
  '判断对照',
  '待办',
  '我的推荐',
];
function expectNoPlaceholders(container: HTMLElement) {
  const text = container.textContent ?? '';
  for (const title of notConnected) expect(text).not.toContain(title);
  expect(container.querySelector('[data-nav-count]')).toBeNull();
  expect(text).not.toMatch(/(^|\D)0 (人|个|期|条)/);
  for (const count of container.querySelectorAll('.n-count'))
    expect(count.textContent).not.toMatch(/^0/);
}

describe('Workbench registry', () => {
  it('manager: greeting and find box only; no columns while nothing is connected', () => {
    const { container } = render(
      <Workbench view={testView({ role: 'manager' })} />,
    );
    expect(
      [...container.children].map((node) => node.className || node.tagName),
    ).toEqual(['nt-head', 'n-find is-pop']);
    expect(
      screen.queryByRole('textbox', { name: '描述你要做的事' }),
    ).toBeNull();
    expectNoPlaceholders(container);
  });

  it('HR: greeting, composer, slash menu, examples and materials, in prototype order', () => {
    const { container } = render(<Workbench view={testView()} />);
    expect([...container.children].map((node) => node.className)).toEqual([
      'nt-head',
      'n-composer',
      'n-slash',
      'n-asks',
      'nt-cols',
    ]);
    // No to-dos: the empty main column holds its place, materials are on the side.
    const [main, side] = container.querySelector('.nt-cols')!.children;
    expect(main.childElementCount).toBe(0);
    expect(
      [...side.querySelectorAll('h3')].map((title) => title.textContent),
    ).toEqual(['进行中的任务', '上传材料']);
    expect(
      screen.getByRole('link', { name: '上传材料' }).getAttribute('href'),
    ).toBe('#upload');
    expectNoPlaceholders(container);
  });

  it('mentor: students in the left grid, materials folded in the right grid', () => {
    const { container } = render(<Workbench view={mentorView()} />);
    const columns = container.querySelector('.nt-ceo')!;
    expect([...columns.children].map((node) => node.className)).toEqual([
      'nt-grid',
      'nt-grid',
    ]);
    expect(columns.children[0].querySelector('#students')).toBeTruthy();
    expect(columns.children[1].querySelector('details#fold')).toBeTruthy();
    expect(columns.children[1].childElementCount).toBe(1);
    expect(columns.previousElementSibling?.className).toBe('n-asks');
    expect(container.textContent).not.toContain('推荐');
    expectNoPlaceholders(container);
  });

  it('renders the contract fixtures as authorized by their entries', () => {
    const [manager, hr, mentor] = fixtures.workbench.map((data) =>
      toWorkbenchView(data, options),
    );
    const managerPage = render(<Workbench view={manager} />);
    expect(screen.getByRole('region', { name: '找人' })).toBeTruthy();
    managerPage.unmount();
    // HR records and finds people; every to-do group is not connected: no to-do card.
    const hrPage = render(<Workbench view={hr} />);
    expect(hrPage.container.querySelectorAll('header, textarea')).toHaveLength(
      2,
    );
    expectNoPlaceholders(hrPage.container);
    hrPage.unmount();
    const mentorPage = render(<Workbench view={mentor} />);
    const rows = screen.getAllByRole('listitem');
    expect(
      within(rows[0]).getByRole('link', { name: '演示测试甲' }),
    ).toBeTruthy();
    expect(rows.map((row) => row.querySelector('small')?.textContent)).toEqual([
      '演示课题 · 本周记了 2 件 · 最近 09-03',
      '本周待记',
      '演示课题',
    ]);
    expectNoPlaceholders(mentorPage.container);
  });

  it('follows every entries combination', () => {
    const combos = [
      { record: false, findPeople: false },
      { record: false, findPeople: true },
      { record: true, findPeople: false },
      { record: true, findPeople: true },
    ];
    for (const entries of combos) {
      for (const role of ['manager', 'hr'] as const) {
        const { container, unmount } = render(
          <Workbench view={testView({ role, entries })} />,
        );
        expect(Boolean(container.querySelector('.n-find'))).toBe(
          role === 'manager' && entries.findPeople,
        );
        expect(
          Boolean(
            container.querySelector('#composer.n-composer:not(.is-hero)'),
          ),
        ).toBe(role === 'hr' && entries.record);
        const commands = [...container.querySelectorAll('.n-slash__item')].map(
          (item) => item.getAttribute('href'),
        );
        expect(commands).toEqual(
          role === 'hr' && entries.record
            ? ['/record', ...(entries.findPeople ? ['/staffing?new=1'] : [])]
            : [],
        );
        unmount();
      }
    }
  });
});

describe('Greeting', () => {
  it('renders a neutral greeting on the server, then the local time of day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 4, 15, 0));
    const view = testView({ displayName: '苏晚' });
    expect(renderToString(<Greeting view={view} />)).toContain('你好，苏晚');
    render(<Greeting view={view} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '下午好，苏晚',
    );
  });

  it('adds the scope only for managers and no date line without a business day', () => {
    const { rerender, container } = render(
      <Greeting view={testView({ role: 'manager' })} />,
    );
    expect(container.querySelector('p')?.textContent).toBe(
      '9 月 4 日 · 周五 · 全部人才项目',
    );
    rerender(<Greeting view={testView({ role: 'mentor' })} />);
    expect(container.querySelector('p')?.textContent).toBe('9 月 4 日 · 周五');
    rerender(<Greeting view={testView({ asOf: null })} />);
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('Students', () => {
  it('keeps the read order, links each name to the profile and records per person', () => {
    render(<Workbench view={mentorView()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('b')?.textContent)).toEqual([
      '演示乙',
      '演示甲',
    ]);
    expect(
      within(rows[0])
        .getByRole('link', { name: '演示乙' })
        .getAttribute('href'),
    ).toBe('/person?id=p-2');
    expect(
      within(rows[0])
        .getByRole('link', { name: '记一件事' })
        .getAttribute('href'),
    ).toBe('/record?person=p-2');
    expect(rows[0].querySelector('small')?.textContent).toBe(
      '口语搭子 · 一组 · 本周待记 · 最近 08-28',
    );
    expect(screen.getByText('2 人')).toBeTruthy();
  });

  it('has no record button without record', () => {
    render(
      <Workbench
        view={mentorView({ entries: { record: false, findPeople: false } })}
      />,
    );
    expect(screen.queryByRole('link', { name: '记一件事' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says why when there is no list, without a count', () => {
    const cases = [
      [{ status: 'empty' }, '分配给你的学员会出现在这里。'],
      [
        { status: 'insufficient_evidence', reason: '分配记录不足' },
        '分配记录不足',
      ],
      [
        { status: 'unknown', reason: '学员名单暂时无法确定' },
        '学员名单暂时无法确定',
      ],
    ] as const;
    for (const [trainees, text] of cases) {
      const { container, unmount } = render(
        <Workbench view={mentorView({ trainees })} />,
      );
      expect(container.querySelector('.nt-empty')?.textContent).toBe(text);
      expect(container.querySelector('#students .n-count')).toBeNull();
      expect(screen.getByText(/每件事按情境、行为、影响记下来/)).toBeTruthy();
      unmount();
    }
  });
});
