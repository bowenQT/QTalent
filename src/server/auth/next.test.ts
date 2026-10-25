import { beforeEach, expect, it, vi } from 'vitest';
import { authHandlers, requireSession } from './next';
const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  session: vi.fn(),
  handler: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../access', () => ({ verifyAccessRequest: mocks.verify }));
vi.mock('./index', () => ({
  getSession: mocks.session,
  getAuth: () => ({ handler: mocks.handler }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue(undefined);
  mocks.session.mockResolvedValue({ user: { id: 'a' } });
  mocks.handler.mockResolvedValue(new Response('ok'));
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirected');
  });
});
it('verifies Access before resolving any session', async () => {
  expect(await requireSession()).toEqual({ user: { id: 'a' } });
  expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.session.mock.invocationCallOrder[0],
  );
});
it('rejects invalid Access without reading session', async () => {
  mocks.verify.mockRejectedValue(new Error('Access denied'));
  await expect(requireSession()).rejects.toThrow('Access denied');
  expect(mocks.session).not.toHaveBeenCalled();
});
it('redirects missing session to login', async () => {
  mocks.session.mockResolvedValue(null);
  await expect(requireSession()).rejects.toThrow('redirected');
  expect(mocks.redirect).toHaveBeenCalledWith('/login');
});
it.each(['GET', 'POST'] as const)(
  'auth handler %s verifies Access before handling',
  async (method) => {
    await authHandlers[method](new Request('http://localhost/api/auth'));
    expect(mocks.verify).toHaveBeenCalled();
    expect(mocks.handler).toHaveBeenCalled();
  },
);
it('auth endpoint denies invalid Access without invoking auth', async () => {
  mocks.verify.mockRejectedValue(new Error('denied'));
  await expect(
    authHandlers.POST(new Request('http://localhost/api/auth')),
  ).rejects.toThrow('denied');
  expect(mocks.handler).not.toHaveBeenCalled();
});
