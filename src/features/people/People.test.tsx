// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { People } from './People';
import { peopleList, seeds } from './people-test-data';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/people',
}));
afterEach(cleanup);

const rows = () => [
  ...document.querySelectorAll<HTMLElement>('#plist .n-person-row'),
];
const names = () =>
  rows().map((row) => row.querySelector('.n-person__name')!.textContent);

describe('people list', () => {
  it('HR: header, one tab, teams in order and the reference column', () => {
    render(<People data={peopleList('hr', seeds)} mentor={false} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('人才');
    expect(
      screen.getByText('你能查看的 4 人，按团队和姓名排列。'),
    ).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '人员4',
    ]);
    expect(
      [...document.querySelectorAll('.nt-team')].map(
        (node) => node.textContent,
      ),
    ).toEqual(['演示中心 / 平台组 · 2 人', '演示中心 / 数据组 · 2 人']);
    expect(names()).toEqual([
      '演示学员甲演示',
      '演示学员乙演示',
      '演示学员丙演示',
      '演示学员丁演示',
    ]);
    expect(rows().map((row) => row.lastElementChild!.textContent)).toEqual([
      '参考：待观察',
      '资料不足',
      '参考：双高',
      '暂时无法判断',
    ]);
    expect(rows()[1].querySelector('[title]')!.getAttribute('title')).toBe(
      '潜力轴缺 2 条事件',
    );
    expect(rows()[0].getAttribute('href')).toBe('/person?id=p1');
    expect(screen.getByText(/右侧是系统按已确认分数算的参考位置/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d+ 分|排名|%/);
  });

  it('mentor: 所带学员, the cohort in the header, no position anywhere', () => {
    render(<People data={peopleList('mentor', seeds)} mentor />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '所带学员',
    );
    expect(
      screen.getByText(
        '你在 XEngineer 第六期带的学员，每位学员的全部评价都在档案里。',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('tab').textContent).toBe('学员4');
    expect(document.body.textContent).not.toMatch(/参考|资料不足|双高|待观察/);
    expect(screen.queryByText(/参考位置/)).toBeNull();
  });

  it('filters by text, team and chip, with an empty state', () => {
    render(<People data={peopleList('hr', seeds)} mentor={false} />);
    const search = screen.getByLabelText('按姓名或岗位筛选');
    fireEvent.change(search, { target: { value: '丙' } });
    expect(names()).toEqual(['演示学员丙演示']);
    fireEvent.change(search, { target: { value: '没有这个人' } });
    expect(screen.getByText('换个筛选条件试试。')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('团队'), {
      target: { value: 't-a' },
    });
    expect(names()).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('团队'), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('button', { name: '资料不足' }));
    expect(names()).toEqual(['演示学员乙演示']);
    expect(
      screen
        .getByRole('button', { name: '资料不足' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('says there is no one when the scope is empty, and has no team select for one team', () => {
    const { unmount } = render(
      <People data={peopleList('mentor', [])} mentor />,
    );
    expect(screen.getByText('还没有分给你的学员。')).toBeTruthy();
    expect(screen.queryByLabelText('团队')).toBeNull();
    unmount();
    render(<People data={peopleList('manager', [])} mentor={false} />);
    expect(screen.getByText('你的查看范围里还没有人。')).toBeTruthy();
    expect(screen.queryByText(/参考位置/)).toBeNull();
  });

  it('opens the quick view on click, toggles, and gives focus back on Escape', () => {
    render(<People data={peopleList('hr', seeds)} mentor={false} />);
    const first = rows()[0];
    first.focus();
    fireEvent.click(first);
    const drawer = screen.getByRole('dialog', { name: /演示学员甲/ });
    expect(
      within(drawer).getByText('平台组 · 后端工程师 · 入营 3 个月'),
    ).toBeTruthy();
    expect(
      [...drawer.querySelectorAll('.n-peek__facts li')].map(
        (li) => li.textContent,
      ),
    ).toEqual([
      '09-04需求变更后当天给出两个备选方案演示课题甲 · 演示导师记录',
      '08-20补齐接口文档演示导师记录',
    ]);
    expect(
      within(drawer)
        .getByRole('link', { name: '查看全部' })
        .getAttribute('href'),
    ).toBe('/person?id=p1#timeline');
    expect(drawer.querySelector('.n-peek__caps')!.textContent).toBe(
      '专业度2 件事能独立拆解中等复杂度的需求',
    );
    expect(
      within(drawer).getByText('其余 3 个维度资料不足，补充材料后出分。'),
    ).toBeTruthy();
    expect(
      within(drawer)
        .getByRole('link', { name: '打开档案' })
        .getAttribute('href'),
    ).toBe('/person?id=p1');
    fireEvent.keyDown(document, { key: 'Escape' });
    // The drawer slides out empty; nobody's facts stay on screen.
    expect(screen.queryByRole('dialog', { name: /演示学员甲/ })).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('shows what is not there yet without making up numbers', () => {
    render(<People data={peopleList('hr', seeds)} mentor={false} />);
    fireEvent.click(rows()[1]);
    const drawer = screen.getByRole('dialog', { name: /演示学员乙/ });
    expect(within(drawer).getByText('还没有你能看到的关键事件。')).toBeTruthy();
    expect(within(drawer).getByText('暂无可用的已确认维度分')).toBeTruthy();
    expect(within(drawer).queryByRole('link', { name: '查看全部' })).toBeNull();
    // A second click closes it; a modified click is left to the browser (the profile).
    fireEvent.click(rows()[1]);
    expect(screen.queryByRole('dialog', { name: /演示学员乙/ })).toBeNull();
    fireEvent.click(rows()[2], { metaKey: true });
    expect(screen.queryByRole('dialog', { name: /演示学员丙/ })).toBeNull();
  });
});
