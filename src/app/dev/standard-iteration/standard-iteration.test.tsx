// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { ShellTitleProvider } from '@/features/shell/ShellTitle';
import StandardIterationSample from './page';
import {
  SampleStandardIteration,
  sampleHref,
  type SampleQuery,
} from './SampleStandardIteration';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dev/standard-iteration',
  notFound: () => {
    throw new Error('not-found');
  },
}));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: () => true };
});

beforeEach(() => {
  sessionStorage.clear();
  push.mockReset();
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const query = (patch: Partial<SampleQuery>): SampleQuery => ({
  role: 'hr',
  view: 'judge',
  rater: null,
  seed: 'fresh',
  ai: 'ok',
  ...patch,
});
const walk = (patch: Partial<SampleQuery>) =>
  render(
    <ShellTitleProvider>
      <ToastProvider>
        <SampleStandardIteration query={query(patch)} />
      </ToastProvider>
    </ShellTitleProvider>,
  );
const slow = { timeout: 3000 };

describe('dev sample route', () => {
  it('answers 404 in production and for an unknown role', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      StandardIterationSample({
        searchParams: Promise.resolve({ role: 'hr' }),
      }),
    ).rejects.toThrow('not-found');
    vi.stubEnv('NODE_ENV', 'development');
    await expect(
      StandardIterationSample({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('not-found');
  });

  it('parses the query into a sample walk inside the shell', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const page = await StandardIterationSample({
      searchParams: Promise.resolve({
        role: 'rater',
        view: 'judge',
        rater: 'nobody',
        seed: 'bogus',
        ai: 'bogus',
      }),
    });
    const sample = (page.props as { children: { props: { query: unknown } } })
      .children.props.query;
    expect(sample).toEqual({
      role: 'rater',
      view: 'judge',
      rater: null,
      seed: null,
      ai: 'ok',
    });
    expect(sampleHref({ role: 'hr', view: 'standard' })).toBe(
      '/dev/standard-iteration?role=hr&view=standard',
    );
  });
});

describe('HR: 判断对照 → 归因 → 起草', () => {
  it('opens a judgment row and focuses the case a hypothesis cites', async () => {
    walk({});
    const heading = await screen.findByRole('heading', {
      name: 'XEngineer 第六期判断对照',
    });
    expect(heading).toBeTruthy();
    const row = screen.getByRole('button', { name: /^综合判断：/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('judge-case').length).toBeGreaterThan(5);
    fireEvent.click(row);
    expect(screen.queryAllByTestId('judge-case')).toHaveLength(0);

    const chip = within(
      document.querySelector('[data-hyp="hyp-xe6-2"]') as HTMLElement,
    ).getAllByRole('button', { name: /综合判断$/ })[0];
    fireEvent.click(chip);
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled(),
    );
    expect(row.getAttribute('aria-expanded')).toBe('true');
    // The rater card links to each rater's own comparison; no ranking or rate.
    const raters = screen.getByRole('link', { name: /许致远/ });
    expect(raters.getAttribute('href')).toBe(
      '/dev/standard-iteration?role=hr&rater=xu',
    );
    expect(document.body.textContent).not.toMatch(/准确率|%/);
  });

  it('requires categories and a reason before signing an attribution', async () => {
    const user = userEvent.setup();
    walk({});
    const block = (await screen.findByText(/许致远评审的 7 个/)).closest(
      '[data-hyp]',
    ) as HTMLElement;
    await user.click(within(block).getByRole('button', { name: '采纳并归因' }));
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(await screen.findByText('写一句理由再确认')).toBeTruthy();
    await user.click(within(block).getByRole('button', { name: '评价人' }));
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(await screen.findByText('至少选一个归因类别')).toBeTruthy();
    await user.click(within(block).getByRole('button', { name: '评价人' }));
    expect(
      within(block).getByText(/涉及评价人，管理者只看到类别/),
    ).toBeTruthy();
    await user.click(within(block).getByRole('button', { name: '取消' }));
    expect(
      within(block).queryByRole('button', { name: '确认归因' }),
    ).toBeNull();

    await user.click(within(block).getByRole('button', { name: '采纳并归因' }));
    await user.click(within(block).getByRole('button', { name: '评价人' }));
    await user.click(
      within(block).getByRole('button', { name: '本人或环境变化' }),
    );
    expect(within(block).getByText(/；管理者看到归因类别/)).toBeTruthy();
    await user.click(
      within(block).getByRole('button', { name: '本人或环境变化' }),
    );
    await user.click(within(block).getByRole('button', { name: '评价人' }));
    await user.type(
      within(block).getByRole('textbox'),
      '评语多写作品完成度，先做评审培训',
    );
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(
      await screen.findByText('归因已确认并署名，结论用于修订人才评价规则'),
    ).toBeTruthy();
    // Signed: the evaluator conclusion has no 起草修订 of its own.
    expect(
      document.querySelector('[data-attribution="attr-hyp-xe6-2"]'),
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '起草修订' })).toHaveLength(1);
  });

  it('records a person-or-environment attribution without a draft', async () => {
    const user = userEvent.setup();
    walk({});
    const block = (await screen.findByText(/七号队是组队作品/)).closest(
      '[data-hyp]',
    ) as HTMLElement;
    await user.click(within(block).getByRole('button', { name: '采纳并归因' }));
    await user.type(within(block).getByRole('textbox'), '分到不同课题，另看');
    await user.click(within(block).getByRole('button', { name: '确认归因' }));
    expect(
      await screen.findByText(/本人或环境变化：记录情境，评价标准保持原样/),
    ).toBeTruthy();
  });

  it('drafts a revision from a confirmed 评价标准 attribution', async () => {
    const user = userEvent.setup();
    walk({});
    await user.click(await screen.findByRole('button', { name: '起草修订' }));
    const dialog = await screen.findByRole('dialog', {
      name: '起草入营选拔标准修订？',
    });
    const reason = within(dialog).getByRole('textbox');
    expect((reason as HTMLTextAreaElement).value).toMatch(/^优先录取一档/);
    await user.click(within(dialog).getByRole('button', { name: '起草修订' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        '/dev/standard-iteration?role=hr&view=standard',
      ),
    );
    // A second draft while one is open is refused and the dialog closes.
    await user.click(screen.getByRole('button', { name: '起草修订' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '起草修订',
      }),
    );
    expect(
      await screen.findByText('状态已被更新，刷新页面后按当前状态处理'),
    ).toBeTruthy();
  });

  it('shows the AI states honestly: retry after failure, nothing invented when empty', async () => {
    const user = userEvent.setup();
    walk({ ai: 'fail' });
    await user.click(
      await screen.findByRole('button', { name: '整理 AI 假设' }),
    );
    expect(screen.getByText('整理中')).toBeTruthy();
    const alert = await screen.findByRole('alert', {}, slow);
    expect(alert.textContent).toContain('AI 整理失败，稍后再试');
    await user.click(within(alert).getByRole('button', { name: '重新整理' }));
    expect(await screen.findByText(/许致远评审的 7 个/, {}, slow)).toBeTruthy();
    cleanup();
    sessionStorage.clear();
    walk({ ai: 'empty' });
    await user.click(
      await screen.findByRole('button', { name: '整理 AI 假设' }),
    );
    // The seeded attribution is still there, so no empty sentence either.
    await waitFor(() => expect(screen.queryByText('整理中')).toBeNull(), slow);
    expect(screen.queryByText(/假设待更多案例后再整理/)).toBeNull();
  });
});

describe('HR: 修订草稿', () => {
  async function openDraft(user: ReturnType<typeof userEvent.setup>) {
    walk({});
    await user.click(await screen.findByRole('button', { name: '起草修订' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '起草修订',
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalled());
    cleanup();
    walk({ seed: null, view: 'standard' });
    return screen.findByRole('heading', { name: 'XEngineer 入营选拔标准' });
  }

  it('edits points, saves to preview the impact, submits and withdraws', async () => {
    const user = userEvent.setup();
    await openDraft(user);
    const submit = screen.getByRole('button', { name: '提交管理者确认' });
    await user.click(submit);
    expect(screen.getByRole('alert').textContent).toBe(
      '提交前还要：保存当前修改，按当前草稿预览一次影响。',
    );
    expect(
      (
        screen.getByRole('button', {
          name: '保存并预览影响',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: '采用 AI 建议' }));
    expect(
      screen.getByText(/改了 2 处/, { selector: '.nt-caption' }),
    ).toBeTruthy();

    // Reason is required before saving.
    const reason = screen.getByLabelText(/修订理由/);
    await user.clear(reason);
    await user.click(screen.getByRole('button', { name: '保存并预览影响' }));
    expect(screen.getByRole('alert').textContent).toBe(
      '保存前还要：写修订理由。',
    );
    await user.click(submit);
    expect(screen.getByRole('alert').textContent).toBe(
      '提交前还要：写修订理由。',
    );
    await user.type(reason, '优先录取一档写清本人部分');
    await user.click(screen.getByRole('button', { name: '保存并预览影响' }));
    expect(
      await screen.findByText('已保存草稿，影响预览已按当前草稿计算', {}, slow),
    ).toBeTruthy();
    expect(screen.getByText('已按当前草稿计算')).toBeTruthy();
    expect(screen.getByText(/83 条选拔记录保持原版本/)).toBeTruthy();

    await user.click(submit);
    expect(
      await screen.findByText('已提交 xe-select-v2，待管理者确认'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(
      await screen.findByText('已撤回，xe-select-v2 回到草稿'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '提交管理者确认' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '提交管理者确认' }));
    await screen.findByText('已提交 xe-select-v2，待管理者确认');
    await user.click(screen.getByRole('button', { name: '撤回到草稿' }));
    expect(await screen.findByText('xe-select-v2 已回到草稿')).toBeTruthy();
    // The whole HR chain in one test can exceed the 5 s default under parallel load.
  }, 15_000);

  it('shows the manager return reason on a returned draft', async () => {
    walk({ seed: 'returned', view: 'standard' });
    expect(await screen.findByText(/程远 09-04 退回：/)).toBeTruthy();
    expect(screen.getByText(/刚过线一档也写一句要看到什么/)).toBeTruthy();
    // Saved human version: the impact preview is ready and no AI block offers itself.
    expect(screen.queryByRole('button', { name: '采用 AI 建议' })).toBeNull();
    expect(screen.getByText('已按当前草稿计算')).toBeTruthy();
  });

  it('shows the standard in force when no draft is open', async () => {
    walk({ view: 'standard' });
    expect(
      await screen.findByRole('link', { name: '去判断对照起草' }),
    ).toBeTruthy();
    expect(screen.getByText('生效中 xe-select-v1')).toBeTruthy();
    cleanup();
    walk({ role: 'manager', view: 'standard' });
    await screen.findByText('生效中 xe-select-v1');
    expect(screen.queryByRole('link', { name: '去判断对照起草' })).toBeNull();
  });
});

describe('Manager: 确认发布', () => {
  it('publishes with the seal, undoes within the window, then returns with a reason', async () => {
    const user = userEvent.setup();
    walk({ role: 'manager', view: 'standard', seed: 'pending' });
    await user.click(
      await screen.findByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: '确认发布 xe-select-v2？',
    });
    expect(
      within(dialog).getByText(/理由：优先录取一档只看作品成品/),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    expect(
      await screen.findByText(
        '已发布 xe-select-v2，之后新建的期次默认用新版',
        {},
        slow,
      ),
    ).toBeTruthy();
    expect(document.getElementById('seal')).toBeTruthy();
    expect(screen.getByText(/XEngineer 第七期建立时绑定/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(
      await screen.findByText('已撤销，xe-select-v2 回到待确认'),
    ).toBeTruthy();
    expect(document.getElementById('seal')).toBeNull();

    await user.click(screen.getByRole('button', { name: '退回修改' }));
    const back = await screen.findByRole('dialog', {
      name: '退回 xe-select-v2？',
    });
    await user.type(within(back).getByLabelText('退回理由'), '刚过线也写清');
    await user.click(within(back).getByRole('button', { name: '退回修改' }));
    expect(
      await screen.findByText('已退回给苏晚修改，理由在苏晚的待办里'),
    ).toBeTruthy();
    expect(screen.getByText(/等苏晚修改后重新提交/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /确认发布/ })).toBeNull();
  });

  it('shows the published content as the standard in force', async () => {
    const user = userEvent.setup();
    walk({ role: 'manager', view: 'standard', seed: 'pending' });
    await user.click(
      await screen.findByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await user.click(
      within(
        await screen.findByRole('dialog', { name: '确认发布 xe-select-v2？' }),
      ).getByRole('button', { name: '确认发布 xe-select-v2' }),
    );
    await screen.findByText(
      '已发布 xe-select-v2，之后新建的期次默认用新版',
      {},
      slow,
    );
    cleanup();
    walk({ view: 'standard', seed: null });
    await screen.findByText('生效中 xe-select-v2');
    expect(screen.getByText(/个人贡献核验/)).toBeTruthy();
    expect(screen.getByText(/每一档写清要看到本人做了哪部分/)).toBeTruthy();
  });

  it('sees per-batch counts and categories only, no cases or raters', async () => {
    walk({ role: 'manager' });
    expect(await screen.findByText('判断对照')).toBeTruthy();
    expect(screen.getByText(/人前后判断不一致/)).toBeTruthy();
    expect(screen.getByText('评价标准')).toBeTruthy();
    expect(screen.queryAllByTestId('judge-case')).toHaveLength(0);
    expect(screen.queryByText(/许致远|谷牧野/)).toBeNull();
  });
});

describe('Rater: 我的判断对照', () => {
  it('locks the stage outside the rater relation and shows its sample', async () => {
    walk({ role: 'rater', rater: 'ye' });
    expect(
      await screen.findByRole('heading', { name: '我的判断对照' }),
    ).toBeTruthy();
    expect(screen.getAllByText('无权限').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/结营评审这一段在你现在的评价关系之外/).length,
    ).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/准确率|%/);
  });

  it('shows 样本不足 below the threshold, without any figure', async () => {
    walk({ role: 'rater', rater: 'gu' });
    expect((await screen.findAllByText(/样本不足/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/给出的等级/)).toBeNull();
  });

  it('lets HR read one rater, linked back to the batch', async () => {
    walk({ rater: 'xu' });
    expect(
      await screen.findByRole('heading', { name: '许致远的判断' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: /回到判断对照/ }).getAttribute('href'),
    ).toBe('/dev/standard-iteration?role=hr');
  });
});
