// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  Source,
  SourceReadResult,
  SourceReference,
} from '@/contracts/sources';
import { SourceCite, type LoadSource } from './SourceCite';

const reference: SourceReference = {
  fragmentId: 'frag-test-1',
  originalVersionId: 'ver-test-1',
  location: { kind: 'spreadsheet', sheet: '观察表', cell: 'C7' },
};
const original: Source = {
  ...reference,
  excerpt: '联调时能独立定位问题',
  originalTitle: '合成观察表',
  recordedByName: '演示记录人',
  sourceType: 'spreadsheet',
  sourceCategory: 'original',
  demo: true,
};
const baseline: Source = {
  fragmentId: 'frag-test-1',
  originalVersionId: 'ver-test-1',
  location: {
    kind: 'snapshot_field',
    fieldPath: 'events.12.note',
    originalLocation: '第 4 行',
  },
  excerpt: '评语按原意压缩后的一句话',
  originalTitle: '合成基线',
  recordedByName: null,
  sourceType: 'prototype_snapshot',
  sourceCategory: 'prototype_baseline',
  displayNotice: '原型基线 2e51b50，评语按原意压缩',
  demo: true,
};
const success = (source: Source): SourceReadResult => ({
  status: 'success',
  source,
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mark = () => screen.getByRole('button', { name: /^原文/ });
const popText = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.n-cite__pop')?.textContent ?? '';
const setup = (load: LoadSource, source = reference) =>
  render(<SourceCite source={source} index="原文" loadSource={load} />);

describe('SourceCite reading', () => {
  it('does not read until opened, then sends only the two identifiers', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue(success(original));
    const view = setup(load);
    expect(load).not.toHaveBeenCalled();
    expect(popText(view)).toContain('「观察表」C7');
    await userEvent.setup().hover(mark());
    expect(load).toHaveBeenCalledTimes(1);
    const input = load.mock.calls[0]![0];
    expect(Object.keys(input).sort()).toEqual([
      'fragmentId',
      'originalVersionId',
    ]);
    expect(input).toEqual({
      fragmentId: 'frag-test-1',
      originalVersionId: 'ver-test-1',
    });
  });

  it('shows 读取原文中 while pending, then the type, location and excerpt', async () => {
    let resolve!: (value: SourceReadResult) => void;
    const load = vi.fn<LoadSource>(
      () => new Promise<SourceReadResult>((r) => (resolve = r)),
    );
    const view = setup(load);
    await userEvent.setup().hover(mark());
    expect(popText(view)).toContain('读取原文中');
    expect(popText(view)).toContain('「观察表」C7');
    await act(async () => resolve(success(original)));
    // 读到原文后标题换成原件标题，记录人有值才显示。
    expect(popText(view)).toContain('合成观察表 · 「观察表」C7 · 演示记录人');
    expect(popText(view)).toContain('联调时能独立定位问题');
    expect(popText(view)).not.toContain('读取原文中');
  });

  it('opens from keyboard focus and reads once for repeated opening', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue(success(original));
    const view = setup(load);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(mark());
    await waitFor(() => expect(popText(view)).toContain('联调时'));
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await user.hover(mark());
    await user.unhover(mark());
    await user.hover(mark());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('closes with Escape and keeps focus on the mark', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue(success(original));
    const view = setup(load);
    const user = userEvent.setup();
    await user.tab();
    await waitFor(() => expect(popText(view)).toContain('联调时'));
    await user.keyboard('{Escape}');
    expect(
      (view.container.querySelector('.n-cite__pop') as HTMLElement).style
        .display,
    ).toBe('none');
    expect(document.activeElement).toBe(mark());
  });

  it('shows the baseline notice and 演示, with the original location only', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue(success(baseline));
    const view = setup(load, {
      fragmentId: baseline.fragmentId,
      originalVersionId: baseline.originalVersionId,
      location: baseline.location,
    });
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(view)).toContain('原型基线 2e51b50'));
    expect(popText(view)).toContain('演示');
    expect(popText(view)).toContain('合成基线 · 第 4 行');
    // 记录人未知（null）时不显示，也不拿别人代替。
    expect(popText(view)).not.toMatch(/第 4 行 ·/);
    expect(popText(view)).toContain('评语按原意压缩后的一句话');
    expect(popText(view)).not.toContain('events.12.note');
    expect(
      view.container.querySelector('[title="events.12.note"]'),
    ).not.toBeNull();
  });

  it('shows a baseline without original location as a snapshot field', async () => {
    const withoutLocation: Source = {
      ...baseline,
      location: { kind: 'snapshot_field', fieldPath: 'events.9.note' },
    };
    const load = vi
      .fn<LoadSource>()
      .mockResolvedValue(success(withoutLocation));
    const view = setup(load, {
      fragmentId: baseline.fragmentId,
      originalVersionId: baseline.originalVersionId,
      location: withoutLocation.location,
    });
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(view)).toContain('原型基线 2e51b50'));
    expect(popText(view)).toContain('合成基线 · 快照字段');
  });
});

