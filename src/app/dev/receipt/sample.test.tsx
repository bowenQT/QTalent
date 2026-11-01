// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/components/ui/Toast';
import { RECORD_UNDO_WINDOW_MS } from '@/contracts/record';
import { ReceiptPage, RECEIPT_POLL_MS } from '@/features/receipt/ReceiptPage';
import type { ReceiptActions, ReceiptView } from '@/features/receipt/types';
import ReceiptSample from './page';
import {
  BATCH_ID,
  sampleDrafts,
  type SampleRole,
  type SampleScene,
} from './sample-data';
import { SampleReceipt } from './SampleReceipt';
import { createSampleServer, PROCESSING_READS } from './sample-server';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  usePathname: () => '/dev/receipt',
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function view(role: SampleRole, scene: SampleScene) {
  const server = createSampleServer(role, scene);
  const read = await server.read(BATCH_ID);
  if (read.status !== 'success') throw new Error('sample read failed');
  return { server, view: read.view };
}

async function mount(
  role: SampleRole = 'mentor',
  scene: SampleScene = 'normal',
  wrap?: (actions: ReceiptActions) => ReceiptActions,
) {
  const sample = await view(role, scene);
  const actions = wrap ? wrap(sample.server) : sample.server;
  let n = 0;
  render(
    <ToastProvider>
      <ReceiptPage
        batchId={BATCH_ID}
        initial={sample.view}
        actions={actions}
        viewerName="叶青"
        newId={() => `op-${++n}`}
      />
    </ToastProvider>,
  );
  return actions;
}

const card = (id: string) => document.getElementById(`rc-${id}`)!;
const summary = () =>
  screen.getByRole('list', { name: '这次读到了什么' }).textContent;

