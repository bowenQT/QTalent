// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import InboxSample from './page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/dev/inbox',
  notFound: () => {
    throw new Error('not-found');
  },
}));
const open = (role?: string) =>
  InboxSample({ searchParams: Promise.resolve({ role }) });

beforeEach(() =>
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
);
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('待核对 sample route', () => {
  it('shows HR every kind and the mentor their own items', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    render(await open('hr'));
    expect(document.querySelectorAll('.n-verify')).toHaveLength(5);
    expect(screen.getAllByText('苏晚').length).toBeGreaterThan(0);
    cleanup();
    render(await open('mentor'));
    expect(document.querySelectorAll('.n-verify')).toHaveLength(2);
    expect(screen.getAllByText('叶青').length).toBeGreaterThan(0);
  });
  it('serves 404 for an unknown role and in production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(open('ceo')).rejects.toThrow('not-found');
    await expect(open()).rejects.toThrow('not-found');
    vi.stubEnv('NODE_ENV', 'production');
    await expect(open('hr')).rejects.toThrow('not-found');
  });
});
