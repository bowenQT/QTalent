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
import { NODE_RECORDS_NOT_CONNECTED, type NodeRecords } from './node-records';

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

  it('marks a graduation review as restricted like performance history', () => {
    const data = structuredClone(manager);
    if (data.timeline.status !== 'ready') throw new Error('ready timeline');
    data.timeline.data = data.timeline.data.map((entry) =>
      entry.id === 'test-history-performance'
        ? { ...entry, category: 'restricted-evaluation' }
        : entry,
    );
    const { container } = show(data);
    const review = container.querySelector('#ev-test-history-performance')!;
    expect(review.textContent).toContain('管理受限');
    expect(review.querySelector('.n-tl__note')).toBeNull();
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
    expect(window.location.hash).toBe('#ev-test-event-009');
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
  it('keeps the original items apart from dimension scores', () => {
    const { container } = render(
      <OriginalScale
        separate
        items={[
          ['沟通', 'B+'],
          ['管理能力', '非管理岗免评'],
        ]}
      />,
    );
    const scale = container.querySelector('.n-scale')!;
    expect(scale.textContent).toBe(
      '原量表 · 单独保存沟通 B+管理能力 · 非管理岗免评',
    );
    expect(scale.querySelector('.n-scale__tag')?.textContent).toBe(
      '原量表 · 单独保存',
    );
    expect(scale.querySelector('.is-na')?.textContent).toBe(
      '管理能力 · 非管理岗免评',
    );
    expect(container.querySelector('.n-score')).toBeNull();
    expect(container.textContent).not.toMatch(/不是维度分|不适用|认不出/);
  });
  it('leaves the tag out unless the scale is marked separate', () => {
    const { container } = render(<OriginalScale items={[['沟通', 'B+']]} />);
    expect(container.querySelector('.n-scale__tag')).toBeNull();
    expect(container.querySelector('.is-na')).toBeNull();
  });
  it('refuses an empty scale', () => {
    expect(() => render(<OriginalScale items={[]} />)).toThrow();
  });
});

describe('records waiting for their read', () => {
  it.each([
    ['manager', manager],
    ['hr', hr],
  ] as const)('lists them for the %s variant', (_, data) => {
    show(data);
    const list = screen.getByRole('list', { name: '待接入的记录' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '北森面评 · 待接入',
      '节点结论 · 待接入',
      '独立管理观察 · 待接入',
    ]);
  });
  it('shows none of them to the mentor', () => {
    const { container } = show(mentor);
    expect(screen.queryByRole('list', { name: '待接入的记录' })).toBeNull();
    expect(container.textContent).not.toMatch(/待接入|节点结论|北森面评/);
  });
});

describe('node records once their reads are connected', () => {
  const source = {
    fragmentId: 'test-node-source-001',
    originalVersionId: 'test-node-version-001',
    location: { kind: 'document' as const, page: 2, paragraph: 'p-1' },
  };
  const observation = (id: string) => ({
    kind: 'management_observation' as const,
    id,
    occurredOn: '2026-08-20',
    text: '最近两次站会都主动接了别人卡住的工单。',
    authorName: '演示管理者',
    recordedOn: '2026-08-21',
    sources: [source],
  });
  const connected: NodeRecords = {
    interviews: {
      status: 'ready',
      data: [
        {
          kind: 'interview',
          id: 'test-interview-001',
          title: '专业面试（北森）',
          occurredOn: '2026-03-12',
          interviewerName: '演示面试官',
          interviewerUnconfirmed: true,
          importedByName: '演示 HR',
          importedOn: '2026-09-01',
          scale: [
            ['专业能力', 'B+'],
            ['管理能力', '非管理岗免评'],
            ['面试结论', '通过'],
          ],
          sources: [source],
        },
      ],
    },
    conclusions: {
      status: 'ready',
      data: [
        {
          kind: 'node_conclusion',
          id: 'test-conclusion-node-001',
          occurredOn: '2026-09-03',
          nodeName: '试用期转正答辩',
          conclusion: '建议转正',
          basis: '两位评委都已确认本人评分。',
          version: 2,
          confirmedByName: '演示 HR',
          sources: [source],
        },
      ],
    },
    observations: { status: 'not_connected' },
  };
  const withRecords = (data: PersonData, records: NodeRecords) =>
    render(
      <Person
        data={personSchema.parse(data)}
        nodeRecords={records}
        loadSource={loadSource}
      />,
    );

  it('puts connected kinds into the timeline and keeps the rest pending', () => {
    const { container } = withRecords(manager, connected);
    const interview = container.querySelector('#ev-test-interview-001');
    expect(interview?.querySelector('.n-tl__title')?.textContent).toBe(
      '专业面试（北森）',
    );
    // 面试官与导入人分开署名；条目日期是面试日期，导入日期写在署名里。
    expect(interview?.querySelector('.n-tl__date')?.textContent).toBe('03-12');
    expect(interview?.querySelector('.n-tl__meta')?.textContent).toContain(
      '面试官 演示面试官（写的人待确认） · 演示 HR 09-01 导入',
    );
    expect(interview?.querySelector('.n-scale__tag')?.textContent).toBe(
      '原量表 · 单独保存',
    );
    expect(interview?.querySelector('.n-score')).toBeNull();

    const conclusion = container.querySelector('#ev-test-conclusion-node-001');
    expect(conclusion?.querySelector('.n-tl__title')?.textContent).toBe(
      '节点结论 · 建议转正',
    );
    expect(conclusion?.querySelector('.n-tl__meta')?.textContent).toContain(
      '试用期转正答辩 · 演示 HR 09-03 确认 · 第 2 版',
    );
    expect(conclusion?.querySelector('.n-tl__meta')?.textContent).toMatch(
      /· 人事动作另行办理$/,
    );
    expect(conclusion?.querySelector('.n-tl__note')?.textContent).toBe(
      '两位评委都已确认本人评分。',
    );

    const list = screen.getByRole('list', { name: '待接入的记录' });
    expect(list.textContent).toBe('独立管理观察 · 待接入');
  });

  it('shows an independent observation with who and when, and no score', () => {
    const { container } = withRecords(
      { ...hr, timeline: { status: 'empty' } },
      {
        ...NODE_RECORDS_NOT_CONNECTED,
        observations: { status: 'ready', data: [observation('test-obs-1')] },
      },
    );
    const item = container.querySelector('#ev-test-obs-1');
    expect(item?.querySelector('.n-tl__meta')?.textContent).toContain(
      '演示管理者 · 08-21 记录',
    );
    expect(item?.querySelector('.n-src--obs')).toBeTruthy();
    expect(item?.querySelector('.n-tl__dot')?.className).toBe('n-tl__dot');
    expect(item?.querySelector('.n-score, .n-scale')).toBeNull();
  });

  it('keeps the block state when the timeline itself is unknown', () => {
    // HR 夹具的契约时间线是「未知」：节点记录不冒充完整的时间线。
    const { container } = withRecords(hr, {
      ...NODE_RECORDS_NOT_CONNECTED,
      observations: { status: 'ready', data: [observation('test-obs-2')] },
    });
    expect(container.querySelector('#ev-test-obs-2')).toBeNull();
  });

  it('never shows them to the mentor even when passed', () => {
    const { container } = withRecords(mentor, connected);
    expect(container.textContent).not.toMatch(/节点结论|北森|待接入/);
  });
});
