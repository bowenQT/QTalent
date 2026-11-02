// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WorkbenchSample from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
  usePathname: () => '/dev/workbench',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const sample = (role?: string) =>
  WorkbenchSample({ searchParams: Promise.resolve({ role }) });

describe('workbench sample route', () => {
  it('answers 404 in a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(sample('mentor')).rejects.toThrow('not-found');
  });

  it('answers 404 for an unknown role', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(sample('admin')).rejects.toThrow('not-found');
    await expect(sample()).rejects.toThrow('not-found');
  });

  it('renders each role inside the shell outside production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    for (const [role, name] of [
      ['manager', '程远'],
      ['hr', '苏晚'],
      ['mentor', '叶青'],
    ]) {
      const { unmount } = render(await sample(role));
      expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
        new RegExp(`，${name}$`),
      );
      expect(
        screen.getByRole('complementary', { name: '主导航' }),
      ).toBeTruthy();
      unmount();
    }
    render(await sample('mentor'));
    expect(screen.getAllByRole('link', { name: '记一件事' })).toHaveLength(10);
  });
});
