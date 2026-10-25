// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { AccessDenied } from './AccessDenied';
const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('signs out without needing a business account or role, then returns to login', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetch);
  render(<AccessDenied />);
  fireEvent.click(screen.getByRole('button', { name: '退出并切换账号' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  expect(fetch).toHaveBeenCalledWith(
    '/api/auth/sign-out',
    expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
it.each(['rejected', 'network'])(
  'keeps a retryable exit after %s failure',
  async (failure) => {
    const fetch = vi.fn();
    if (failure === 'network') fetch.mockRejectedValue(new Error('offline'));
    else fetch.mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetch);
    render(<AccessDenied />);
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账号' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    fetch.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: '退出并切换账号' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  },
);
it('prevents repeated exits while the sign-out request is pending', async () => {
  let finish!: (value: { ok: boolean }) => void;
  const fetch = vi.fn(
    () =>
      new Promise<{ ok: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetch);
  render(<AccessDenied />);
  const button = screen.getByRole('button', { name: '退出并切换账号' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledOnce();
  expect((button as HTMLButtonElement).disabled).toBe(true);
  finish({ ok: true });
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
});
