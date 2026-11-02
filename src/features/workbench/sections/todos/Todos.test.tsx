// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TodosView, VerifyItem } from '../../view';
import { testView } from '../../test-helpers';
import { Workbench } from '../../Workbench';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const off = { status: 'not_connected' } as const;
const verifyItem = (id: string, kind: VerifyItem['kind']): VerifyItem => ({
  id,
  kind,
  question: `演示核对问题 ${id}`,
  source: '演示材料.docx',
  location: '第 2 段',
  deferred: id === 'v-4',
  href: `/inbox#${id}`,
});
const allKinds: TodosView['verify'] = {
  status: 'ready',
  data: [
    verifyItem('v-1', 'speaker'),
    verifyItem('v-2', 'unknown_person'),
    verifyItem('v-3', 'image_scope'),
    verifyItem('v-4', 'unknown_interviewer'),
  ],
};
const conclusion: TodosView['conclusion'] = {
  status: 'ready',
  data: [
    {
      id: 'c-1',
      nodeName: '转正答辩',
      personName: '演示甲',
      waitingJudges: ['演示评委乙', '演示评委丙'],
      href: '/program-actions?node=n-1#c-1',
    },
    {
      id: 'c-2',
      nodeName: '转正答辩',
      personName: '演示丁',
      waitingJudges: [],
      href: '/program-actions?node=n-1#c-2',
    },
  ],
};
const reassign = (
  items: number,
  evaluators: (string | null)[],
): TodosView['reassign'] => ({ status: 'ready', data: { items, evaluators } });
const hr = (todos: TodosView) => testView({ todos });

describe('HR to-dos', () => {
  it('lists the connected groups in prototype order, the first one open', () => {
    const { container } = render(
      <Workbench
        view={hr({
          verify: allKinds,
          conclusion,
          reassign: reassign(3, ['演示原评价人']),
        })}
      />,
    );
    const card = container.querySelector('.nt-cols > #todo')!;
    expect(card.querySelector('h3')?.textContent).toBe('待办7');
    const heads = [...card.querySelectorAll('.n-todogrp__head')];
    expect(heads.map((head) => head.getAttribute('aria-expanded'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(heads[0].textContent).toBe('待核对4');
    // Each of the four kinds has its own row and entry.
    const rows = [...card.querySelectorAll('.n-todo li a')];
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      '/inbox#v-1',
      '/inbox#v-2',
      '/inbox#v-3',
      '/inbox#v-4',
    ]);
    expect(rows[3].textContent).toBe(
      '待核对演示核对问题 v-4演示材料.docx · 第 2 段 · 已选稍后处理稍后',
    );
    // Closed groups show their first row and how many more.
    expect(heads[1].querySelector('small')?.textContent).toBe(
      '转正答辩 · 演示甲的结论待你确认 等',
    );
    expect(heads[2].querySelector('small')?.textContent).toBe(
      '演示原评价人的评价关系已结束：3 件事待接手',
    );
  });

  it('opens one group at a time with the keyboard-reachable heading button', () => {
    render(
      <Workbench
        view={hr({
          verify: allKinds,
          conclusion,
          reassign: reassign(2, ['演示乙', null]),
        })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^节点结论/ }));
    const links = screen.getAllByRole('link', { name: /结论待你确认/ });
    expect(links.map((link) => link.textContent)).toEqual([
      '节点结论转正答辩 · 演示甲的结论待你确认等演示评委乙、演示评委丙确认本人评分本人确认',
      '节点结论转正答辩 · 演示丁的结论待你确认评委都已确认本人评分本人确认',
    ]);
    expect(screen.queryByRole('link', { name: /演示核对问题/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^待重新分派/ }));
    const handover = screen.getByRole('link', { name: /件事待接手/ });
    expect(handover.getAttribute('href')).toBe('/work/reassign');
    expect(handover.textContent).toContain(
      '2 位评价人的评价关系已结束：2 件事待接手',
    );
  });

  it('shows no total while a group is not connected, and omits that group', () => {
    const { container } = render(
      <Workbench
        view={hr({
          verify: off,
          conclusion: off,
          reassign: reassign(1, [null]),
        })}
      />,
    );
    expect(container.querySelector('#todo h3')?.textContent).toBe('待办');
    expect(
      [...container.querySelectorAll('.n-todogrp__head')].map(
        (head) => head.textContent,
      ),
    ).toEqual(['待重新分派1']);
    expect(
      screen.getByRole('link', { name: /原评价人的评价关系已结束/ }),
    ).toBeTruthy();
  });

  it('renders no card while the connected groups are empty and others are unknown', () => {
    const { container } = render(
      <Workbench
        view={hr({ verify: off, conclusion: off, reassign: reassign(0, []) })}
      />,
    );
    expect(container.querySelector('#todo')).toBeNull();
    // The column stays for the materials cards, with nothing in the to-do slot.
    expect(
      container.querySelector('.nt-cols')!.firstElementChild!.childElementCount,
    ).toBe(0);
    expect(container.textContent).not.toContain('待办');
  });

  it('says everything is done only when every group is connected and empty', () => {
    render(
      <Workbench
        view={hr({
          verify: { status: 'ready', data: [] },
          conclusion: { status: 'ready', data: [] },
          reassign: reassign(0, []),
        })}
      />,
    );
    expect(screen.getByText('待办都处理完了')).toBeTruthy();
    expect(document.querySelector('#todo .n-count')).toBeNull();
  });
});
