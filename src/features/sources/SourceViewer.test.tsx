// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceViewer } from './SourceViewer';
import type {
  OriginalContent,
  OriginalState,
  ViewerSource,
} from './viewer-model';

const scrollIntoView = vi.fn();
let reducedMotion = false;

beforeEach(() => {
  scrollIntoView.mockClear();
  reducedMotion = false;
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reducedMotion : false,
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function source(
  location: ViewerSource['location'],
  extra: Partial<ViewerSource> = {},
): ViewerSource {
  return {
    fragmentId: 'frag-test-1',
    originalVersionId: 'ver-test-1',
    location,
    excerpt: '引用的原文',
    title: null,
    recordedByName: null,
    demo: true,
    provenance: { kind: 'original' },
    ...extra,
  };
}
const ready = (content: OriginalContent): OriginalState => ({
  status: 'ready',
  content,
});
const pending: OriginalState = { status: 'not_connected' };

function show(viewer: ViewerSource, original: OriginalState) {
  return render(<SourceViewer source={viewer} original={original} />);
}
/** The one element the viewer located, which it scrolled to and focused. */
function located() {
  const all = document.querySelectorAll<HTMLElement>(
    '[aria-current="location"]',
  );
  expect(all).toHaveLength(1);
  const element = all[0]!;
  expect(scrollIntoView.mock.contexts.at(-1)).toBe(element);
  expect(document.activeElement).toBe(element);
  return element;
}
const original = () =>
  screen.getByRole('region', { name: '原件' }) as HTMLElement;

describe('SourceViewer locates every kind of original', () => {
  it('document: the cited paragraph on its page, with the excerpt marked', () => {
    show(
      source(
        { kind: 'document', page: 2, paragraph: '1' },
        { excerpt: '拆成 5 个 Issue', title: '合成周报' },
      ),
      ready({
        kind: 'document',
        paragraphs: [
          { page: 1, paragraph: '1', text: '第一页第一段，拆成 5 个 Issue。' },
          { page: 2, paragraph: '1', text: '第二页第一段，拆成 5 个 Issue。' },
          { page: 2, paragraph: '2', text: '第二页第二段。' },
        ],
      }),
    );
    const target = located();
    expect(target.textContent).toContain('第二页第一段');
    expect(target.querySelector('mark')?.textContent).toBe('拆成 5 个 Issue');
    expect(original().textContent).toContain('第 1 页');
    expect(original().textContent).toContain('第 2 页');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      '合成周报',
    );
  });

  it('document without pages: no page labels, and a whole cited paragraph has no inner mark', () => {
    show(
      source({ kind: 'document', paragraph: '2' }, { excerpt: '整段引用' }),
      ready({
        kind: 'document',
        paragraphs: [
          { paragraph: '1', text: '第一段' },
          { paragraph: '2', text: '整段引用' },
        ],
      }),
    );
    expect(located().textContent).toBe('第 2 段整段引用');
    expect(original().querySelector('mark')).toBeNull();
    expect(original().textContent).not.toContain('页');
  });

  it('pdf: the cited page with exactly the stored text range marked', () => {
    show(
      source({
        kind: 'pdf',
        page: 3,
        textRange: { start: 2, end: 6 },
      }),
      ready({
        kind: 'pdf',
        pages: [
          { page: 2, text: '上一页' },
          { page: 3, text: '前文引用的话后文' },
        ],
      }),
    );
    const target = located();
    expect(target.querySelector('figcaption')?.textContent).toBe('第 3 页');
    expect(target.querySelector('mark')?.textContent).toBe('引用的话');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'PDF 原件',
    );
  });

  it('pdf: a range outside the page text still locates the page but marks nothing', () => {
    show(
      source({ kind: 'pdf', page: 1, textRange: { start: 5, end: 99 } }),
      ready({ kind: 'pdf', pages: [{ page: 1, text: '很短的页' }] }),
    );
    expect(located().querySelector('mark')).toBeNull();
  });

  it('spreadsheet: the cited cell under its column letter and row number', () => {
    show(
      source({ kind: 'spreadsheet', sheet: '观察表', cell: 'C3' }),
      ready({
        kind: 'spreadsheet',
        sheet: '观察表',
        cells: [
          { cell: 'B2', text: '表头' },
          { cell: 'C3', text: '引用的单元格' },
        ],
      }),
    );
    const target = located();
    expect(target.textContent).toBe('引用的单元格');
    const row = target.closest('tr')!;
    expect(row.querySelector('th')?.textContent).toBe('3');
    const headers = [...document.querySelectorAll('thead th')].map(
      (th) => th.textContent,
    );
    expect(headers).toEqual(['行号', 'B', 'C']);
    expect(screen.getByText('工作表「观察表」')).toBeTruthy();
  });

  it('spreadsheet: another sheet is shown without marking any cell', () => {
    show(
      source({ kind: 'spreadsheet', sheet: '观察表', cell: 'A1' }),
      ready({
        kind: 'spreadsheet',
        sheet: '汇总',
        cells: [{ cell: 'A1', text: '别的表' }],
      }),
    );
    expect(document.querySelector('[aria-current="location"]')).toBeNull();
    expect(screen.queryByRole('button', { name: '定位到原文' })).toBeNull();
  });

  it('presentation: the cited slide with the excerpt marked', () => {
    show(
      source({ kind: 'presentation', slide: 2 }, { excerpt: '提升到 34%' }),
      ready({
        kind: 'presentation',
        slides: [
          { slide: 1, text: '封面' },
          { slide: 2, text: '结果\n点击率提升到 34%' },
        ],
      }),
    );
    const target = located();
    expect(target.querySelector('figcaption')?.textContent).toBe('第 2 页');
    expect(target.querySelector('mark')?.textContent).toBe('提升到 34%');
  });

  it('recording: the overlapping transcript line, marked on the track, playback pending', () => {
    show(
      source({ kind: 'recording', startMs: 192_000, endMs: 208_000 }),
      ready({
        kind: 'recording',
        playback: null,
        segments: [
          { startMs: 170_000, endMs: 191_000, speaker: '助教', text: '前一句' },
          {
            startMs: 192_000,
            endMs: 208_000,
            speaker: '导师',
            text: '引用的话',
          },
          { startMs: 209_000, endMs: 226_000, text: '后一句' },
        ],
      }),
    );
    const target = located();
    expect(target.querySelector('time')?.textContent).toBe('03:12');
    expect(target.querySelector('mark')?.textContent).toBe('引用的话');
    expect(target.textContent).toContain('导师');
    expect(
      screen
        .getByRole('button', { name: '播放这一段' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(original().textContent).toContain('03:12–03:28 · 播放待接入');
    const track = screen.getByRole('img', { name: /录音中引用的时间段/ });
    expect(track.querySelectorAll('i')).toHaveLength(64);
    expect(track.querySelectorAll('i.is-mark').length).toBeGreaterThan(0);
  });

  it('recording: without an overlapping line the player itself is located', () => {
    show(
      source({ kind: 'recording', startMs: 500_000, endMs: 510_000 }),
      ready({
        kind: 'recording',
        playback: null,
        segments: [{ startMs: 0, endMs: 10_000, text: '开场' }],
      }),
    );
    expect(located().querySelector('.n-player')).toBeTruthy();
  });

  it('image: the region drawn over the original at its stored proportions', () => {
    show(
      source({
        kind: 'image',
        region: { left: 0.1, top: 0.25, right: 0.6, bottom: 0.5 },
      }),
      ready({
        kind: 'image',
        image: { url: 'blob:test-image', width: 300, height: 600 },
      }),
    );
    const target = located();
    expect(target.getAttribute('aria-label')).toBe(
      '引用的区域：左 10%，上 25%，宽 50%，高 25%',
    );
    expect(target.style.left).toBe('10%');
    expect(target.style.width).toBe('50%');
    expect(
      screen.getByRole('img', { name: '图片原件' }).getAttribute('src'),
    ).toBe('blob:test-image');
    expect(screen.queryByText('原图待接入')).toBeNull();
  });

  it('image: before the original is connected the region still shows where it is', () => {
    show(
      source({
        kind: 'image',
        region: { left: 0, top: 0, right: 1, bottom: 0.5 },
      }),
      pending,
    );
    located();
    expect(screen.getByText('原图待接入')).toBeTruthy();
    expect(screen.queryByRole('img', { name: '图片原件' })).toBeNull();
  });

  it('code: the submitted snapshot numbered from its start line, never linking the repository', () => {
    const commit = '3f9c1e7b2d4085e6f1a9c3b7d2e4f6081a5c9d37';
    show(
      source(
        {
          kind: 'code',
          repository: 'git.example.com/demo/repo',
          commit,
          path: 'src/a.ts',
          startLine: 12,
          endLine: 13,
        },
        {
          excerpt: 'const a = 1;\r\nconst b = 2;\n',
          provenance: {
            kind: 'submitted_code_snapshot',
            notice: '提交的代码快照',
          },
        },
      ),
      pending,
    );
    const target = located();
    const rows = [...target.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual(['12const a = 1;', '13const b = 2;']);
    expect(screen.getByText('提交的代码快照')).toBeTruthy();
    // 完整提交号直接显示，触屏和键盘也能核对，不只放在悬停提示里。
    expect(screen.getByText(commit).getAttribute('title')).toBeNull();
    expect(
      screen.getByText('git.example.com/demo/repo').closest('a'),
    ).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'src/a.ts',
    );
    // The snapshot is the original here: the extract does not repeat it.
    expect(
      screen.queryByText('const a = 1;', { selector: 'blockquote' }),
    ).toBeNull();
  });

  it('baseline: the snapshot notice and original location, with 演示', () => {
    show(
      source(
        {
          kind: 'snapshot_field',
          fieldPath: 'events.1.note',
          originalLocation: '第 4 行',
        },
        {
          title: '合成基线',
          provenance: {
            kind: 'prototype_baseline',
            notice: '原型基线 2e51b50，评语按原意压缩',
          },
        },
      ),
      pending,
    );
    const target = located();
    expect(target.textContent).toContain('原型基线 2e51b50，评语按原意压缩');
    expect(target.textContent).toContain('原表位置：第 4 行');
    expect(screen.getByText('演示')).toBeTruthy();
    expect(document.body.textContent).not.toContain('events.1.note');
    expect(screen.queryByText('原件待接入')).toBeNull();
  });
});

describe('SourceViewer before the original is connected', () => {
  it.each([
    [
      { kind: 'document', paragraph: '3' } as const,
      '接入后在这里打开全文，标出第 3 段',
    ],
    [
      { kind: 'pdf', page: 2, textRange: { start: 0, end: 1 } } as const,
      '接入后在这里打开第 2 页，标出引用的文字',
    ],
    [
      { kind: 'spreadsheet', sheet: '观察表', cell: 'C7' } as const,
      '接入后在这里打开工作表「观察表」，标出 C7',
    ],
    [{ kind: 'presentation', slide: 4 } as const, '接入后在这里打开第 4 页'],
    [
      { kind: 'video', startMs: 725_000, endMs: 740_000 } as const,
      '接入后在这里播放 12:05–12:20，标出这一段转写',
    ],
  ])('shows the extract and what will open for %o', (location, text) => {
    show(source(location), pending);
    expect(screen.getByRole('status').textContent).toBe(`原件待接入${text}`);
    expect(
      screen.getByText('引用的原文', { selector: 'blockquote' }),
    ).toBeTruthy();
    expect(document.querySelector('[aria-current="location"]')).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '定位到原文' })).toBeNull();
  });

  it('treats content of another kind as not connected instead of marking it', () => {
    show(
      source({ kind: 'recording', startMs: 0, endMs: 1000 }),
      ready({ kind: 'video', playback: null, segments: [] }),
    );
    expect(screen.getByText('原件待接入')).toBeTruthy();
  });

  it.each([
    [
      { status: 'restricted' } as const,
      '完整原件在你的查看范围之外',
      '这里只给你看引用的这一段，见「提取」',
    ],
    [{ status: 'failed' } as const, '原件暂时打不开', '刷新页面再试'],
  ])('says why the original stays closed: %o', (original, title, text) => {
    show(
      source({ kind: 'pdf', page: 2, textRange: { start: 0, end: 3 } }),
      original,
    );
    expect(screen.getByRole('status').textContent).toBe(`${title}${text}`);
    expect(
      screen.getByText('引用的原文', { selector: 'blockquote' }),
    ).toBeTruthy();
    cleanup();
    show(
      source({
        kind: 'image',
        region: { left: 0, top: 0, right: 1, bottom: 0.5 },
      }),
      original,
    );
    expect(screen.getByText(`${title}，${text}`)).toBeTruthy();
    expect(screen.queryByText('原图待接入')).toBeNull();
    expect(screen.queryByRole('img', { name: '图片原件' })).toBeNull();
  });
});

