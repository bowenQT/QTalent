// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { ImportRowCard } from './ImportRowCard';
import { InterviewImport } from './InterviewImport';
import {
  confirmRow,
  fillItem,
  sendToReview,
  type ImportBatch,
  type ImportRow,
} from './model';
import type { InterviewImportPorts, RowResult } from './ports';

afterEach(cleanup);

const row = (rowId: string, extra: Partial<ImportRow> = {}): ImportRow => ({
  rowId,
  pages: { from: 1, to: 1 },
  observedName: `候选人${rowId}`,
  candidateStatus: 'hired',
  located: true,
  template: { name: '测试评价表', scale: 'A–D' },
  interviewedOn: '2026-05-08',
  match: {
    personId: `p-${rowId}`,
    name: `候选人${rowId}`,
    hue: 10,
    photo: null,
    org: '测试组',
    title: '测试方向',
    joinedOn: '2026-07-06',
  },
  interviewer: { status: 'matched', name: '测试面试官' },
  scale: [
    { item: '技术深度', selection: { status: 'recognized', value: 'B' } },
    {
      item: '管理能力',
      selection: {
        status: 'not_applicable',
        reason: 'non_management_position',
      },
    },
  ],
  result: '通过',
  comment: null,
  redacted: 0,
  duplicate: null,
  reviewItemId: null,
  confirmed: false,
  filled: {},
  ...extra,
});

const rows: ImportRow[] = [
  row('A', { comment: '讲得具体', redacted: 1 }),
  row('B', {
    pages: { from: 3, to: 4 },
    scale: [
      {
        item: '系统设计',
        selection: {
          status: 'unrecognized',
          reason: 'multiple_selections',
          page: 3,
          options: ['A', 'B', 'C', 'D'],
          marked: ['A', 'B'],
        },
      },
    ],
  }),
  row('C', { match: null }),
  row('D', {
    interviewer: {
      status: 'pending',
      observedName: 'Kevin',
      reviewItemId: 'i-int',
    },
  }),
  // A rejected application whose record is located is skipped before HR confirms.
  row('E', { candidateStatus: 'rejected' }),
  row('F', { duplicate: { importedOn: '2026-08-20' } }),
];

const batch = (extra: Partial<ImportBatch> = {}): ImportBatch => ({
  id: 'b-1',
  file: '测试面评.pdf（演示）',
  pageCount: 9,
  uploadedBy: '测试 HR',
  uploadedAt: '2026-09-04T09:30:00',
  prior: { importedOn: '2026-08-20' },
  rows,
  ...extra,
});

/** Ports that apply the model's row changes, like the server will. */
function ports(): InterviewImportPorts & {
  [K in keyof InterviewImportPorts]: ReturnType<typeof vi.fn>;
} {
  const stored = new Map(rows.map((r) => [r.rowId, r]));
  const change = async (
    rowId: string,
    apply: (r: ImportRow) => ImportRow,
  ): Promise<RowResult> => {
    const next = apply(stored.get(rowId)!);
    stored.set(rowId, next);
    return { status: 'ok', row: next };
  };
  return {
    confirm: vi.fn((_b: string, id: string, ok: boolean) =>
      change(id, (r) => confirmRow(r, ok)),
    ),
    fill: vi.fn((_b: string, id: string, item: string, value: string) =>
      change(id, (r) => fillItem(r, item, value)),
    ),
    sendToReview: vi.fn((_b: string, id: string) =>
      change(id, (r) => sendToReview(r, `i-iv-${id}`)),
    ),
  };
}

function show(
  value: ImportBatch = batch(),
  using: InterviewImportPorts = ports(),
) {
  render(
    <ToastProvider>
      <InterviewImport batch={value} ports={using} />
    </ToastProvider>,
  );
  return using;
}

const card = (rowId: string) =>
  document.getElementById(`iv-${rowId}`) as HTMLElement;

