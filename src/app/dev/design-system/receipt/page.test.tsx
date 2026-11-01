// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ReceiptSample from './page';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});
const sample = async (state?: string) =>
  render(await ReceiptSample({ searchParams: Promise.resolve({ state }) }));
const label = (container: HTMLElement) =>
  container.querySelector('.n-rstate')?.textContent;

describe('receipt sample', () => {
  it('answers 404 in a production build', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await expect(sample()).rejects.toThrow('not-found');
  });

  it('switches between the three receipts, defaulting to the one under review', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(label((await sample()).container)).toBe('待核对');
    cleanup();
    expect(label((await sample('processing')).container)).toBe('处理中');
    cleanup();
    expect(label((await sample('done')).container)).toBe('已完成');
  });
});
