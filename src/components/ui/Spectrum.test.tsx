// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Spectrum, type SpectrumGroup } from './Spectrum';
import {
  MiniQuad,
  quadrantNames,
  quadrants,
  type MiniQuadReference,
} from './MiniQuad';

afterEach(cleanup);

const groups: SpectrumGroup[] = [
  {
    title: '潜力 · 核心',
    dimensions: [
      {
        id: 'mot',
        name: '内生动力',
        state: 'scored',
        bins: { 2: { earlier: 1, recent: 0 }, 3: { earlier: 0, recent: 1 } },
        events: [
          {
            value: 3,
            dateLabel: '10-22',
            by: '叶青',
            title: '结营后继续跟进',
            href: '#ev-1',
            calibrated: true,
            recent: true,
          },
        ],
      },
      {
        id: 'wis',
        name: '智慧力',
        state: 'scored',
        bins: { 4: { earlier: 1, recent: 3 }, 5: { earlier: 0, recent: 0 } },
        events: [
          {
            value: 4,
            dateLabel: '08-30',
            by: '宋川',
            title: '排查靠试错',
            recent: false,
          },
        ],
      },
      {
        id: 'grit',
        name: '坚毅力',
        state: 'insufficient',
        missing: '还没有受挫后如何反应的事件',
      },
    ],
  },
];

const rows = (el: HTMLElement) => [...el.querySelectorAll('.n-spectrum__row')];

describe('Spectrum', () => {
  it('gives each dimension its own mean and never an overall one', () => {
    const view = render(<Spectrum groups={groups} />);
    const stats = [...view.container.querySelectorAll('.n-spectrum__stat b')];
    // 内生动力 (2+3)/2 and 智慧力 (4*4)/4; a grand mean would be 3.4 or 3.0.
    expect(stats.map((el) => el.textContent)).toEqual(['2.5', '4.0']);
    expect(view.container.querySelectorAll('.n-spectrum__mean')).toHaveLength(
      2,
    );
    expect(view.container.textContent).not.toMatch(
      /3\.4|3\.0|总|综合|平均|%|排名|排序/,
    );
    const meanLeft = [
      ...view.container.querySelectorAll<HTMLElement>('.n-spectrum__mean'),
    ].map((el) => el.style.left);
    expect(meanLeft).toEqual(['37.5%', '75%']);
  });

  it('draws bins by count, with the recent share inside and a count label past one', () => {
    const view = render(<Spectrum groups={groups} />);
    const bins = [
      ...view.container.querySelectorAll<HTMLElement>('.n-spectrum__bin'),
    ];
    // 智慧力 also carries an all-zero bin at 5, which must not draw a NaN-sized dot.
    expect(bins).toHaveLength(3);
    expect(bins.some((el) => el.title.startsWith('5 分'))).toBe(false);
    const four = bins.find((el) => el.title.startsWith('4 分'))!;
    expect(four.title).toBe('4 分：4 条，其中近 3 个月 3 条');
    expect(parseFloat(four.style.width)).toBeCloseTo(10 + 6 * Math.sqrt(3), 5);
    const inner = four.querySelector('i') as HTMLElement;
    expect(parseFloat(inner.style.width)).toBeCloseTo(
      parseFloat(four.style.width) * Math.sqrt(3 / 4),
      5,
    );
    expect(
      [...view.container.querySelectorAll('.n-spectrum__count')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['4']);
  });

  it('draws a dimension without scores as missing material, not as a low score', () => {
    const view = render(<Spectrum groups={groups} />);
    const missing = rows(view.container).find(
      (el) => !(el instanceof HTMLButtonElement),
    )!;
    expect(missing.querySelector('.n-spectrum__track')?.className).toContain(
      'is-unknown',
    );
    expect(missing.textContent).toContain(
      '资料不足 · 还没有受挫后如何反应的事件',
    );
    expect(missing.querySelector('.n-spectrum__mean')).toBeNull();
    expect(missing.querySelector('b')).toBeNull();
    expect(missing.textContent).toContain('0 条');
  });

  it('expands rows independently and lists events with the leftover count', async () => {
    const user = userEvent.setup();
    const view = render(<Spectrum groups={groups} />);
    const mot = screen.getByRole('button', { name: /内生动力/ });
    const wis = screen.getByRole('button', { name: /智慧力/ });
    expect(mot.getAttribute('aria-label')).toBe(
      '内生动力，均值 2.5，2 条事件，点开查看',
    );
    const lists = [
      ...view.container.querySelectorAll<HTMLElement>('.n-spectrum__list'),
    ];
    expect(lists.map((el) => el.hidden)).toEqual([true, true]);
    await user.click(mot);
    expect(mot.getAttribute('aria-expanded')).toBe('true');
    expect(lists.map((el) => el.hidden)).toEqual([false, true]);
    expect(lists[0].querySelector('a')?.getAttribute('href')).toBe('#ev-1');
    expect(lists[0].textContent).toContain('已校准');
    expect(lists[0].textContent).toContain('还有 1 条，打开档案时间线查看');
    await user.click(wis);
    expect(lists.map((el) => el.hidden)).toEqual([false, false]);
    expect(lists[1].querySelector('li')?.className).toBe('is-old');
    expect(lists[1].textContent).toContain('还有 3 条');
    await user.click(mot);
    expect(lists.map((el) => el.hidden)).toEqual([true, false]);
  });

  it('flags thin evidence and rejects a scored dimension with nothing counted', () => {
    const thin: SpectrumGroup[] = [
      {
        title: 't',
        dimensions: [
          {
            id: 'a',
            name: '领导力',
            state: 'scored',
            bins: { 3: { earlier: 1, recent: 0 } },
            events: [],
          },
        ],
      },
    ];
    const view = render(<Spectrum groups={thin} />);
    expect(view.container.querySelector('.cnt')?.textContent).toBe(
      '1 条 · 证据少',
    );
    view.unmount();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      render(
        <Spectrum
          groups={[
            {
              title: 't',
              dimensions: [
                { id: 'a', name: 'x', state: 'scored', bins: {}, events: [] },
              ],
            },
          ]}
        />,
      ),
    ).toThrow('at least one counted event');
    vi.restoreAllMocks();
  });

  it('renders the page head slot only when given', () => {
    const view = render(<Spectrum groups={[]} header={<span>头部</span>} />);
    expect(view.container.querySelector('.n-spectrum__head')?.textContent).toBe(
      '头部',
    );
    view.rerender(<Spectrum groups={[]} />);
    expect(view.container.querySelector('.n-spectrum__head')).toBeNull();
    expect(
      view.container.querySelectorAll('.n-spectrum__scale span'),
    ).toHaveLength(7);
  });
});

