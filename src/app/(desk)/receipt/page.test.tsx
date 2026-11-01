// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ReceiptPage, { metadata } from './page';
import ReceiptNotFound from './not-found';

const { shell } = vi.hoisted(() => ({ shell: vi.fn() }));
vi.mock('@/server/queries/shell', () => ({ getShellPage: shell }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  notFound: () => {
    throw new Error('not-found');
  },
}));

afterEach(cleanup);
const page = async (batch?: string | string[]) =>
  render(await ReceiptPage({ searchParams: Promise.resolve({ batch }) }));

describe('/receipt', () => {
  it('keeps batch content out of the tab title', () => {
    expect(metadata.title).toBe('回执 · Niu-Talent');
  });

  it('asks a signed-out or revoked session to sign in again', async () => {
    shell.mockResolvedValue(null);
    await page('b-1');
    expect(screen.getByRole('heading').textContent).toBe('查看权限已更新');
  });

  it('shows administrators the business-view notice only', async () => {
    shell.mockResolvedValue({ isAdmin: true, role: 'admin' });
    await page('b-1');
    expect(screen.getByText('这一页属于业务视角')).toBeTruthy();
    expect(screen.queryByText('回执')).toBeNull();
  });

  it('treats a missing or repeated batch as a broken link', async () => {
    shell.mockResolvedValue({ isAdmin: false, role: 'hrbp' });
    await expect(page()).rejects.toThrow('not-found');
    await expect(page(['a', 'b'])).rejects.toThrow('not-found');
    await expect(page(' ')).rejects.toThrow('not-found');
  });

  it('says the batch read is not connected, with no counts or files', async () => {
    shell.mockResolvedValue({ isAdmin: false, role: 'mentor' });
    const { container } = await page('b-1');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('回执');
    expect(screen.getByText('待接入')).toBeTruthy();
    expect(container.querySelector('.n-rsum, .n-file, .n-rcpt')).toBeNull();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('answers a broken link with a way back to the workbench', () => {
    render(<ReceiptNotFound />);
    expect(screen.getByText('回执链接失效')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '回到工作台' }).getAttribute('href'),
    ).toBe('/work');
  });
});
