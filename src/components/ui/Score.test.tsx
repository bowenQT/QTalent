// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Score, type ScoreProps } from './Score';

afterEach(cleanup);

const row = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.n-score') as HTMLElement;
const dots = (el: HTMLElement) => [...el.querySelectorAll('.n-score__dot')];

describe('Score states', () => {
  it('keeps 资料不足 and 未体现 apart and gives neither a number or a dot', () => {
    const insufficient = render(
      <Score dimension="坚毅力" state="insufficient" note="涉及但缺少结果" />,
    );
    const a = row(insufficient);
    insufficient.unmount();
    const absent = render(
      <Score dimension="领导力" state="absent" note="这件事未体现" />,
    );
    const b = row(absent);
    expect(a.getAttribute('data-state')).toBe('unknown');
    expect(b.getAttribute('data-state')).toBe('absent');
    expect(a.querySelector('.n-score__empty')?.textContent).toBe('资料不足');
    expect(b.querySelector('.n-score__empty')?.textContent).toBe('未体现');
    expect(a.querySelector('.n-score__empty')?.className).toContain(
      'n-badge--unknown',
    );
    expect(b.querySelector('.n-score__empty')?.className).not.toContain(
      'n-badge--unknown',
    );
    for (const el of [a, b]) {
      expect(dots(el)).toHaveLength(0);
      expect(el.querySelector('[aria-label]')).toBeNull();
      expect(el.textContent).not.toMatch(/\d/);
    }
  });

  it('drops a value smuggled past the types for the two empty states', () => {
    for (const state of ['insufficient', 'absent'] as const) {
      const view = render(
        <Score
          {...({
            dimension: '智慧力',
            state,
            value: 4,
          } as unknown as ScoreProps)}
        />,
      );
      expect(dots(row(view))).toHaveLength(0);
      expect(row(view).textContent).not.toMatch(/\d/);
      view.unmount();
    }
  });

  it('never styles an AI suggestion as confirmed', () => {
    const suggested = render(
      <Score dimension="智慧力" state="suggested" value={4} note="锚点 4" />,
    );
    const ai = row(suggested);
    expect(ai.getAttribute('data-state')).toBe('ai');
    expect(ai.querySelector('.n-badge--ai')?.textContent).toBe('AI 建议');
    expect(ai.querySelector('.ink-hand')).toBeNull();
    expect(ai.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(
      '智慧力 4 分（AI 建议，未确认）',
    );
    suggested.unmount();
    const confirmed = render(
      <Score dimension="智慧力" state="confirmed" value={4} by="叶青" />,
    );
    const done = row(confirmed);
    expect(done.getAttribute('data-state')).toBe('confirmed');
    expect(done.querySelector('.n-badge--ai')).toBeNull();
    expect(done.querySelector('.ink-hand')?.textContent).toBe('叶青');
    expect(done.querySelector('[aria-label]')?.getAttribute('aria-label')).toBe(
      '智慧力 4 分',
    );
  });

  it('fills exactly the scored dots and marks the calibrated state', () => {
    const view = render(
      <Score dimension="专业度" state="calibrated" value={3} by="苏晚" />,
    );
    const el = row(view);
    expect(el.getAttribute('data-state')).toBe('calibrated');
    expect(dots(el).map((dot) => dot.classList.contains('is-on'))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(el.querySelector('.n-score__note')?.textContent).toBe('苏晚校准');
  });

  it('shows the gap to the AI proposal as ghost dots and a signed delta', () => {
    const lower = render(
      <Score
        dimension="内生动力"
        state="confirmed"
        value={3}
        aiOriginal={5}
        by="叶青"
      />,
    );
    const el = row(lower);
    expect(dots(el).map((dot) => dot.className)).toEqual([
      'n-score__dot is-on',
      'n-score__dot is-on',
      'n-score__dot is-on',
      'n-score__dot is-ghost',
      'n-score__dot is-ghost',
    ]);
    expect(el.querySelector('.n-score__delta')?.textContent).toBe('-2');
    expect(el.querySelector('.n-score__note')?.textContent).toContain(
      'AI 原为 5',
    );
    lower.unmount();
    const higher = render(
      <Score
        dimension="内生动力"
        state="confirmed"
        value={4}
        aiOriginal={3}
        by="叶青"
      />,
    );
    expect(
      dots(row(higher)).some((dot) => dot.classList.contains('is-ghost')),
    ).toBe(false);
    expect(row(higher).querySelector('.n-score__delta')?.textContent).toBe(
      '+1',
    );
    higher.unmount();
    const same = render(
      <Score
        dimension="内生动力"
        state="confirmed"
        value={4}
        aiOriginal={4}
        by="叶青"
      />,
    );
    expect(row(same).querySelector('.n-score__delta')).toBeNull();
  });

  it('renders the inline variant as dots only', () => {
    const view = render(
      <Score dimension="智慧力" state="confirmed" value={2} by="叶青" inline />,
    );
    const el = view.container.querySelector('.n-score--inline');
    expect(el?.getAttribute('data-state')).toBe('confirmed');
    expect(el?.querySelector('.n-score__dim')).toBeNull();
    expect(el?.querySelectorAll('.is-on')).toHaveLength(2);
  });

  it('offers the revision history only when the caller wires it', async () => {
    const open = vi.fn();
    render(
      <Score
        dimension="智慧力"
        state="calibrated"
        value={4}
        by="苏晚"
        onOpenHistory={open}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '修订历史' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('requires a scorer on every confirmed or calibrated score', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const state of ['confirmed', 'calibrated'] as const)
      for (const by of [undefined, '', '  ']) {
        expect(() =>
          render(
            <Score
              {...({
                dimension: 'x',
                state,
                value: 3,
                by,
              } as unknown as ScoreProps)}
            />,
          ),
        ).toThrow('needs its scorer');
      }
    // @ts-expect-error a confirmed score without a scorer must not type-check
    const unsigned: ScoreProps = {
      dimension: 'x',
      state: 'confirmed',
      value: 3,
    };
    expect(unsigned.state).toBe('confirmed');
    vi.restoreAllMocks();
  });

  it('rejects values and states outside the model', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const value of [0, 6, 3.5]) {
      expect(() =>
        render(
          <Score
            {...({
              dimension: 'x',
              state: 'confirmed',
              value,
            } as unknown as ScoreProps)}
          />,
        ),
      ).toThrow('Score value must be 1-5');
    }
    expect(() =>
      render(
        <Score
          {...({
            dimension: 'x',
            state: 'confirmed',
            value: 3,
            by: '叶青',
            aiOriginal: 9,
          } as unknown as ScoreProps)}
        />,
      ),
    ).toThrow('Score value must be 1-5');
    for (const state of ['total', 'toString', '__proto__']) {
      expect(() =>
        render(
          <Score
            {...({ dimension: 'x', state, value: 3 } as unknown as ScoreProps)}
          />,
        ),
      ).toThrow('Unknown score state');
    }
    vi.restoreAllMocks();
  });
});
