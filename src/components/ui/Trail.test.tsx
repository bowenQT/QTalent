// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trail, type TrailStep } from './Trail';
import { StreamText } from './StreamText';

afterEach(cleanup);

const plan: TrailStep[] = [
  { id: 'read', label: '读取需求', state: 'done' },
  { id: 'scope', label: '检索 38 人', detail: '增长产品部', state: 'active' },
  { id: 'check', label: '逐项核对', state: 'pending' },
];

describe('Trail', () => {
  it('shows the three step states and marks only the active step as current', () => {
    const view = render(<Trail title="找 owner · 3 步" steps={plan} />);
    const steps = [...view.container.querySelectorAll('.n-trail__step')];
    expect(steps.map((el) => el.getAttribute('data-state'))).toEqual([
      'done',
      'active',
      'pending',
    ]);
    expect(steps.map((el) => el.getAttribute('aria-current'))).toEqual([
      null,
      'step',
      null,
    ]);
    expect(steps[1].querySelector('small')?.textContent).toBe('增长产品部');
  });

  it('collapses and expands from the keyboard with matching aria state', async () => {
    const user = userEvent.setup();
    const view = render(<Trail title="找 owner" steps={plan} />);
    const head = screen.getByRole('button', { name: '找 owner' });
    const trail = view.container.querySelector('.n-trail') as HTMLElement;
    const list = view.container.querySelector('.n-trail__steps') as HTMLElement;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(trail.getAttribute('data-open')).toBe('true');
    expect(head.getAttribute('aria-controls')).toBe(list.id);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(trail.getAttribute('data-open')).toBe('false');
    await user.keyboard(' ');
    expect(trail.getAttribute('data-open')).toBe('true');
  });

  it('can start collapsed', () => {
    const view = render(
      <Trail title="找 owner" steps={plan} defaultOpen={false} />,
    );
    expect(
      view.container.querySelector('.n-trail')?.getAttribute('data-open'),
    ).toBe('false');
  });

  it('rejects step states the stylesheet does not know', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const state of ['failed', 'in_progress', 'toString']) {
      expect(() =>
        render(
          <Trail
            title="t"
            steps={[{ id: 'a', label: 'x', state: state as never }]}
          />,
        ),
      ).toThrow('Unknown trail step state');
    }
    vi.restoreAllMocks();
  });

  it('keeps focus and the same nodes while steps and text stream in', async () => {
    const user = userEvent.setup();
    const view = render(
      <>
        <Trail title="找 owner" steps={plan.slice(0, 1)} />
        <StreamText segments={['第一段。']} streaming />
        <button>停止</button>
      </>,
    );
    const head = screen.getByRole('button', { name: '找 owner' });
    await user.tab();
    expect(document.activeElement).toBe(head);
    const firstStep = view.container.querySelector('.n-trail__step');
    const firstParagraph = view.container.querySelector('p');
    view.rerender(
      <>
        <Trail title="找 owner" steps={plan} />
        <StreamText segments={['第一段。', '第二段。']} streaming />
        <button>停止</button>
      </>,
    );
    expect(document.activeElement).toBe(head);
    expect(view.container.querySelector('.n-trail__step')).toBe(firstStep);
    expect(view.container.querySelector('p')).toBe(firstParagraph);
    expect(view.container.querySelectorAll('p')).toHaveLength(2);
    // Focus sitting on a later control is not pulled back either.
    screen.getByRole('button', { name: '停止' }).focus();
    view.rerender(
      <>
        <Trail title="找 owner" steps={plan} />
        <StreamText segments={['第一段。', '第二段。', '第三段。']} />
        <button>停止</button>
      </>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '停止' }),
    );
  });
});

describe('StreamText', () => {
  it('shows every received segment at once with one caret on the last paragraph', () => {
    const view = render(
      <StreamText segments={['读取需求。', '核对证据。']} streaming />,
    );
    const paragraphs = [...view.container.querySelectorAll('p')];
    expect(paragraphs.map((p) => p.textContent)).toEqual([
      '读取需求。',
      '核对证据。',
    ]);
    expect(view.container.querySelectorAll('.n-caret')).toHaveLength(1);
    expect(paragraphs[1].querySelector('.n-caret')).not.toBeNull();
    const live = view.container.firstElementChild as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('aria-busy')).toBe('true');
  });

  it('drops the caret and the busy flag when streaming ends', () => {
    const view = render(<StreamText segments={['完成。']} />);
    expect(view.container.querySelector('.n-caret')).toBeNull();
    expect(view.container.firstElementChild?.getAttribute('aria-busy')).toBe(
      'false',
    );
  });
});