describe('SourceCite failures', () => {
  it('locks forbidden sources without showing the server message or any excerpt', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue({
      status: 'forbidden',
      message: '内部原因：未授权',
    });
    const view = setup(load);
    await userEvent.setup().hover(mark());
    await waitFor(() =>
      expect(popText(view)).toContain('原文在你的查看范围之外'),
    );
    expect(popText(view)).not.toContain('内部原因');
    expect(popText(view)).not.toContain('联调时');
    expect(mark().getAttribute('data-kind')).toBe('locked');
  });

  it.each([
    ['not_found', '原文已移除或链接失效'],
    ['conflict', '原文版本已更新，刷新页面后再看'],
  ] as const)('shows the %s state without a retry', async (status, text) => {
    const load = vi
      .fn<LoadSource>()
      .mockResolvedValue({ status, message: '服务端消息' });
    const view = setup(load);
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(view)).toContain(text));
    expect(popText(view)).not.toContain('服务端消息');
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull();
    await userEvent.setup().click(mark());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('treats a validation error as a failure and retries on request', async () => {
    const load = vi
      .fn<LoadSource>()
      .mockResolvedValueOnce({
        status: 'validation_error',
        fieldErrors: { fragmentId: ['无效'] },
        input: {},
      })
      .mockResolvedValueOnce(success(original));
    const view = setup(load);
    const user = userEvent.setup();
    await user.hover(mark());
    await waitFor(() => expect(popText(view)).toContain('读取失败'));
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() =>
      expect(popText(view)).toContain('联调时能独立定位问题'),
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(mark().getAttribute('aria-expanded')).toBe('true');
  });

  it('treats a thrown network error as a failure and keeps the popover open', async () => {
    const load = vi
      .fn<LoadSource>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(success(original));
    const view = setup(load);
    const user = userEvent.setup();
    await user.click(mark());
    await waitFor(() => expect(popText(view)).toContain('读取失败'));
    expect(mark().getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(popText(view)).toContain('联调时'));
  });

  it('rejects a response for a different fragment or version', async () => {
    const other = vi
      .fn<LoadSource>()
      .mockResolvedValue(success({ ...original, fragmentId: 'frag-test-2' }));
    const first = setup(other);
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(first)).toContain('读取失败'));
    expect(popText(first)).not.toContain('联调时');
    cleanup();
    const stale = vi
      .fn<LoadSource>()
      .mockResolvedValue(
        success({ ...original, originalVersionId: 'ver-test-2' }),
      );
    const second = setup(stale);
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(second)).toContain('读取失败'));
  });

  it('rejects a malformed response instead of rendering it', async () => {
    const load = vi.fn<LoadSource>().mockResolvedValue({
      status: 'success',
      source: { ...original, playbackUrl: 'https://example.test/a.mp3' },
    } as unknown as SourceReadResult);
    const view = setup(load);
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(view)).toContain('读取失败'));
    expect(popText(view)).not.toContain('联调时');
  });

  it('drops a response that arrives after unmounting', async () => {
    let resolve!: (value: SourceReadResult) => void;
    const load = vi.fn<LoadSource>(
      () => new Promise<SourceReadResult>((r) => (resolve = r)),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = setup(load);
    fireEvent.mouseEnter(view.container.firstElementChild as Element);
    view.unmount();
    await act(async () => resolve(success(original)));
    expect(error).not.toHaveBeenCalled();
  });
});

