// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { Person as PersonData } from '@/contracts/person';
import { personSchema } from '@/contracts/person';
import { fixtures } from '../../../tests/fixtures/p0-contracts';
import { Person } from './Person';
import { OriginalScale } from './OriginalScale';

const [manager, mentor, hr] = fixtures.person;
const loadSource = vi.fn(async () => ({
  status: 'not_found' as const,
  message: '不存在',
}));
const QUADRANT_WORDS = [
  '能力象限',
  '参考位置',
  '双高',
  '高潜待练',
  '专业骨干',
  '待观察',
];

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  Element.prototype.scrollIntoView = vi.fn();
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const show = (data: PersonData) =>
  render(<Person data={personSchema.parse(data)} loadSource={loadSource} />);

describe('Person views', () => {
  it('renders the manager variant with the reference position and mini quadrant', () => {
    const { container } = show(manager);
    expect(
      screen.getByRole('heading', { level: 1, name: /演示测试甲/ }),
    ).toBeTruthy();
    expect(screen.getByText('能力象限')).toBeTruthy();
    expect(screen.getByText('双高')).toBeTruthy();
    expect(screen.getByText('加分项 ≥ 4')).toBeTruthy();
    expect(container.querySelector('.n-miniquad')).toBeTruthy();
    // 校准未接入：小象限不写「还没有正式校准」，也不画历次点。
    expect(container.textContent).not.toContain('还没有正式校准');
    expect(container.querySelector('.n-miniquad__pt.is-now')).toBeNull();
    expect(container.querySelector('.n-miniquad__pt.nt-ref')).toBeTruthy();
    expect(container.textContent).not.toContain('未接入');
  });

  it('gives the mentor no quadrant, change or hidden-item hint', () => {
    const { container } = show(mentor);
    for (const word of QUADRANT_WORDS)
      expect(container.textContent).not.toContain(word);
    expect(container.querySelector('.n-miniquad')).toBeNull();
    expect(container.textContent).not.toMatch(/已隐藏|另有 \d+ 条/);
    expect(container.querySelector('#judgechg')).toBeNull();
  });

  it('shows insufficient, unknown and empty blocks without numbers', () => {
    const { container } = show(hr);
    expect(container.querySelector('#spectrum')?.textContent).toContain(
      '资料不足',
    );
    expect(container.querySelector('#spectrum .n-spectrum__row')).toBeNull();
    expect(container.querySelector('#timeline')?.textContent).toContain('未知');
    expect(container.querySelector('#timeline')?.textContent).toContain(
      '0 条关键事件',
    );
    expect(container.querySelector('#facts')?.textContent).toContain(
      '合成未知：尚不能确定',
    );
    expect(screen.getByText('参与的项目会出现在这里')).toBeTruthy();
    // 参考位置资料不足：不落点，附落位门槛。
    expect(container.querySelector('.n-miniquad__pt')).toBeNull();
    expect(screen.getByText(/落位门槛/)).toBeTruthy();
    // 资料不足与未知不写成 0。
    expect(container.textContent).not.toMatch(/(^|[^\d.])0 分|均值 0/);
    expect(container.querySelector('aside')?.textContent).not.toContain('0');
  });

  it('never prints a total, percentage, ranking or radar', () => {
    for (const data of [manager, mentor, hr]) {
      const { container } = show(data);
      expect(container.textContent).not.toMatch(/总分|%|排名|第 \d+ 名|雷达/);
      cleanup();
    }
  });
});