describe('回执页', () => {
  it('照原型列出文件、待核对、等你确认的三件事和两处待认人', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '分镜工厂 · 二组 结营路演',
    );
    expect(
      screen.getByText('企业微信 · 小犇 · 叶青交 · 09-03 21:10'),
    ).toBeTruthy();
    expect(document.querySelector('.n-rstate')?.textContent).toBe('待核对');
    expect(summary()).toBe('3个文件3人3件事2处待核对3件待确认');
    expect(screen.getByRole('heading', { name: /等你确认/ }).textContent).toBe(
      '等你确认3',
    );
    expect(document.querySelectorAll('.n-rcpt[data-state="ai"]')).toHaveLength(
      3,
    );
    expect(
      document.querySelectorAll('.n-rcpt[data-state="held"]'),
    ).toHaveLength(2);
    // 待认人只给原件的一处，没有标题和建议分
    const held = document.querySelector('.n-rcpt[data-state="held"]')!;
    expect(held.querySelector('.n-rcpt__title')).toBeNull();
    expect(held.querySelector('.n-rcpt__score')).toBeNull();
    expect(held.textContent).toContain('先确认「说话人 · 16:30–17:45」是谁');
    // 建议分始终是 AI 建议，没有「全部确认」
    expect(within(card('e-d1')).getAllByText('AI 建议')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /全部确认/ })).toBeNull();
    expect(screen.getAllByText('核对待接通')).toHaveLength(4);
    expect(
      screen.getByText(/读完了「分镜工厂 · 二组 结营路演」/).textContent,
    ).toContain('2 处等你核对，3 件事的建议分等你确认。');
    expect(
      screen.getByRole('link', { name: '孟逸尘' }).getAttribute('href'),
    ).toBe('/person?id=p-x11');
  });

  it('确认一件事：计入档案并署名，5 秒内撤销回到待确认', async () => {
    const user = userEvent.setup();
    const actions = await mount();
    const save = vi.spyOn(actions, 'save');
    await user.click(
      within(card('e-d1')).getByRole('button', { name: '确认这件事' }),
    );
    await screen.findByText('已确认沈亦初的这件事，已进入档案');
    expect(save.mock.calls[0]![0].decisions.map((d) => d.action)).toEqual([
      'confirm',
      'confirm',
    ]);
    await waitFor(() => expect(card('e-d1').dataset.state).toBe('confirmed'));
    // 确认按钮消失后焦点交给这张卡
    await waitFor(() => expect(document.activeElement).toBe(card('e-d1')));
    expect(card('e-d1').querySelector('.n-block__sig')?.textContent).toBe(
      '叶青',
    );
    expect(within(card('e-d1')).queryByText('AI 建议')).toBeNull();
    expect(summary()).toContain('2件待确认已确认 1');
    expect(screen.getByRole('heading', { name: /等你确认/ }).textContent).toBe(
      '等你确认2',
    );

    await user.click(screen.getByRole('button', { name: '撤销' }));
    await screen.findByText('已撤销，回到待确认');
    await waitFor(() => expect(card('e-d1').dataset.state).toBe('ai'));
    await waitFor(() => expect(document.activeElement).toBe(card('e-d1')));
    expect(summary()).toContain('3件待确认');
  });

  it('改分要写理由；保存为改分，确认后显示 AI 原值', async () => {
    const user = userEvent.setup();
    const actions = await mount();
    const save = vi.spyOn(actions, 'save');
    const item = card('e-d2');
    await user.click(within(item).getByRole('button', { name: '改分' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(item).getByLabelText('坚毅力的分数'),
      ),
    );
    await user.selectOptions(within(item).getByLabelText('坚毅力的分数'), '4');
    await user.click(within(item).getByRole('button', { name: '保存并确认' }));
    const why = within(item).getByRole('textbox');
    expect(why.getAttribute('aria-invalid')).toBe('true');
    expect(why.getAttribute('placeholder')).toBe('改了分，写一句理由');
    expect(document.activeElement).toBe(why);
    expect(save).not.toHaveBeenCalled();

    await user.type(why, '补救计划落实到每天的回归');
    expect(why.getAttribute('aria-invalid')).toBeNull();
    await user.click(within(item).getByRole('button', { name: '保存并确认' }));
    await screen.findByText('已确认方景深的这件事（已改分），已进入档案');
    expect(save.mock.calls[0]![0].decisions[0]).toEqual({
      personId: 'p-x14',
      dimensionId: 'grit',
      action: 'edit',
      value: 4,
      reason: '补救计划落实到每天的回归',
    });
    await waitFor(() => expect(item.dataset.state).toBe('confirmed'));
    expect(within(item).getByText('AI 原为 3')).toBeTruthy();
  });

  it('取消改分回到原样；没改分直接保存就是确认', async () => {
    const user = userEvent.setup();
    const actions = await mount();
    const save = vi.spyOn(actions, 'save');
    const item = card('e-d3');
    await user.click(within(item).getByRole('button', { name: '改分' }));
    await user.selectOptions(within(item).getByLabelText('专业度的分数'), '2');
    await user.click(within(item).getByRole('button', { name: '取消' }));
    expect(within(item).queryByRole('combobox')).toBeNull();
    await user.click(within(item).getByRole('button', { name: '改分' }));
    expect(
      (within(item).getByLabelText('专业度的分数') as HTMLSelectElement).value,
    ).toBe('4');
    await user.click(within(item).getByRole('button', { name: '保存并确认' }));
    await screen.findByText('已确认孟逸尘的这件事，已进入档案');
    expect(
      save.mock.calls[0]![0].decisions.every((d) => d.action === 'confirm'),
    ).toBe(true);
  });

  it('保存冲突：留在原处说明，载入最新版本后再确认', async () => {
    const user = userEvent.setup();
    await mount('mentor', 'conflict');
    const item = card('e-d1');
    await user.click(within(item).getByRole('button', { name: '确认这件事' }));
    expect((await within(item).findByRole('alert')).textContent).toContain(
      '这件事刚有新的版本，载入后再确认',
    );
    await user.click(
      within(item).getByRole('button', { name: '载入最新版本' }),
    );
    await waitFor(() => expect(within(item).queryByRole('alert')).toBeNull());
    await user.click(
      within(card('e-d1')).getByRole('button', { name: '确认这件事' }),
    );
    await screen.findByText('已确认沈亦初的这件事，已进入档案');
  });

  it('断网时保留改动，重发沿用同一个 operation_id', async () => {
    const user = userEvent.setup();
    let fail = true;
    const ids: string[] = [];
    await mount('mentor', 'normal', (server) => ({
      ...server,
      save: async (input) => {
        ids.push(input.operation_id);
        if (fail) {
          fail = false;
          throw new TypeError('fetch failed');
        }
        return server.save(input);
      },
    }));
    const item = card('e-d1');
    await user.click(within(item).getByRole('button', { name: '确认这件事' }));
    expect((await within(item).findByRole('alert')).textContent).toBe(
      '网络中断，改动还在，再试一次',
    );
    await user.click(within(item).getByRole('button', { name: '确认这件事' }));
    await screen.findByText('已确认沈亦初的这件事，已进入档案');
    expect(ids).toEqual(['op-1', 'op-1']);
  });

  it('服务端拒绝或校验不过时就地说明', async () => {
    const user = userEvent.setup();
    let next: 'forbidden' | 'validation_error' = 'forbidden';
    await mount('mentor', 'normal', (server) => ({
      ...server,
      save: async () =>
        next === 'forbidden'
          ? { status: 'forbidden', message: '你已不是这件事的评价人' }
          : { status: 'validation_error', fieldErrors: {}, input: {} },
    }));
    const item = card('e-d1');
    await user.click(within(item).getByRole('button', { name: '确认这件事' }));
    expect((await within(item).findByRole('alert')).textContent).toBe(
      '你已不是这件事的评价人',
    );
    next = 'validation_error';
    await user.click(within(item).getByRole('button', { name: '确认这件事' }));
    await waitFor(() =>
      expect(within(item).getByRole('alert').textContent).toBe(
        '这件事有内容待修改，改动还在',
      ),
    );
  });

  it('撤销没成功时如实说明，结果保留', async () => {
    const user = userEvent.setup();
    await mount('mentor', 'normal', (server) => ({
      ...server,
      undo: async () => ({
        status: 'conflict',
        message: '已超过撤销时间，这条记录已保存',
        input: { operation_id: 'x', saveId: 'y' },
      }),
    }));
    await user.click(
      within(card('e-d1')).getByRole('button', { name: '确认这件事' }),
    );
    await user.click(await screen.findByRole('button', { name: '撤销' }));
    await screen.findByText('撤销失败：这件事的分已有新的处理，已保留当前结果');
    expect(card('e-d1').dataset.state).toBe('confirmed');
  });

  it('HR 看到的是等评价人确认，不能替人确认', async () => {
    await mount('hr');
    expect(screen.getByRole('heading', { name: /等叶青确认/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认这件事' })).toBeNull();
    expect(within(card('e-d1')).getByText('等叶青确认')).toBeTruthy();
    expect(screen.queryByText(/一件一件看证据/)).toBeNull();
  });

  it('没整理出事时说明原件已保存；按权限隐藏时只写一句，不给数量', async () => {
    await mount('mentor', 'empty');
    expect(
      screen.getByText('这次的材料里整理出 0 件事，原件已保存。'),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { name: '整理出的事' })).toBeTruthy();
    expect(document.querySelector('.n-rstate')?.textContent).toBe('已完成');
    cleanup();
    await mount('mentor', 'hidden');
    expect(screen.getAllByText('部分内容已按权限隐藏')).toHaveLength(1);
    expect(screen.getByText(/读完了/).textContent).toMatch(
      /部分内容已按权限隐藏$/,
    );
  });

  it('还有文件在处理时按间隔重读，读完后不再轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const actions = await mount('mentor', 'processing');
    const read = vi.spyOn(actions, 'read');
    expect(document.querySelector('.n-rstate')?.textContent).toBe('处理中');
    expect(summary()).toContain('5个文件1 个处理中');
    expect(screen.getByText('待换文件')).toBeTruthy();
    expect(screen.getByText(/转成 JPG 或 PNG 再传/)).toBeTruthy();
    expect(
      screen.getByRole('progressbar', { name: '评审讨论录音.m4a 处理进度' }),
    ).toBeTruthy();
    expect(screen.getByText(/还在处理的文件读完后/)).toBeTruthy();
    for (let i = 0; i < PROCESSING_READS; i++)
      await act(() => vi.advanceTimersByTimeAsync(RECEIPT_POLL_MS));
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
    expect(document.querySelector('.n-rstate')?.textContent).toBe('待核对');
    const calls = read.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(RECEIPT_POLL_MS * 2));
    expect(read.mock.calls.length).toBe(calls);
  });

  it('重读失败时保留当前内容', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount('mentor', 'processing', (server) => ({
      ...server,
      read: async (id) => {
        if (id) throw new TypeError('fetch failed');
        return server.read(id);
      },
    }));
    await act(() => vi.advanceTimersByTimeAsync(RECEIPT_POLL_MS));
    expect(document.querySelector('.n-rstate')?.textContent).toBe('处理中');
  });

  it('保存后从回执重读、只剩映射的已确认事件，写「已确认，已进入档案」', async () => {
    const sample = await view('mentor', 'normal');
    const saved = await sample.server.save({
      operation_id: 'pre',
      expected_revision: 1,
      draftId: 'e-d3',
      personIds: ['p-x11'],
      projectId: 't-scene-b',
      sbi: sampleDrafts[2]!.sbi,
      decisions: [],
    });
    expect(saved.status).toBe('success');
    const read = await sample.server.read(BATCH_ID);
    render(
      <ToastProvider>
        <ReceiptPage
          batchId={BATCH_ID}
          initial={(read as { view: ReceiptView }).view}
          actions={sample.server}
          viewerName="叶青"
        />
      </ToastProvider>,
    );
    expect(card('e-d3').dataset.state).toBe('confirmed');
    expect(card('e-d3').textContent).toContain('孟逸尘');
    expect(card('e-d3').textContent).toContain('已确认，已进入档案');
  });
});

