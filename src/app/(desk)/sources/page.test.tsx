// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ShellData } from '@/contracts/shell';
import type { Source } from '@/contracts/sources';
import SourcesPage, { metadata } from './page';
import SourceNotFound from './not-found';
import Loading from './loading';
import ErrorPage from './error';

const { shellQuery, sourceQuery } = vi.hoisted(() => ({
  shellQuery: vi.fn(),
  sourceQuery: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shellQuery }));
vi.mock('@/server/queries/sources', () => ({
  readSourceForCurrentUser: sourceQuery,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('not-found');
  },
}));

const shell: ShellData = {
  account: {
    id: 'test',
    name: '测试账号',
    email: 'test@qtalent.test',
    roles: ['manager'],
    hue: 20,
    roleLabel: '管理者',
    scopeLabel: '全公司',
  },
  navigation: [],
  counts: { status: 'not_connected' },
  recent: { status: 'not_connected' },
  canSearch: false,
  isAdmin: false,
  role: 'manager',
};
const EXCERPT = '合成引用：按方案 B 拆分剩余任务';
const TITLE = '合成观察表';
const source: Source = {
  fragmentId: 'frag-test-1',
  originalVersionId: 'ver-test-1',
  location: { kind: 'spreadsheet', sheet: '观察表', cell: 'C7' },
  excerpt: EXCERPT,
  originalTitle: TITLE,
  recordedByName: null,
  sourceType: 'spreadsheet',
  sourceCategory: 'original',
  demo: true,
};
const params = (value: Record<string, string | string[] | undefined>) => ({
  searchParams: Promise.resolve(value),
});
const valid = params({ fragment: 'frag-test-1', version: 'ver-test-1' });

beforeEach(() => {
  vi.clearAllMocks();
  shellQuery.mockResolvedValue(shell);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('source viewer route', () => {
  it('reads with only the two identifiers and shows the extract with the original pending', async () => {
    sourceQuery.mockResolvedValue({ status: 'success', source });
    render(await SourcesPage(valid));
    expect(sourceQuery).toHaveBeenCalledWith({
      fragmentId: 'frag-test-1',
      originalVersionId: 'ver-test-1',
    });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(TITLE);
    expect(screen.getByText(EXCERPT, { selector: 'blockquote' })).toBeTruthy();
    expect(screen.getByText('原件待接入')).toBeTruthy();
    expect(screen.getByText('演示')).toBeTruthy();
  });

  it('keeps the tab title free of the original name', () => {
    expect(metadata).toEqual({ title: '原件 · Niu-Talent' });
  });

  it.each([
    ['missing version', { fragment: 'frag-test-1' }],
    ['repeated fragment', { fragment: ['a', 'b'], version: 'v' }],
    ['blank fragment', { fragment: ' ', version: 'v' }],
  ])('treats a %s as an invalid link without reading', async (_, search) => {
    await expect(SourcesPage(params(search))).rejects.toThrow('not-found');
    expect(sourceQuery).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'validation_error'] as const)(
    'answers %s with the shared invalid-link page',
    async (status) => {
      sourceQuery.mockResolvedValue(
        status === 'not_found'
          ? { status, message: '来源不存在或不可见' }
          : { status, fieldErrors: {}, input: {} },
      );
      await expect(SourcesPage(valid)).rejects.toThrow('not-found');
    },
  );

  it('shows the business-view page for an account without business reads, with no source content', async () => {
    sourceQuery.mockResolvedValue({
      status: 'forbidden',
      message: '当前账号没有业务读取权限',
    });
    const html = renderToStaticMarkup(await SourcesPage(valid));
    expect(html).toContain('这一页属于业务视角');
    expect(html).not.toContain(EXCERPT);
    expect(html).not.toContain(TITLE);
    expect(html).not.toContain('当前账号没有业务读取权限');
  });

  it('asks to re-enter when the original version changed', async () => {
    sourceQuery.mockResolvedValue({ status: 'conflict', message: '版本冲突' });
    const html = renderToStaticMarkup(await SourcesPage(valid));
    expect(html).toContain('原件版本已更新');
    expect(html).not.toContain('版本冲突');
  });

  it('stops at the access page when there is no shell', async () => {
    shellQuery.mockResolvedValue(null);
    render(await SourcesPage(valid));
    expect(screen.getByText('查看权限已更新')).toBeTruthy();
    expect(sourceQuery).not.toHaveBeenCalled();
  });
});

describe('source viewer route states', () => {
  it('uses one invalid-link page for missing and out-of-scope originals', () => {
    render(<SourceNotFound />);
    expect(screen.getByRole('heading', { name: '原件链接失效' })).toBeTruthy();
    expect(screen.getByText(/超出你的查看范围/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '返回' })).toBeTruthy();
  });

  it('announces loading and offers a reload after a failure', () => {
    render(<Loading />);
    expect(screen.getByRole('status').textContent).toBe('原件加载中');
    cleanup();
    const reset = vi.fn();
    render(<ErrorPage reset={reset} />);
    screen.getByRole('button', { name: '重新加载' }).click();
    expect(reset).toHaveBeenCalledOnce();
  });
});
