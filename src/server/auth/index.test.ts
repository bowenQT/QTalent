import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  adapter: vi.fn(),
  audit: vi.fn(),
  session: vi.fn(),
}));
vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }));
vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: mocks.adapter,
}));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../env', () => ({
  getEnv: () => ({
    BETTER_AUTH_SECRET: 'test-only-long-secret',
    BETTER_AUTH_URL: 'http://localhost',
  }),
}));
vi.mock('../platform/audit', () => ({ recordAudit: mocks.audit }));
it('keeps signup disabled, no stale session cache, transactional adapter, login audited', async () => {
  mocks.betterAuth.mockReturnValue({ api: { getSession: mocks.session } });
  mocks.session.mockResolvedValue({ user: { id: 'a' } });
  const { getAuth, getSession } = await import('./index');
  expect(getAuth()).toBe(getAuth());
  expect(mocks.betterAuth).toHaveBeenCalledTimes(1);
  const options = mocks.betterAuth.mock.calls[0][0];
  expect(options.emailAndPassword).toEqual({
    enabled: true,
    disableSignUp: true,
  });
  expect(options.session.cookieCache.enabled).toBe(false);
  expect(mocks.adapter).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ transaction: true, provider: 'pg' }),
  );
  await options.databaseHooks.session.create.after({ userId: 'a', id: 's' });
  expect(mocks.audit).toHaveBeenCalledWith(
    {},
    { actorId: 'a', action: 'auth.login', resourceId: 's' },
  );
  const headers = new Headers();
  expect(await getSession(headers)).toEqual({ user: { id: 'a' } });
  expect(mocks.session).toHaveBeenCalledWith({ headers });
});