describe('SourceCite identity and focus', () => {
  const other: SourceReference = {
    fragmentId: 'frag-test-2',
    originalVersionId: 'ver-test-2',
    location: { kind: 'spreadsheet', sheet: '观察表', cell: 'D9' },
  };
  const otherSource: Source = {
    ...other,
    excerpt: '另一条引用的原文',
    originalTitle: '合成观察表',
    recordedByName: null,
    sourceType: 'spreadsheet',
    sourceCategory: 'original',
    demo: true,
  };

  it('does not show or reuse a read that belongs to the previous reference', async () => {
    let resolveFirst!: (value: SourceReadResult) => void;
    const load = vi.fn<LoadSource>((input) =>
      input.fragmentId === reference.fragmentId
        ? new Promise<SourceReadResult>((r) => (resolveFirst = r))
        : Promise.resolve(success(otherSource)),
    );
    const view = setup(load);
    const user = userEvent.setup();
    await user.hover(mark());
    view.rerender(<SourceCite source={other} index="原文" loadSource={load} />);
    expect(popText(view)).toContain('「观察表」D9');
    expect(popText(view)).not.toContain('读取失败');
    await act(async () => resolveFirst(success(original)));
    expect(popText(view)).not.toContain('联调时能独立定位问题');
    await user.unhover(mark());
    await user.hover(mark());
    await waitFor(() => expect(popText(view)).toContain('另一条引用的原文'));
    expect(load).toHaveBeenCalledTimes(2);
    expect(load.mock.calls[1]![0]).toEqual({
      fragmentId: 'frag-test-2',
      originalVersionId: 'ver-test-2',
    });
  });

  it('forgets a finished read when the reference changes', async () => {
    const load = vi
      .fn<LoadSource>()
      .mockResolvedValueOnce(success(original))
      .mockResolvedValueOnce(success(otherSource));
    const view = setup(load);
    const user = userEvent.setup();
    await user.hover(mark());
    await waitFor(() => expect(popText(view)).toContain('联调时'));
    view.rerender(<SourceCite source={other} index="原文" loadSource={load} />);
    expect(popText(view)).not.toContain('联调时');
    await user.unhover(mark());
    await user.hover(mark());
    await waitFor(() => expect(popText(view)).toContain('另一条引用的原文'));
  });

  it('keeps the popover closable by an outside click after retrying', async () => {
    const load = vi
      .fn<LoadSource>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(success(original));
    const view = render(
      <>
        <SourceCite source={reference} index="原文" loadSource={load} />
        <button type="button">页面其他位置</button>
      </>,
    );
    const user = userEvent.setup();
    await user.tab();
    await waitFor(() => expect(popText(view)).toContain('读取失败'));
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '重试' }),
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(popText(view)).toContain('联调时'));
    expect(document.activeElement).toBe(mark());
    await user.click(screen.getByRole('button', { name: '页面其他位置' }));
    expect(mark().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('SourceCite popover size', () => {
  it('asks the open popover to reposition once the read result changes its height', async () => {
    let resolve!: (value: SourceReadResult) => void;
    const load = vi.fn<LoadSource>(
      () => new Promise<SourceReadResult>((r) => (resolve = r)),
    );
    setup(load);
    const resized = vi.fn();
    window.addEventListener('resize', resized);
    await userEvent.setup().hover(mark());
    const afterLoading = resized.mock.calls.length;
    await act(async () => resolve(success(original)));
    expect(resized.mock.calls.length).toBeGreaterThan(afterLoading);
    window.removeEventListener('resize', resized);
  });
});

describe('SourceCite recordings', () => {
  it('shows the time range and excerpt without any play button', async () => {
    const recording: SourceReference = {
      fragmentId: 'frag-test-r',
      originalVersionId: 'ver-test-r',
      location: { kind: 'recording', startMs: 192_000, endMs: 208_000 },
    };
    const load = vi.fn<LoadSource>().mockResolvedValue(
      success({
        ...recording,
        excerpt: '每个方案的验收标准都写清楚了',
        originalTitle: '合成录音',
        recordedByName: null,
        sourceType: 'recording',
        sourceCategory: 'original',
        demo: true,
      }),
    );
    const view = setup(load, recording);
    await userEvent.setup().hover(mark());
    await waitFor(() => expect(popText(view)).toContain('每个方案的验收标准'));
    expect(popText(view)).toContain('录音 · 03:12–03:28');
    expect(screen.queryByRole('button', { name: '播放这一段' })).toBeNull();
  });
});
