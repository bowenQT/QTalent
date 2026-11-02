// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from './LoginForm';
const { replace, refresh } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('email-password login', () => {
  it('sends one same-origin request and enters projects on success', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch);
    // 同一标签页换账号登录：先清掉上一个账号的暂存
    sessionStorage.setItem('niu-talent:record-batch', '{"text":"演示原话"}');
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText('邮箱'), 'ceo@qtalent.test');
    await user.type(screen.getByLabelText('密码'), 'test-only-password');
    const form = screen.getByRole('button', { name: '登录' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects'));
    expect(sessionStorage.getItem('niu-talent:record-batch')).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      '/api/auth/sign-in/email',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify({
          email: 'ceo@qtalent.test',
          password: 'test-only-password',
        }),
      }),
    );
  });
  it.each([false, 'network'])(
    'shows a recoverable error and preserves inputs for %s',
    async (failure) => {
      const fetch = vi.fn();
      if (failure === 'network') fetch.mockRejectedValue(new Error('offline'));
      else fetch.mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetch);
      const user = userEvent.setup();
      render(<LoginForm />);
      await user.type(screen.getByLabelText('邮箱'), 'ceo@qtalent.test');
      await user.type(screen.getByLabelText('密码'), 'test-only-password');
      await user.click(screen.getByRole('button', { name: '登录' }));
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe(
        'ceo@qtalent.test',
      );
      expect(
        screen.getByRole('button', { name: '登录' }).hasAttribute('disabled'),
      ).toBe(false);
    },
  );
});
