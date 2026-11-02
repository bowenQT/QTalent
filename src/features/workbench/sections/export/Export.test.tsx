// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ExportScope } from '../../view';
import { testView } from '../../test-helpers';
import { Workbench } from '../../Workbench';
import { ExportPortProvider, type ExportOutcome } from './export-port';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const preview = (people: number, rows: number, skipped = 0) => ({
  people,
  rows,
  skipped,
});
const scopes: ExportScope[] = [
  {
    id: 's-1',
    label: '演示范围甲',
    people: 12,
    previews: {
      all: preview(6, 20, 2),
      last12Months: preview(5, 14, 1),
      last3Months: preview(0, 0, 4),
    },
  },
  {
    id: 's-2',
    label: '演示范围乙',
    people: 0,
    previews: {
      all: preview(0, 0),
      last12Months: preview(0, 0),
      last3Months: preview(0, 0),
    },
  },
];
const done: ExportOutcome = {
  status: 'done',
  people: 5,
  rows: 14,
  at: '2026-09-04 15:20',
  href: 'blob:demo-table',
  fileName: '已确认内容-演示范围甲-20260904.csv',
};

function setup(generate = vi.fn<() => Promise<ExportOutcome>>()) {
  const view = testView({
    displayName: '演示 HR',
    exportable: { status: 'ready', data: { scopes } },
  });
  render(
    <ExportPortProvider port={{ generate }}>
      <Workbench view={view} />
    </ExportPortProvider>,
  );
  return generate;
}
const openDialog = () =>
  fireEvent.click(screen.getByRole('button', { name: '导出已确认内容' }));
const dialog = () => screen.getByRole('dialog', { name: '导出已确认内容' });
const status = () => document.querySelector('#export-st')!;

describe('export of confirmed content', () => {
  it('sits in the heading only when connected and a run is supplied', () => {
    const { container, unmount } = render(<Workbench view={testView()} />);
    expect(container.querySelector('#btn-export, #export-st')).toBeNull();
    unmount();
    // Connected data without a run: the heading stays as it is.
    render(
      <Workbench
        view={testView({ exportable: { status: 'ready', data: { scopes } } })}
      />,
    );
    expect(screen.queryByRole('button', { name: '导出已确认内容' })).toBeNull();
    cleanup();
    setup();
    const head = document.querySelector('.nt-head')!;
    expect(head.querySelector('h1')).toBeTruthy();
    expect(within(head as HTMLElement).getByRole('button').id).toBe(
      'btn-export',
    );
    expect(status().hasAttribute('hidden')).toBe(true);
  });

  it('previews what goes into the table for the picked scope and time', () => {
    setup();
    openDialog();
    const box = dialog();
    expect(box.querySelector('#ex-sum')?.textContent).toBe(
      '5 人 · 14 条已确认的维度分已跳过 1 条待确认、待复核或还在评分复核里的分',
    );
    expect(box.querySelector('#ex-head')?.textContent).toContain(
      '导出人演示 HR',
    );
    expect(box.querySelector('#ex-head')?.textContent).toContain(
      '范围演示范围甲 · 近 12 个月',
    );
    fireEvent.change(within(box).getByLabelText('事件时间'), {
      target: { value: 'last3Months' },
    });
    expect(box.querySelector('#ex-sum')?.textContent).toBe(
      '这个范围里已确认的内容 0 条已跳过 4 条待确认、待复核或还在评分复核里的分',
    );
    fireEvent.change(within(box).getByLabelText('范围'), {
      target: { value: 's-2' },
    });
    expect(box.querySelector('#ex-sum')?.textContent).toBe(
      '这个范围里已确认的内容 0 条这个范围里 0 人',
    );
    expect(
      within(box)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toContain('演示范围乙（0 人）');
  });

  it('asks for another scope instead of generating an empty table', () => {
    const generate = setup();
    openDialog();
    fireEvent.change(within(dialog()).getByLabelText('事件时间'), {
      target: { value: 'last3Months' },
    });
    fireEvent.click(within(dialog()).getByRole('button', { name: '生成表格' }));
    expect(generate).not.toHaveBeenCalled();
    expect(within(dialog()).getByText('换一个范围或时间再生成')).toBeTruthy();
  });

  it('generates, then offers the download with its file name', async () => {
    let finish!: (outcome: ExportOutcome) => void;
    const generate = setup(
      vi.fn(() => new Promise<ExportOutcome>((resolve) => (finish = resolve))),
    );
    openDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: '生成表格' }));
    expect(generate).toHaveBeenCalledWith('s-1', 'last12Months');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      status().querySelector('[data-state]')?.getAttribute('data-state'),
    ).toBe('busy');
    expect(status().textContent).toBe(
      '正在生成「演示范围甲 · 近 12 个月」的表格，只取已确认的内容…',
    );
    await act(async () => finish(done));
    const link = within(status() as HTMLElement).getByRole('link', {
      name: '下载表格',
    });
    expect(link.getAttribute('href')).toBe('blob:demo-table');
    expect(link.getAttribute('download')).toBe(done.fileName);
    expect(status().textContent).toContain(
      '演示范围甲 · 近 12 个月，5 人、14 条已确认的维度分。表头写明了导出时间 09-04 15:20 和口径',
    );
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(status().hasAttribute('hidden')).toBe(true);
  });

  it('says where it stopped: permission, no content, a failed file with retry', async () => {
    const generate = setup(
      vi
        .fn<() => Promise<ExportOutcome>>()
        .mockResolvedValueOnce({ status: 'denied' })
        .mockResolvedValueOnce({ status: 'empty' })
        .mockResolvedValueOnce({ status: 'failed', reason: '导出服务超时' })
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce(done),
    );
    const run = async () => {
      openDialog();
      await act(async () =>
        fireEvent.click(
          within(dialog()).getByRole('button', { name: '生成表格' }),
        ),
      );
    };
    await run();
    expect(status().querySelector('[data-state="deny"]')?.textContent).toMatch(
      /^导出停在权限校验这一步。/,
    );
    await run();
    expect(status().querySelector('[data-state="empty"]')?.textContent).toMatch(
      /^导出停在取数这一步。生成时「演示范围甲 · 近 12 个月」里已确认的内容 0 条/,
    );
    await run();
    expect(status().querySelector('[data-state="fail"]')?.textContent).toMatch(
      /^导出停在生成文件这一步。导出服务超时，文件待重新生成/,
    );
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '重试' })),
    );
    expect(status().textContent).toContain('连接中断，文件待重新生成');
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: '重试' })),
    );
    expect(generate).toHaveBeenLastCalledWith('s-1', 'last12Months');
    expect(screen.getByRole('link', { name: '下载表格' })).toBeTruthy();
  });

  it('keeps only the answer of the latest run', async () => {
    let finish!: (outcome: ExportOutcome) => void;
    setup(
      vi.fn(() => new Promise<ExportOutcome>((resolve) => (finish = resolve))),
    );
    openDialog();
    fireEvent.click(within(dialog()).getByRole('button', { name: '生成表格' }));
    expect(status().hasAttribute('hidden')).toBe(false);
    // Busy has no close button; a new run replaces the old one.
    openDialog();
    const first = finish;
    fireEvent.click(within(dialog()).getByRole('button', { name: '生成表格' }));
    const second = finish;
    await act(async () => first({ status: 'denied' }));
    expect(status().querySelector('[data-state="busy"]')).toBeTruthy();
    await act(async () => second(done));
    expect(status().querySelector('[data-state="done"]')).toBeTruthy();
  });
});
