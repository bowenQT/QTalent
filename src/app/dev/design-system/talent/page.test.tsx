// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import TalentDesignSystem from './page';

const { reduced } = vi.hoisted(() => ({ reduced: vi.fn(() => false) }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not-found');
  },
}));
vi.mock('motion/react', async () => {
  const original =
    await vi.importActual<typeof import('motion/react')>('motion/react');
  return { ...original, useReducedMotion: reduced };
});

beforeEach(() => {
  reduced.mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('talent design-system sub-route', () => {
  it('answers 404 in a production build, outside the parent page gate', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(TalentDesignSystem).toThrow('not-found');
  });

  it('renders every talent component outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const view = render(<TalentDesignSystem />);
    expect(
      screen.getByRole('heading', { name: '人才与 AI 组件' }),
    ).toBeTruthy();
    for (const selector of [
      '.n-src--human',
      '.n-badge--conflict',
      '.n-score[data-state="absent"]',
      '.n-trail',
      '.n-block[data-state="light"]',
      '.n-cite__locked',
      '.n-event',
      '.n-anchor',
      '.n-history',
      '.n-spectrum',
      '.n-miniquad',
    ])
      expect(view.container.querySelector(selector), selector).not.toBeNull();
  });

  it('streams the mock step by step and finishes at once under reduced motion', () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const view = render(<TalentDesignSystem />);
    const demo = () =>
      view.container.querySelector('[data-sample="stream"]') as HTMLElement;
    const states = () =>
      [...demo().querySelectorAll('.n-trail__step')].map((el) =>
        el.getAttribute('data-state'),
      );
    expect(states()).toEqual(['active', 'pending', 'pending', 'pending']);
    expect(demo().querySelectorAll('p')).toHaveLength(1);
    expect(demo().querySelector('.n-caret')).not.toBeNull();
    act(() => vi.advanceTimersByTime(900));
    expect(states()).toEqual(['done', 'active', 'pending', 'pending']);
    expect(demo().querySelectorAll('p')).toHaveLength(2);
    // Each tick re-arms the next timer after React commits, so advance one step per act.
    for (let step = 0; step < 3; step++) act(() => vi.advanceTimersByTime(900));
    expect(states()).toEqual(['done', 'done', 'done', 'done']);
    expect(demo().querySelector('.n-caret')).toBeNull();
    cleanup();
    reduced.mockReturnValue(true);
    const instant = render(<TalentDesignSystem />);
    const done = instant.container.querySelector(
      '[data-sample="stream"]',
    ) as HTMLElement;
    expect(
      [...done.querySelectorAll('.n-trail__step')].map((el) =>
        el.getAttribute('data-state'),
      ),
    ).toEqual(['done', 'done', 'done', 'done']);
    expect(done.querySelectorAll('p')).toHaveLength(3);
  });
});