describe('summary', () => {
  it('signs human conclusions in ink and keeps AI inferences light and unsigned', () => {
    const { container } = show(manager);
    const ink = container.querySelector('#summary [data-state="ink"]');
    const light = container.querySelector('#summary [data-state="light"]');
    expect(ink?.textContent).toContain('合成人工结论');
    expect(ink?.querySelector('.n-block__sig')?.textContent).toBe('演示署名人');
    expect(light?.textContent).toContain('AI 推断');
    expect(light?.textContent).toContain('合成 AI 推断');
    expect(light?.querySelector('.n-block__sig')).toBeNull();
  });

  it('disappears when both parts are empty', () => {
    const { container } = show({
      ...mentor,
      summary: { status: 'empty' },
      aiInferences: { status: 'empty' },
    });
    expect(container.querySelector('#summary')).toBeNull();
  });

  it('states why a part is unknown or insufficient', () => {
    const { container } = show({
      ...mentor,
      summary: { status: 'unknown', reason: '署名日期还不能确定' },
      aiInferences: { status: 'insufficient_evidence', reason: '资料还不够' },
    });
    expect(container.querySelector('#summary')?.textContent).toContain(
      '署名日期还不能确定',
    );
    expect(container.querySelector('#summary')?.textContent).toContain(
      '资料还不够',
    );
  });
});

describe('facts and spectrum', () => {
  it('lists the newest confirmed key events with an original citation each', () => {
    const { container } = show(manager);
    const facts = container.querySelectorAll('#facts li');
    // 带待确认计数的冲突事件不进前三。
    expect([...facts].map((li) => li.querySelector('a')?.textContent)).toEqual([
      '合成事件一',
      '合成管理观察',
    ]);
    expect(facts[0].querySelector('.n-cite__mark')?.textContent).toBe('原文');
    expect(facts[0].textContent).toContain('演示项目 · 演示记录人记录');
  });

  it('shows the empty sentence when there are no key events', () => {
    show({ ...mentor, timeline: { status: 'empty' } });
    expect(screen.getByText('确认后的关键事件会出现在这里')).toBeTruthy();
    expect(screen.getByText('记录后的事件会出现在这里')).toBeTruthy();
  });

  it('draws one row per dimension with its own mean and count', () => {
    const { container } = show(manager);
    const spectrum = container.querySelector('#spectrum')!;
    expect(spectrum.textContent).toContain('已确认 1 条事件分');
    expect(spectrum.textContent).toContain('专业度（对标 2028 届）');
    expect(
      spectrum.querySelector('[title="test-rule-version-001"]'),
    ).toBeTruthy();
    expect(spectrum.textContent).toContain(
      '资料不足 · 近 12 个月没有新的确认分',
    );
  });
});

