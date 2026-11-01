// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ToastProvider } from '@/components/ui/Toast';
import type { PersonPrintPorts, PersonPrintSheet, PrintPreview } from './ports';
import { PersonPrint } from './PersonPrint';
import { livePrintPorts } from './live-ports';

const preview: PrintPreview = {
  eventCount: 2,
  scoreCount: 3,
  skippedCount: 1,
  hasSummary: true,
  hasFormalPosition: true,
  hasHidden: true,
};
const sheet: PersonPrintSheet = {
  person: {
    name: '演示甲',
    demo: true,
    teamPath: '演示部 / 一组',
    jobTitle: '后端方向',
    level: '2027 届',
    tenureLabel: '入营 2 个月',
    batchName: '演示期',
  },
  printedAt: '2026-09-04 15:00',
  printedByName: '演示 HR',
  summary: {
    text: '演示：在服务端主流程上承担了主要搭建工作。',
    adoptedByName: '演示 HR',
    adoptedOn: '2026-09-01',
  },
  formalPosition: { status: 'pending' },
  events: [
    {
      id: 'e1',
      occurredOn: '2026-08-28',
      title: '搭起服务端主流程',
      projectName: '演示组',
      recorderName: '演示导师',
      scores: [
        {
          id: 's1',
          dimensionLabel: '专业度',
          value: 4,
          anchor: '超出本届学员预期',
          quote: '引用「主要负责服务端的主架构」',
          scoredByName: '演示导师',
          ruleVersionLabel: '评价规则 v1',
          source: { exact: true, text: '观察表 · 第 1 行' },
        },
        {
          id: 's2',
          dimensionLabel: '智慧力',
          value: 4,
          anchor: '有难度或模糊的情境下主动表现，并有可见结果',
          quote: null,
          scoredByName: '演示导师',
          ruleVersionLabel: '评价规则 v1',
          source: { exact: true, text: '观察表 · 第 1 行' },
        },
      ],
    },
    {
      id: 'e2',
      occurredOn: '2026-07-24',
      title: '完成数据标签分析',
      projectName: null,
      recorderName: '演示导师',
      scores: [
        {
          id: 's3',
          dimensionLabel: '专业度',
          value: 3,
          anchor: '达到本届学员预期',
          quote: null,
          scoredByName: '演示导师',
          ruleVersionLabel: '评价规则 v1',
          source: { exact: true, text: '观察表 · 第 2 行' },
        },
        {
          id: 's4',
          dimensionLabel: '智慧力',
          value: 3,
          anchor: '常规情境下稳定表现出该维度的行为',
          quote: null,
          scoredByName: '演示导师',
          ruleVersionLabel: '评价规则 v1',
          source: { exact: false, text: '观察表 · 第 2 行；观察表 · 第 3 行' },
        },
      ],
    },
  ],
};

function ports(overrides: Partial<PersonPrintPorts> = {}): PersonPrintPorts {
  return {
    preview: vi.fn(async () => ({ status: 'ready' as const, preview })),
    print: vi.fn(async () => ({ status: 'printed' as const, sheet })),
    ...overrides,
  };
}
function mount(p: PersonPrintPorts, canPrint = true) {
  return render(
    <ToastProvider>
      <PersonPrint
        personId="p-1"
        personName="演示甲"
        canPrint={canPrint}
        ports={p}
      />
    </ToastProvider>,
  );
}
const printSheet = () => document.getElementById('print-sheet')!;
const openPrint = () =>
  fireEvent.click(screen.getByRole('button', { name: '打印档案' }));