describe('样张替身', () => {
  it('同一次操作重放原结果，内容变了是冲突；过了 5 秒不能撤销', async () => {
    let now = 1_000_000;
    const server = createSampleServer('mentor', 'normal', () => now);
    const input = {
      operation_id: 'op',
      expected_revision: 1,
      draftId: 'e-d1',
      personIds: ['p-x12'],
      projectId: 't-scene-b',
      sbi: sampleDrafts[0]!.sbi,
      decisions: [],
    };
    const first = await server.save(input);
    expect(first).toMatchObject({ status: 'success', replayed: false });
    expect(await server.save(input)).toMatchObject({
      status: 'success',
      replayed: true,
    });
    expect(await server.save({ ...input, projectId: null })).toMatchObject({
      status: 'conflict',
    });
    expect(
      await server.save({ ...input, operation_id: 'other' }),
    ).toMatchObject({
      status: 'not_found',
    });
    expect(
      await server.save({
        ...input,
        operation_id: 'stale',
        draftId: 'e-d2',
        expected_revision: 1,
      }),
    ).toMatchObject({ status: 'conflict' });
    if (first.status !== 'success') throw new Error('save failed');
    now += RECORD_UNDO_WINDOW_MS;
    expect(
      await server.undo({ operation_id: 'u', saveId: first.result.saveId }),
    ).toMatchObject({
      status: 'conflict',
      message: '已超过撤销时间，这条记录已保存',
    });
    expect(
      await server.undo({ operation_id: 'u', saveId: 'none' }),
    ).toMatchObject({
      status: 'not_found',
    });
    expect(await server.read('other')).toEqual({
      status: 'not_found',
      message: '回执链接失效',
    });
  });
});

describe('/dev/receipt', () => {
  it('生产环境 404，未知的角色或场景也是 404', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(
      ReceiptSample({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('not-found');
    vi.stubEnv('NODE_ENV', 'development');
    await expect(
      ReceiptSample({ searchParams: Promise.resolve({ role: 'ceo' }) }),
    ).rejects.toThrow('not-found');
    await expect(
      ReceiptSample({ searchParams: Promise.resolve({ scene: 'x' }) }),
    ).rejects.toThrow('not-found');
  });

  it('默认用导师视角渲染样张', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    render(await ReceiptSample({ searchParams: Promise.resolve({}) }));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '分镜工厂 · 二组 结营路演',
      }),
    ).toBeTruthy();
  });

  it('读到回执之前显示正在读', async () => {
    render(
      <ToastProvider>
        <SampleReceipt role="mentor" scene="normal" />
      </ToastProvider>,
    );
    expect(screen.getByText('正在读回执')).toBeTruthy();
    await screen.findByRole('heading', { level: 1 });
  });
});