describe('timeline', () => {
  it('expands and collapses an event card', () => {
    const { container } = show(manager);
    const open = screen.getByRole('button', { name: '合成事件一' });
    const card = container.querySelector(
      `#${open.getAttribute('aria-controls')}`,
    ) as HTMLElement;
    expect(open.getAttribute('aria-expanded')).toBe('false');
    expect(card.hidden).toBe(true);
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(card.hidden).toBe(false);
    fireEvent.click(open);
    expect(card.hidden).toBe(true);
  });

  it('shows confirmed, insufficient, absent and conflicting scores without AI suggestions', () => {
    const { container } = show(manager);
    const card = container.querySelector('#ev-test-event-001 .n-event')!;
    expect(
      card.querySelector('[data-state="confirmed"] .ink-hand')?.textContent,
    ).toBe('演示评价人');
    expect(card.textContent).toContain('资料不足');
    expect(card.textContent).toContain('未体现');
    expect(card.textContent).not.toContain('AI 建议');
    const conflict = container.querySelector('#ev-test-event-002')!;
    expect(conflict.textContent).toContain('证据冲突 4 / 2');
    expect(conflict.textContent).toContain(
      '演示评价人甲、演示评价人乙分差 ≥ 2',
    );
    expect(conflict.textContent).toContain('待校准');
    expect(conflict.textContent).toContain('1 项待确认');
    expect(conflict.textContent).toContain(
      '多人事件 · 演示参与人甲（负责人）、演示参与人乙 · 各自按本人行为打分',
    );
    expect(conflict.textContent).toContain('本人：负责人');
    // 每条冲突评分各有自己的出处。
    expect(
      conflict.querySelectorAll('.n-event__scores .n-cite__mark'),
    ).toHaveLength(2);
  });

  it('keeps the anchor and rule version with each confirmed score', () => {
    const { container } = show(manager);
    const note = container.querySelector(
      '#ev-test-event-001 .n-score[data-state="confirmed"] [title]',
    );
    expect(note?.getAttribute('title')).toMatch(/ · test-rule-version-001$/);
  });

  it('marks restricted history and keeps the original scale', () => {
    const { container } = show(manager);
    const history = container.querySelector('#ev-test-history-performance')!;
    expect(history.textContent).toContain('管理受限');
    expect(history.textContent).toContain('含评价成分');
    expect(history.querySelector('.n-scale')?.textContent).toBe(
      '综合表现 良好',
    );
    expect(history.querySelector('.n-tl__note')).toBeNull();
    expect(history.querySelector('.n-tl__dot.is-hist')).toBeTruthy();
  });

  it('shows ordinary history and self reports with their place and source', () => {
    const { container } = show(mentor);
    const history = container.querySelector('#ev-test-history-evaluation')!;
    expect(history.textContent).toContain('历史资料');
    expect(history.querySelector('.n-tl__note')?.textContent).toContain(
      '保留原量表',
    );
    expect(history.querySelector('.n-cite__mark')).toBeTruthy();
    const self = container.querySelector('#ev-test-event-003')!;
    expect(self.textContent).toContain('本人自述');
    expect(self.querySelector('.n-tl__dot.is-self')).toBeTruthy();
    expect(container.textContent).not.toContain('时间未知');
  });

  it('opens the event named in the address on arrival', async () => {
    vi.useFakeTimers();
    window.location.hash = '#ev-test-event-001';
    show(manager);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(
      screen
        .getByRole('button', { name: '合成事件一' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('opens and focuses an event when an in-page link points at it', () => {
    show(manager);
    const link = screen.getByRole('link', { name: '合成管理观察' });
    fireEvent.click(link);
    const open = screen.getByRole('button', { name: '合成管理观察' });
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(open);
  });

  it('ignores links and hashes that point nowhere', async () => {
    vi.useFakeTimers();
    window.location.hash = '#ev-missing';
    const { container } = show(manager);
    await act(async () => {
      vi.runAllTimers();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const stray = document.createElement('a');
    stray.href = '#ev-nothing';
    container.append(stray);
    fireEvent.click(stray);
    fireEvent.click(screen.getByText('查看全部'));
    expect(
      container.querySelectorAll('.nt-tl-open[aria-expanded="true"]'),
    ).toHaveLength(0);
  });
});

describe('projects', () => {
  it('marks ended participation and does not link project names', () => {
    const { container } = show(manager);
    const rows = container.querySelectorAll('.n-members li');
    expect(rows[0].className).toBe('');
    expect(rows[0].textContent).toContain('成员 · 全职');
    expect(rows[0].textContent).toContain('07-01 起');
    expect(rows[1].className).toBe('is-left');
    expect(rows[1].textContent).toContain('03-01 – 06-30');
    expect(within(rows[0] as HTMLElement).queryByRole('link')).toBeNull();
  });
});

describe('OriginalScale', () => {
  it('keeps the original items and says it is not a dimension score', () => {
    render(
      <OriginalScale
        scaleName="面试评价表"
        items={[
          ['沟通', 'B+'],
          ['技术深度', '良好'],
        ]}
      />,
    );
    const group = screen.getByRole('group', {
      name: '面试评价表原量表，不是维度分',
    });
    expect(group.querySelector('.n-scale')?.textContent).toBe(
      '沟通 B+技术深度 良好',
    );
    expect(group.querySelector('.n-score')).toBeNull();
    expect(group.textContent).toContain('不是维度分');
  });
  it('refuses an empty scale', () => {
    expect(() =>
      render(<OriginalScale scaleName="面试" items={[]} />),
    ).toThrow();
  });
});