let print: ReturnType<typeof vi.fn>;
beforeEach(() => {
  print = vi.fn();
  vi.stubGlobal('print', print);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile print', () => {
  it('says what will print and what stays, then prints the confirmed content', async () => {
    const p = ports();
    mount(p);
    expect(printSheet().textContent).toBe(
      '档案请用页面上的「打印档案」打印：打印内容只含已确认的部分，并记入审计日志。',
    );
    openPrint();
    const dialog = await screen.findByRole('dialog', {
      name: '打印演示甲的档案',
    });
    expect(p.preview).toHaveBeenCalledWith('p-1');
    expect(
      within(dialog).getByText(/打印的是截至现在已确认的内容/),
    ).toBeTruthy();
    expect(
      [...dialog.querySelectorAll('.n-dialog__facts li')].map(
        (li) => li.textContent,
      ),
    ).toEqual([
      '会打印：基本信息、2 件关键事件里 3 条已确认的维度分（附行为锚点、引用、评分人、规则版本和来源位置）、已采纳的 AI 摘要（标明 AI 生成和采纳人）、能力象限的正式位置',
      '留在系统里：跳过的 1 条分（待确认、待复核或还在评分复核里）、待采纳的 AI 摘要、系统给的参考位置，以及按权限隐藏的资料',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: '打印' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(p.print).toHaveBeenCalledWith({
      operationId: expect.any(String),
      personId: 'p-1',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      await screen.findByText('已打开打印。只含已确认的内容，已记入审计日志'),
    ).toBeTruthy();

    const text = printSheet().innerText ?? printSheet().textContent;
    expect(printSheet().querySelector('h1')?.textContent).toBe('演示甲 演示');
    expect(printSheet().querySelector('.n-print__head p')?.textContent).toBe(
      '演示部 / 一组 · 后端方向 · 2027 届 · 入营 2 个月 · 演示期',
    );
    expect(
      [...printSheet().querySelectorAll('.n-print__meta dd')].map(
        (dd) => dd.textContent,
      ),
    ).toEqual([
      '2026-09-04 15:00',
      '演示 HR',
      expect.stringContaining(
        'AI 建议分、待按新版本复核的分、还在评分复核里的分',
      ),
    ]);
    expect(text).toContain('演示 HR 09-01 采纳 AI 摘要');
    expect(text).toContain('待正式校准');
    expect(
      [...printSheet().querySelectorAll('section')]
        .at(-1)
        ?.querySelector('h2 small')?.textContent,
    ).toBe('2 件 · 4 条');
    const events = printSheet().querySelectorAll('.n-print__evs > li');
    expect(events[0].querySelector('.n-print__ev')?.textContent).toBe(
      '08-28 · 搭起服务端主流程 · 演示组 · 演示导师记录',
    );
    // A shared source is written once under the event; otherwise per score.
    expect(
      [...events[0].querySelectorAll(':scope > .n-print__src')].map(
        (p) => p.textContent,
      ),
    ).toEqual(['来源：观察表 · 第 1 行']);
    expect(events[0].querySelector('li')?.textContent).toBe(
      '专业度 4 · 演示导师评 · 评价规则 v1锚点 4：超出本届学员预期引用「主要负责服务端的主架构」',
    );
    expect(events[1].querySelector('.n-print__ev')?.textContent).toBe(
      '07-24 · 完成数据标签分析 · 演示导师记录',
    );
    expect(
      [...events[1].querySelectorAll('li .n-print__src')].map(
        (span) => span.textContent,
      ),
    ).toEqual([
      '来源：观察表 · 第 2 行',
      '全部来源：观察表 · 第 2 行；观察表 · 第 3 行',
    ]);
    expect(events[1].querySelector(':scope > .n-print__src')).toBeNull();
    expect(printSheet().querySelector('.n-print__foot')?.textContent).toBe(
      '仅限内部使用 · 本次打印已记入审计日志 · 演示数据，人员均为化名',
    );
    // Nothing on the sheet reads as a total, a percentage or a ranking.
    expect(text).not.toMatch(/总分|%|排名|胜任/);

    act(() => {
      window.dispatchEvent(new Event('afterprint'));
    });
    expect(printSheet().querySelector('.n-print__idle')).toBeTruthy();
  });

  it('prints a sheet with no confirmed score, no summary and no quadrant access', async () => {
    mount(
      ports({
        print: vi.fn(async () => ({
          status: 'printed' as const,
          sheet: {
            ...sheet,
            person: { ...sheet.person, demo: false },
            summary: null,
            formalPosition: undefined,
            events: [],
          },
        })),
      }),
    );
    openPrint();
    fireEvent.click(await screen.findByRole('button', { name: '打印' }));
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(printSheet().querySelector('h1')?.textContent).toBe('演示甲');
    expect(printSheet().textContent).toContain('已确认的维度分 0 条。');
    expect(printSheet().textContent).not.toContain('档案摘要');
    expect(printSheet().textContent).not.toContain('正式位置');
    expect(printSheet().querySelector('.n-print__foot')?.textContent).toBe(
      '仅限内部使用 · 本次打印已记入审计日志',
    );
  });

  it('refuses when the permission changed, on opening or on confirming', async () => {
    for (const p of [
      ports({ preview: vi.fn(async () => ({ status: 'denied' as const })) }),
      ports({ print: vi.fn(async () => ({ status: 'denied' as const })) }),
    ]) {
      mount(p);
      openPrint();
      const confirm = await screen.findByRole('dialog');
      if (within(confirm).queryByRole('button', { name: '打印' }))
        fireEvent.click(within(confirm).getByRole('button', { name: '打印' }));
      const refusal = await screen.findByRole('dialog', {
        name: '这份档案已移出你的导出范围',
      });
      expect(refusal.textContent).toContain('这次尝试已记入审计日志');
      fireEvent.click(within(refusal).getByRole('button', { name: '知道了' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(print).not.toHaveBeenCalled();
      expect(printSheet().querySelector('.n-print__idle')).toBeTruthy();
      cleanup();
    }
  });

  it('says printing is not connected on the real server', async () => {
    mount(livePrintPorts());
    openPrint();
    const notice = await screen.findByRole('dialog', {
      name: '档案打印待接通',
    });
    expect(notice.textContent).toContain('这一步接通后');
    fireEvent.click(within(notice).getByRole('button', { name: '知道了' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(print).not.toHaveBeenCalled();
    expect(
      await livePrintPorts().print({ operationId: 'o', personId: 'p' }),
    ).toEqual({
      status: 'not_connected',
    });
  });

  it('keeps the dialog and says so when the print or the preview is lost', async () => {
    const lost = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'printed', sheet });
    mount(ports({ print: lost }));
    openPrint();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '打印' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      '打印稿生成失败，可以再点一次「打印」。',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: '打印' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    cleanup();

    mount(
      ports({ preview: vi.fn(async () => Promise.reject(new Error('x'))) }),
    );
    openPrint();
    expect((await screen.findByRole('alert')).textContent).toBe(
      '打印内容读取失败，可以再点一次「打印档案」。',
    );
    expect(
      screen
        .getByRole('button', { name: '打印档案' })
        .getAttribute('aria-describedby'),
    ).toBe('print-error');
  });

  it('cancels without printing, and ignores clicks while checking', async () => {
    let answer!: (value: { status: 'ready'; preview: PrintPreview }) => void;
    const p = ports({
      preview: vi.fn(
        () =>
          new Promise<{ status: 'ready'; preview: PrintPreview }>((done) => {
            answer = done;
          }),
      ),
    });
    mount(p);
    screen.getByRole('button', { name: '打印档案' }).focus();
    openPrint();
    expect(
      screen
        .getByRole('button', { name: '打印档案' })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    openPrint();
    expect(p.preview).toHaveBeenCalledTimes(1);
    await act(async () => answer({ status: 'ready', preview }));
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(p.print).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: '打印档案' }),
      ),
    );
  });

  it('gives viewers without the entry a line on who can print', () => {
    mount(ports(), false);
    expect(screen.queryByRole('button', { name: '打印档案' })).toBeNull();
    expect(printSheet().textContent).toBe(
      '档案打印只对管理者和这个人的归属 HR 开放，打印内容只含已确认的部分，并记入审计日志。',
    );
  });
});
