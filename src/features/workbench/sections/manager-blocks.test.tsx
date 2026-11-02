// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ManagerBlocks, WatchPerson, WorkbenchView } from '../view';
import { testView } from '../test-helpers';
import { Workbench } from '../Workbench';
import { Greeting } from './head/Greeting';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const off = { status: 'not_connected' } as const;
const pending: ManagerBlocks = {
  notes: off,
  watch: off,
  programs: off,
  follows: off,
};
const managerView = (blocks: Partial<ManagerBlocks> = {}): WorkbenchView =>
  testView({
    role: 'manager',
    displayName: '演示管理者',
    manager: { ...pending, ...blocks },
  });
const person = (
  id: string,
  category: WatchPerson['category'],
  extra: Partial<WatchPerson> = {},
): WatchPerson => ({
  id,
  name: `演示${id}`,
  hue: null,
  photo: null,
  title: '后端方向',
  fate: null,
  category,
  brief: `${id} 的入选原因`,
  verifiedBy: null,
  concern: null,
  ...extra,
});

describe('manager home (版本 Y DY-04)', () => {
  it('keeps the three cards in place and says 待接通 while nothing is connected', () => {
    const { container } = render(<Workbench view={managerView()} />);
    const columns = container.querySelector('.nt-ceo')!;
    const [main, side] = columns.children;
    expect(main.id).toBe('watch');
    expect(side.className).toBe('nt-grid');
    expect([...side.children].map((card) => card.id)).toEqual([
      'progs',
      'follows',
    ]);
    for (const title of ['值得关注的人', '值得关注的项目', '我的关注']) {
      expect(
        screen.getByRole('heading', { name: title, level: 3 }),
      ).toBeTruthy();
      expect(screen.getByText(`${title}待接通`)).toBeTruthy();
    }
    expect(container.querySelector('.n-count')).toBeNull();
    expect(container.querySelector('#jsig')).toBeNull();
  });

  it('lists people by rule category with no score, and folds 需要介入 into one line', () => {
    render(
      <Workbench
        view={managerView({
          watch: {
            status: 'ready',
            data: [
              person('a', 'top'),
              person('b', 'top'),
              person('c', 'top', {
                fate: { text: '部门待定', open: true },
              }),
              person('d', 'new', { verifiedBy: '演示 HR' }),
              person('e', 'act', { concern: '未接受 offer' }),
            ],
          },
        })}
      />,
    );
    const card = screen.getByRole('article', { name: /值得关注的人/ });
    expect(within(card).getByText('5 人')).toBeTruthy();
    expect(card.textContent).toContain(
      '1 人需要介入，HR 在跟：演示e（未接受 offer）',
    );
    // 全部: two per group, the rest behind 再看.
    expect(
      within(card)
        .getAllByRole('link', { name: '查看依据' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/person?id=a', '/person?id=b', '/person?id=d']);
    expect(within(card).getByTitle('AI 线索，演示 HR已核实')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: '再看 1 人' }));
    expect(within(card).getByText('部门待定').className).toBe('is-open');
    fireEvent.click(within(card).getByRole('button', { name: '收起' }));
    // One category at a time; 需要介入 lists its own rows.
    fireEvent.click(within(card).getByRole('button', { name: '1 人需要介入' }));
    expect(
      within(card)
        .getAllByRole('link', { name: '查看依据' })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/person?id=e']);
    expect(card.textContent).not.toMatch(/\d(\.\d)? 分|排名|%/);
  });

  it('disables a category nobody is in and says so when a filter is empty', () => {
    render(
      <Workbench
        view={managerView({
          watch: { status: 'ready', data: [person('a', 'new')] },
        })}
      />,
    );
    const filters = screen.getByRole('group', { name: '按类别筛选' });
    expect(
      (
        within(filters).getByRole('button', {
          name: '突出表现',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const empty = render(
      <Workbench
        view={managerView({ watch: { status: 'ready', data: [] } })}
      />,
    );
    expect(empty.getByText('这一类入选的人会出现在这里。')).toBeTruthy();
  });

  it('shows cohorts with their latest stage, notes and follow-up tags', () => {
    render(
      <Workbench
        view={managerView({
          programs: {
            status: 'ready',
            data: [
              {
                id: 'pg-1',
                name: '演示营第一期',
                kind: 'Landing',
                href: '/programs',
                stage: '结营评审',
                notes: ['2 人部门待定'],
                tags: [
                  { text: '3 人新进入值得关注', href: null },
                  { text: '留用与落位 4 人待 HR 确认', href: '/programs' },
                ],
              },
            ],
          },
        })}
      />,
    );
    const card = screen.getByRole('article', { name: /值得关注的项目/ });
    expect(within(card).getByText('1 期')).toBeTruthy();
    expect(
      within(card).getByRole('link', { name: '演示营第一期' }),
    ).toBeTruthy();
    expect(within(card).getByText('结营评审')).toBeTruthy();
    expect(within(card).getByText('2 人部门待定')).toBeTruthy();
    expect(
      within(card).queryByRole('link', { name: '3 人新进入值得关注' }),
    ).toBeNull();
    expect(
      within(card)
        .getByRole('link', { name: '留用与落位 4 人待 HR 确认' })
        .getAttribute('href'),
    ).toBe('/programs');
    cleanup();
    render(
      <Workbench
        view={managerView({ programs: { status: 'ready', data: [] } })}
      />,
    );
    expect(screen.getByText('近两周没有需要留意的期次。')).toBeTruthy();
  });

  it('shows the follow updates first and the list on request; empty states say what to do', () => {
    render(
      <Workbench
        view={managerView({
          follows: {
            status: 'ready',
            data: {
              people: [
                {
                  id: 'f-1',
                  name: '演示甲',
                  hue: null,
                  photo: null,
                  followedOn: '2026-08-20',
                  latest: '09-02 记了一件事',
                },
              ],
              updates: [
                {
                  personId: 'f-1',
                  name: '演示甲',
                  hue: null,
                  photo: null,
                  text: '记了一件事',
                  on: '2026-09-02',
                  kind: '关键事件',
                  by: '演示导师',
                },
              ],
            },
          },
        })}
      />,
    );
    const card = screen.getByRole('article', { name: /我的关注/ });
    expect(within(card).getByText('1 人')).toBeTruthy();
    expect(card.textContent).toContain('09-02 · 关键事件 · 演示导师');
    fireEvent.click(within(card).getByRole('button', { name: '名单' }));
    expect(card.textContent).toContain('08-20 关注 · 最近：09-02 记了一件事');
    cleanup();
    render(
      <Workbench
        view={managerView({
          follows: { status: 'ready', data: { people: [], updates: [] } },
        })}
      />,
    );
    expect(
      screen.getByText(
        '在值得关注或速览里点「加关注」，之后他们的新进展会出现在这里。',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('group', { name: '查看方式' })).toBeNull();
    cleanup();
    render(
      <Workbench
        view={managerView({
          follows: {
            status: 'ready',
            data: {
              people: [
                {
                  id: 'f-1',
                  name: '演示甲',
                  hue: null,
                  photo: null,
                  followedOn: '2026-08-20',
                  latest: null,
                },
              ],
              updates: [],
            },
          },
        })}
      />,
    );
    expect(screen.getByText('关注以来的新进展会出现在这里。')).toBeTruthy();
  });

  it('puts 判断提醒 in the heading only when connected and not empty', () => {
    const { container, rerender } = render(
      <Greeting
        view={managerView({
          notes: {
            status: 'ready',
            data: [
              {
                kind: 'comparison',
                text: '演示营 3 人前后判断不一致',
                href: '/judge',
                detail: '前段偏高 2 人',
              },
              {
                kind: 'revision',
                text: 'XEngineer 入营选拔标准有一条修订待你确认',
                href: '/rules?r=front&line=xe-select',
                detail: null,
              },
            ],
          },
        })}
      />,
    );
    const notes = screen.getByRole('note', { name: '提醒' });
    expect(
      within(notes)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['演示营 3 人前后判断不一致', '/judge'],
      [
        'XEngineer 入营选拔标准有一条修订待你确认',
        '/rules?r=front&line=xe-select',
      ],
    ]);
    expect(
      container.querySelector('.nt-head > div:first-child h1'),
    ).toBeTruthy();
    rerender(
      <Greeting view={managerView({ notes: { status: 'ready', data: [] } })} />,
    );
    expect(screen.queryByRole('note')).toBeNull();
  });
});
