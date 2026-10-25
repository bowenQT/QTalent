// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { EventCard } from './EventCard';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EventCard', () => {
  it('lays out head, SBI, citations and separated suggested and confirmed scores', () => {
    const view = render(
      <EventCard
        id="ev-1"
        person={{ name: '林知远', hue: 200, demo: true }}
        origin="obs"
        dateLabel="10-21"
        recorder="叶青"
        ruleVersion="rubric-v1"
        title="需求变更后主动给出两个备选方案"
        cites={[
          {
            markLabel: '录音',
            access: 'granted',
            source: { kind: 'timestamp', title: '复盘', location: '03:12' },
            quote: '原话',
          },
          {
            markLabel: '受限',
            access: 'locked',
            source: { kind: 'paragraph', title: '纪要', location: '第 4 段' },
            lockedText: '看不到原文',
          },
        ]}
        sbi={{ situation: '背景', behavior: '行为', impact: '影响' }}
        scores={[
          { dimension: '智慧力', state: 'suggested', value: 4 },
          {
            dimension: '内生动力',
            state: 'confirmed',
            value: 3,
            aiOriginal: 4,
            by: '叶青',
          },
          { dimension: '坚毅力', state: 'insufficient' },
          { dimension: '领导力', state: 'absent' },
        ]}
      />,
    );
    const card = view.container.querySelector('article') as HTMLElement;
    expect(card.id).toBe('ev-1');
    const head = card.querySelector('.n-event__head') as HTMLElement;
    expect(head.querySelector('.n-event__who')?.textContent).toBe('林知远');
    expect(head.querySelector('.n-badge--demo')?.textContent).toBe('演示');
    expect(head.querySelector('.n-src--obs')?.textContent).toBe('管理观察');
    expect(head.textContent).toContain('10-21 · 叶青记录');
    expect(head.textContent).toContain('规则 rubric-v1');
    expect(
      [...card.querySelectorAll('.n-cite__mark')].map((el) => el.textContent),
    ).toEqual(['1', '2']);
    expect(
      [...card.querySelectorAll('.n-event__sbar dt')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['情境', '行为', '影响']);
    expect(
      [...card.querySelectorAll('.n-score')].map((el) =>
        el.getAttribute('data-state'),
      ),
    ).toEqual(['ai', 'confirmed', 'unknown', 'absent']);
    expect(card.querySelectorAll('.n-badge--ai')).toHaveLength(1);
    expect(card.textContent).not.toContain('原话看不到');
  });

  it('marks missing SBI parts, unknown dates and history origin', () => {
    const view = render(
      <EventCard
        origin="hist"
        recorder="苏晚"
        title="入职前的项目"
        sbi={{ behavior: '主导交付' }}
      />,
    );
    const card = view.container.firstElementChild as HTMLElement;
    expect(card.textContent).toContain('时间未知 · 苏晚记录');
    expect(card.querySelector('.n-src--fact')?.textContent).toBe('历史资料');
    expect(card.querySelector('.n-event__who')).toBeNull();
    expect(
      [...card.querySelectorAll('.n-event__sbar dd')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['待补充', '主导交付', '待补充']);
    expect(card.querySelector('.n-event__scores')).toBeNull();
  });

  it('omits the SBI block when nothing was written', () => {
    const view = render(
      <EventCard
        origin="self"
        recorder="本人"
        title="t"
        sbi={{}}
        scores={[]}
      />,
    );
    expect(view.container.querySelector('.n-event__sbar')).toBeNull();
    expect(view.container.querySelector('.n-event__scores')).toBeNull();
  });

  it('shows a lock instead of any score when the page hides them', () => {
    const view = render(
      <EventCard
        origin="self"
        recorder="本人"
        title="t"
        sbi={{}}
        scoresHidden="本人视角已隐藏维度分"
        {...({
          scores: [{ dimension: '智慧力', state: 'confirmed', value: 5 }],
        } as object)}
      />,
    );
    expect(view.container.querySelector('.n-lock')?.textContent).toBe(
      '本人视角已隐藏维度分',
    );
    expect(view.container.querySelector('.n-score')).toBeNull();
    expect(view.container.querySelector('.n-score__dot')).toBeNull();
  });
});

describe('EventCard citation slot', () => {
  it('places page-rendered citations after the title and works without a rule version', () => {
    const view = render(
      <EventCard
        origin="obs"
        recorder="叶青"
        title="关键事件"
        sbi={{}}
        citeSlot={<button data-testid="lazy-cite">原文</button>}
      />,
    );
    const title = view.container.querySelector(
      '.n-event__title',
    ) as HTMLElement;
    expect(title.textContent).toBe('关键事件原文');
    expect(title.querySelector('[data-testid="lazy-cite"]')).not.toBeNull();
    expect(
      view.container.querySelector('.n-event__head')?.textContent,
    ).not.toContain('规则');
  });
});