describe('InterviewImport', () => {
  it('shows the file, the earlier import and the counts', () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '面评导入',
    );
    expect(
      screen.getByText(
        '测试面评.pdf（演示） · 9 页 · 测试 HR 09-04 09:30 上传 · 按版式读分',
      ),
    ).toBeTruthy();
    expect(document.querySelector('.n-rstate')?.textContent).toBe('待逐行确认');
    expect(document.querySelector('.n-note')?.textContent).toBe(
      '这份文件 08-20 导入过一次，那次已导入的 1 行这次跳过，其余行照常确认。',
    );
    const sum = screen.getByRole('list', { name: '这份面评' });
    expect(
      within(sum)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '4行可导入',
      '1行待确认是谁',
      '3行待处理面试官 1 · 补录 1 · 待认人 1',
      '2行跳过',
    ]);
  });

  it('keeps the original scale apart from dimension scores', () => {
    show();
    const scale = card('A').querySelector('.n-scale.n-ivscale')!;
    expect(
      [...scale.querySelectorAll('span')].map((s) => [
        s.className,
        s.textContent,
      ]),
    ).toEqual([
      ['n-scale__tag', '原量表 · 单独保存'],
      ['', '技术深度 B'],
      ['is-na', '管理能力 · 非管理岗免评'],
      ['', '面试结论 通过'],
    ]);
    expect(card('A').querySelector('.n-score')).toBeNull();
    expect(document.body.textContent).not.toMatch(/不是维度分|不适用|认不出/);
    expect(card('A').querySelector('.n-ivrow__note')?.textContent).toBe(
      '讲得具体已隐去 1 处学历类描述',
    );
  });

  it('tells the three states apart: skipped, waiting to be identified, unread', () => {
    show();
    expect(card('C').dataset.state).toBe('unknown');
    expect(within(card('C')).getByText('待认人')).toBeTruthy();
    expect(within(card('C')).getByText('人员目录里查到 0 人')).toBeTruthy();
    expect(card('B').dataset.state).toBe('unread');
    expect(within(card('B')).getByText('有分待补录')).toBeTruthy();
    expect(card('B').querySelector('.is-miss')?.textContent).toBe(
      '系统设计 待补录',
    );
    const crop = screen.getByRole('figure', {
      name: '第 3 页「系统设计」一栏的页面图',
    });
    expect(
      [...crop.querySelectorAll('.is-on')].map((s) => s.textContent),
    ).toEqual(['A', 'B']);
    expect(card('E')).toBeNull();
    const fold = document.querySelector('details.nt-fold') as HTMLElement;
    expect(fold.querySelector('summary')?.textContent).toContain('跳过的 2 行');
    expect(
      [...fold.querySelectorAll('li')].map((li) => li.textContent),
    ).toEqual([
      '候选人E · 第 1 页 · 测试评价表北森状态：淘汰',
      '候选人F · 第 1 页 · 测试评价表08-20 已导入过',
    ]);
  });

  it('links a row waiting for its interviewer to the review item', () => {
    show();
    expect(card('D').dataset.state).toBe('verify');
    expect(
      within(card('D'))
        .getByRole('link', { name: '去核对' })
        .getAttribute('href'),
    ).toBe('/inbox#i-int');
    expect(
      within(card('D'))
        .getByRole('link', { name: '关联面试官' })
        .getAttribute('href'),
    ).toBe('/inbox#i-int');
  });

  it('confirms who a row is, counts it for import and takes it back', async () => {
    const user = userEvent.setup();
    const using = show();
    await user.click(screen.getByRole('button', { name: '是候选人A' }));
    expect(using.confirm).toHaveBeenCalledWith('b-1', 'A', true);
    await waitFor(() => expect(card('A').dataset.state).toBe('confirmed'));
    expect(card('A').classList.contains('nt-flash')).toBe(true);
    expect(within(card('A')).getByText('已确认是候选人A')).toBeTruthy();
    expect(document.querySelector('.n-ivbar')?.textContent).toContain(
      '已确认 1 行；导入后写进这些人的档案，作为面试段的历史评价',
    );
    expect(
      screen.getByRole('button', { name: '导入已确认的 1 行' }),
    ).toHaveProperty('disabled', true);
    await user.click(within(card('A')).getByRole('button', { name: '改回' }));
    await waitFor(() => expect(card('A').dataset.state).toBe('confirm'));
    expect(using.confirm).toHaveBeenLastCalledWith('b-1', 'A', false);
  });

  it('fills an unread score from the page image, then the row can be confirmed', async () => {
    const using = show();
    fireEvent.change(within(card('B')).getByRole('combobox'), {
      target: { value: 'A' },
    });
    expect(using.fill).toHaveBeenCalledWith('b-1', 'B', '系统设计', 'A');
    await waitFor(() => expect(card('B').dataset.state).toBe('confirm'));
    expect(card('B').querySelector('.is-miss')).toBeNull();
    expect(within(card('B')).getByRole('combobox')).toHaveProperty(
      'value',
      'A',
    );
  });

  it('sends a row nobody matches to review and links there', async () => {
    const user = userEvent.setup();
    const using = show();
    await user.click(
      within(card('C')).getByRole('button', { name: '放进待核对' }),
    );
    expect(using.sendToReview).toHaveBeenCalledWith('b-1', 'C');
    expect(
      await screen.findByText('已放进待核对，北森同步后再确认是谁'),
    ).toBeTruthy();
    expect(card('C').dataset.state).toBe('sent');
    expect(
      within(card('C'))
        .getByRole('link', { name: '查看待核对' })
        .getAttribute('href'),
    ).toBe('/inbox#i-iv-C');
  });

  it('asks who a not-hired candidate is when the record cannot be located, and says what review does with it', async () => {
    const user = userEvent.setup();
    const notHired = row('G', {
      candidateStatus: 'offer_pending',
      located: false,
      match: null,
    });
    const using = ports();
    using.sendToReview.mockResolvedValueOnce({
      status: 'ok',
      row: sendToReview(notHired, 'i-iv-G'),
    });
    show(batch({ prior: null, rows: [notHired] }), using);
    expect(card('G').dataset.state).toBe('unknown');
    expect(
      within(card('G')).getByText('北森 · 已发 offer · 未入职'),
    ).toBeTruthy();
    expect(card('G').textContent).toContain(
      '北森状态是已发 offer · 未入职；确认是谁之前不入档',
    );
    await user.click(screen.getByRole('button', { name: '放进待核对' }));
    expect(
      await screen.findByText('已放进待核对，确认是谁之前不入档'),
    ).toBeTruthy();
    expect(document.querySelector('details.nt-fold')).toBeNull();
  });

  it.each([
    [
      'refused',
      (fill: ReturnType<typeof ports>['fill']) =>
        fill.mockResolvedValueOnce({
          status: 'conflict',
          message: '这一行已变化，请刷新后再看',
        }),
      '这一行已变化，请刷新后再看',
    ],
    [
      'failing',
      (fill: ReturnType<typeof ports>['fill']) =>
        fill.mockRejectedValueOnce(new Error('offline')),
      '保存失败，已保留当前内容，请稍后再试',
    ],
  ] as const)(
    'keeps a fill-in that was %s, marks it unsaved and saves it on retry',
    async (_, fail, message) => {
      const user = userEvent.setup();
      const using = ports();
      fail(using.fill);
      show(batch(), using);
      const select = within(card('B')).getByRole('combobox');
      fireEvent.change(select, { target: { value: 'B' } });
      expect(await screen.findByText(message)).toBeTruthy();
      // The choice stays in the field, said to be unsaved; the row does not move on.
      expect(select).toHaveProperty('value', 'B');
      expect(within(card('B')).getByRole('alert').textContent).toBe(
        '「系统设计」选的 B 还没保存 重试保存',
      );
      expect(card('B').dataset.state).toBe('unread');
      expect(
        within(card('B')).queryByRole('button', { name: '是候选人B' }),
      ).toBeNull();
      await user.click(
        within(card('B')).getByRole('button', { name: '重试保存' }),
      );
      expect(using.fill).toHaveBeenLastCalledWith('b-1', 'B', '系统设计', 'B');
      await waitFor(() => expect(card('B').dataset.state).toBe('confirm'));
      expect(within(card('B')).queryByRole('alert')).toBeNull();
    },
  );

  it('says an unsaved clearing apart from an unsaved choice', async () => {
    const using = ports();
    using.fill.mockRejectedValueOnce(new Error('offline'));
    show(batch({ rows: [{ ...rows[1], filled: { 系统设计: 'A' } }] }), using);
    fireEvent.change(within(card('B')).getByRole('combobox'), {
      target: { value: '' },
    });
    expect((await within(card('B')).findByRole('alert')).textContent).toContain(
      '「系统设计」的清空还没保存',
    );
    expect(card('B').dataset.state).toBe('confirm');
  });

  it('keeps the rows and says so when a change is refused or fails', async () => {
    const user = userEvent.setup();
    const using = ports();
    using.confirm.mockResolvedValueOnce({
      status: 'conflict',
      message: '这一行已变化，请刷新后再看',
    });
    using.sendToReview.mockRejectedValueOnce(new Error('offline'));
    show(batch(), using);
    await user.click(screen.getByRole('button', { name: '是候选人A' }));
    expect(await screen.findByText('这一行已变化，请刷新后再看')).toBeTruthy();
    expect(card('A').dataset.state).toBe('confirm');
    await user.click(screen.getByRole('button', { name: '放进待核对' }));
    expect(
      await screen.findByText('保存失败，已保留当前内容，请稍后再试'),
    ).toBeTruthy();
    expect(card('C').dataset.state).toBe('unknown');
  });

  it('disables a row while its change is saved', async () => {
    const user = userEvent.setup();
    const using = ports();
    let finish: (value: RowResult) => void = () => {};
    using.confirm.mockReturnValueOnce(
      new Promise<RowResult>((resolve) => {
        finish = resolve;
      }),
    );
    show(batch(), using);
    const button = screen.getByRole('button', { name: '是候选人A' });
    await user.click(button);
    expect(button).toHaveProperty('disabled', true);
    finish({ status: 'ok', row: confirmRow(rows[0], true) });
    await waitFor(() => expect(card('A').dataset.state).toBe('confirmed'));
  });

  it('shows import as not connected and leaves out what a batch lacks', () => {
    show(
      batch({
        prior: null,
        rows: [row('E', { candidateStatus: 'offer_declined' })],
      }),
    );
    expect(document.querySelector('.n-note')).toBeNull();
    expect(document.querySelector('.n-rstate')?.textContent).toBe('全部跳过');
    expect(document.querySelector('.n-ivbar')?.textContent).toContain(
      '逐行确认「这是谁」以后，就能导入',
    );
    expect(screen.getByText('导入待接通')).toBeTruthy();
    expect(document.querySelector('details li')?.textContent).toContain(
      '北森状态：放弃录用',
    );
  });

  it('never draws a skipped row as a card', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const on = { confirm: vi.fn(), fill: vi.fn(), send: vi.fn() };
    expect(() =>
      render(
        <ImportRowCard
          row={row('F', { duplicate: { importedOn: '2026-08-20' } })}
          busy={false}
          unsaved={{}}
          flash={false}
          on={on}
        />,
      ),
    ).toThrow('Skipped rows are listed apart');
  });
});
