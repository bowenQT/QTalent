// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  JudgeProgress,
  JudgeProgressBadge,
  JudgeProgressList,
  judgeProgressStates,
  type JudgeProgressProps,
  type JudgeProgressState,
} from './JudgeProgress';
import { matchStates } from './MatchState';

afterEach(cleanup);

describe('JudgeProgress', () => {
  it('shows the four processing labels with an icon, never a match state or colour class', () => {
    const view = render(
      <>
        {judgeProgressStates.map((state) => (
          <JudgeProgressBadge key={state} state={state} />
        ))}
      </>,
    );
    const badges = [...view.container.querySelectorAll('.n-badge')];
    expect(badges.map((el) => el.textContent)).toEqual([
      '排队中',
      '判断中',
      '待人工判断',
      '失败',
    ]);
    expect(badges.map((el) => el.getAttribute('data-state'))).toEqual([
      'queued',
      'judging',
      'review',
      'failed',
    ]);
    expect(
      badges.map((el) =>
        el.querySelector('use')?.getAttribute('href')?.replace('#i-', ''),
      ),
    ).toEqual(['clock', 'pulse', 'info', 'x']);
    for (const badge of badges) {
      expect(badge.className).toBe('n-badge n-badge--proc');
      for (const match of matchStates)
        expect(badge.className).not.toContain(`n-badge--${match}`);
    }
  });

  it('lays out subject and note per row, and offers retry only on a failed row', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <JudgeProgressList>
        <JudgeProgress state="queued" subject="王一舟" note="前面还有 2 位" />
        <JudgeProgress state="judging" subject="周屿" note="逐项核对 · 2/4" />
        <JudgeProgress state="review" subject="顾南" note="等你来定" />
        <JudgeProgress
          state="failed"
          subject="宋小满"
          note="判断服务超时"
          retry={{ label: '重新判断', onRetry: retry }}
        />
      </JudgeProgressList>,
    );
    expect(view.container.querySelector('ul')?.className).toBe(
      'n-reqs n-reqs--proc',
    );
    const rows = [...view.container.querySelectorAll('li')];
    expect(
      rows.map((li) => li.querySelector('.n-proc__note')?.textContent),
    ).toEqual(['前面还有 2 位', '逐项核对 · 2/4', '等你来定', '判断服务超时']);
    expect(view.container.querySelectorAll('button')).toHaveLength(1);
    expect(rows[3].querySelector('button')?.className).toBe(
      'n-btn n-btn--sm n-btn--ghost n-proc__retry',
    );
    await user.click(screen.getByRole('button', { name: '重新判断' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps a failed row without retry plain, and can disable the retry', () => {
    const view = render(
      <>
        <JudgeProgress state="failed" subject="宋小满" note="超时" />
        <JudgeProgress
          state="failed"
          subject="顾南"
          note="超时"
          retry={{
            label: '重新判断',
            onRetry: () => undefined,
            disabled: true,
          }}
        />
      </>,
    );
    const buttons = view.container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].disabled).toBe(true);
  });

  it('ignores a retry passed to a state that cannot fail', () => {
    const view = render(
      <JudgeProgress
        {...({
          state: 'judging',
          subject: '周屿',
          note: '进行中',
          retry: { label: '重新判断', onRetry: () => undefined },
        } as unknown as JudgeProgressProps)}
      />,
    );
    expect(view.container.querySelector('button')).toBeNull();
  });

  it('rejects values that only look like a state, not just wrong strings', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // Object.hasOwn would accept the first two, then the retry button silently vanishes.
    for (const state of [
      ['failed'],
      new String('failed'),
      1,
      null,
      undefined,
      {},
    ]) {
      expect(() =>
        render(<JudgeProgressBadge state={state as JudgeProgressState} />),
      ).toThrow('Unknown judge progress state');
      expect(() =>
        render(
          <JudgeProgress
            {...({
              state,
              subject: 'x',
              note: 'y',
              retry: { label: '重新判断', onRetry: () => undefined },
            } as unknown as JudgeProgressProps)}
          />,
        ),
      ).toThrow('Unknown judge progress state');
    }
    vi.restoreAllMocks();
  });

  it('rejects states outside the four', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const state of [
      'yes',
      'done',
      'running',
      'toString',
      '__proto__',
      '',
    ]) {
      expect(() =>
        render(<JudgeProgressBadge state={state as JudgeProgressState} />),
      ).toThrow('Unknown judge progress state');
      expect(() =>
        render(
          <JudgeProgress
            {...({
              state,
              subject: 'x',
              note: 'y',
            } as unknown as JudgeProgressProps)}
          />,
        ),
      ).toThrow('Unknown judge progress state');
    }
    vi.restoreAllMocks();
  });
});