describe('SourceViewer extract panel', () => {
  it('labels provenance, location and recorder, and returns to the cited place on request', async () => {
    show(
      source(
        { kind: 'presentation', slide: 1 },
        { recordedByName: '演示记录人', demo: false },
      ),
      ready({
        kind: 'presentation',
        slides: [{ slide: 1, text: '引用的原文' }],
      }),
    );
    const extract = screen.getByRole('region', { name: '提取' });
    expect(extract.textContent).toContain('原始事实');
    expect(extract.textContent).toContain('演示文稿 · 第 1 页');
    expect(extract.textContent).not.toContain('演示文稿原件');
    expect(screen.queryByText('演示')).toBeNull();
    expect(screen.getByText(/演示记录人记录/)).toBeTruthy();
    const target = located();
    target.blur();
    scrollIntoView.mockClear();
    await userEvent.click(screen.getByRole('button', { name: '定位到原文' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(target);
  });

  it('labels a historical interview as 历史资料', () => {
    show(
      source(
        { kind: 'pdf', page: 1, textRange: { start: 0, end: 2 } },
        { provenance: { kind: 'historical_evaluation' } },
      ),
      pending,
    );
    expect(screen.getByRole('region', { name: '提取' }).textContent).toContain(
      '历史资料',
    );
  });

  it('scrolls smoothly, and jumps instead when reduced motion is asked for', () => {
    const viewer = source({ kind: 'presentation', slide: 1 });
    const content = ready({
      kind: 'presentation',
      slides: [{ slide: 1, text: '页' }],
    });
    show(viewer, content);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
    cleanup();
    reducedMotion = true;
    show(viewer, content);
    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: 'center',
      behavior: 'auto',
    });
  });

  it('goes back in history when there is a previous page, and home otherwise', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    show(source({ kind: 'presentation', slide: 1 }), pending);
    const link = screen.getByRole('link', { name: '返回' });
    expect(link.getAttribute('href')).toBe('/');
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    expect(fireEvent.click(link)).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    expect(fireEvent.click(link)).toBe(true);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('SourceViewer playback', () => {
  type Fake = {
    paused: boolean;
    currentTime: number;
    duration: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  };
  /** jsdom has no media playback: give the element a controllable state. */
  function fake(element: HTMLMediaElement): Fake {
    const state: Fake = {
      paused: true,
      currentTime: 0,
      duration: 600,
      play: vi.fn(async () => {
        state.paused = false;
        fireEvent.play(element);
      }),
      pause: vi.fn(() => {
        state.paused = true;
        fireEvent.pause(element);
      }),
    };
    for (const key of ['paused', 'currentTime', 'duration'] as const)
      Object.defineProperty(element, key, {
        configurable: true,
        get: () => state[key],
        set: (value: number) => {
          (state as Record<string, unknown>)[key] = value;
        },
      });
    element.play = state.play as unknown as HTMLMediaElement['play'];
    element.pause = state.pause as unknown as HTMLMediaElement['pause'];
    return state;
  }
  const media = (kind: 'recording' | 'video') =>
    show(
      source({ kind, startMs: 192_000, endMs: 208_000 }),
      ready({
        kind,
        playback: { url: 'blob:test-media' },
        segments: [{ startMs: 192_000, endMs: 208_000, text: '引用的话' }],
      } as OriginalContent),
    );

  it('waits at the cited start, plays only that range, and stops at its end', async () => {
    const view = media('recording');
    const element = view.container.querySelector('audio')!;
    expect(element.getAttribute('src')).toBe('blob:test-media');
    const state = fake(element);
    fireEvent.loadedMetadata(element);
    expect(state.currentTime).toBe(192);
    expect(view.container.textContent).toContain('03:12 / 10:00');

    state.currentTime = 400;
    await userEvent.click(screen.getByRole('button', { name: '播放这一段' }));
    expect(state.currentTime).toBe(192);
    expect(state.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();

    state.currentTime = 200;
    fireEvent.timeUpdate(element);
    expect(state.pause).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain('03:20 / 10:00');
    state.currentTime = 208.2;
    fireEvent.timeUpdate(element);
    expect(state.pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '播放这一段' })).toBeTruthy();
  });

  it('pauses on a second press and resumes from inside the range', async () => {
    const view = media('recording');
    const element = view.container.querySelector('audio')!;
    const state = fake(element);
    fireEvent.loadedMetadata(element);
    await userEvent.click(screen.getByRole('button', { name: '播放这一段' }));
    await userEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(state.pause).toHaveBeenCalledTimes(1);
    state.currentTime = 200;
    await userEvent.click(screen.getByRole('button', { name: '播放这一段' }));
    expect(state.currentTime).toBe(200);
    expect(state.play).toHaveBeenCalledTimes(2);
  });

  it('says playback failed when the browser refuses to play or load', async () => {
    const view = media('recording');
    const element = view.container.querySelector('audio')!;
    const state = fake(element);
    state.play.mockRejectedValueOnce(new Error('denied'));
    await userEvent.click(screen.getByRole('button', { name: '播放这一段' }));
    expect(view.container.textContent).toContain('播放失败，刷新页面再试');
    expect(
      screen
        .getByRole('button', { name: '播放这一段' })
        .hasAttribute('disabled'),
    ).toBe(true);
    cleanup();
    const again = media('recording');
    fireEvent.error(again.container.querySelector('audio')!);
    expect(again.container.textContent).toContain('播放失败，刷新页面再试');
  });

  it('shows the picture for a video and keeps unknown durations from the transcript', () => {
    const view = media('video');
    const element = screen.getByLabelText('视频原件') as HTMLVideoElement;
    expect(element.tagName).toBe('VIDEO');
    const state = fake(element);
    state.duration = Number.NaN;
    fireEvent.loadedMetadata(element);
    expect(view.container.textContent).toContain('03:12 / 03:28');
  });
});