describe('MiniQuad', () => {
  const placed: MiniQuadReference = {
    state: 'placed',
    quadrant: 'hl',
    x: 0.3,
    y: 0.3,
  };

  it('is a 2x2 with exactly the four named quadrants', () => {
    expect([...quadrants].sort()).toEqual(['hh', 'hl', 'lh', 'll']);
    expect(Object.values(quadrantNames).sort()).toEqual(
      ['专业骨干', '双高', '待观察', '高潜待练'].sort(),
    );
  });

  it('plots calibrations oldest to newest, marks the latest, and the current reference', () => {
    const view = render(
      <MiniQuad
        calibrations={[
          { label: 'W2', quadrant: 'll', x: 0.2, y: 0.9 },
          { label: '结营', quadrant: 'hl', x: 0.3, y: 0.3 },
        ]}
        reference={placed}
      />,
    );
    const el = view.container.querySelector('.n-miniquad') as HTMLElement;
    const points = [...el.querySelectorAll<HTMLElement>('.n-miniquad__pt')];
    expect(points).toHaveLength(3);
    expect(points.map((p) => p.className)).toEqual([
      'n-miniquad__pt nt-ref',
      'n-miniquad__pt',
      'n-miniquad__pt is-now',
    ]);
    expect(points[1].style.top).toBe(`${0.9 * 83}%`);
    expect(el.querySelector('path')?.getAttribute('d')).toBe(
      `M${0.2 * 132} ${0.9 * 80} L${0.3 * 132} ${0.3 * 80}`,
    );
    expect(el.querySelector('.n-miniquad__cap')?.textContent).toBe(
      'W2 → 结营 · 高潜待练',
    );
    expect(el.getAttribute('aria-label')).toContain('当前参考位置：高潜待练');
  });

  it('places no dot when material is insufficient, and says so', () => {
    const view = render(
      <MiniQuad calibrations={[]} reference={{ state: 'insufficient' }} />,
    );
    expect(view.container.querySelectorAll('.n-miniquad__pt')).toHaveLength(0);
    expect(view.container.querySelector('path')).toBeNull();
    expect(view.container.querySelector('.n-miniquad__cap')?.textContent).toBe(
      '还没有正式校准',
    );
    expect(
      view.container.firstElementChild?.getAttribute('aria-label'),
    ).toContain('当前参考位置：资料不足');
  });

  it('leaves the caption to the page when calibration is not available yet', () => {
    const none = render(
      <MiniQuad calibrations={[]} reference={placed} emptyCaption={null} />,
    );
    expect(none.container.querySelector('.n-miniquad__cap')).toBeNull();
    expect(none.container.textContent).not.toContain('还没有正式校准');
    expect(none.container.firstElementChild?.getAttribute('aria-label')).toBe(
      '当前参考位置：高潜待练',
    );
    none.unmount();
    const custom = render(
      <MiniQuad
        calibrations={[]}
        reference={{ state: 'insufficient' }}
        emptyCaption="校准后显示历次位置"
      />,
    );
    expect(
      custom.container.querySelector('.n-miniquad__cap')?.textContent,
    ).toBe('校准后显示历次位置');
  });

  it('rejects a quadrant outside the four', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const quadrant of ['mm', 'toString', '__proto__']) {
      expect(() =>
        render(
          <MiniQuad
            calibrations={[
              { label: 'x', quadrant: quadrant as never, x: 0.5, y: 0.5 },
            ]}
            reference={{ state: 'insufficient' }}
          />,
        ),
      ).toThrow('Unknown quadrant');
    }
    expect(() =>
      render(
        <MiniQuad
          calibrations={[]}
          reference={{
            state: 'placed',
            quadrant: 'zz' as never,
            x: 0.5,
            y: 0.5,
          }}
        />,
      ),
    ).toThrow('Unknown quadrant');
    vi.restoreAllMocks();
  });
});
