import { describe, expect, it } from 'vitest';
import type { PersonData } from './person-data';
import { talentSources } from './person-data';
import { collectEvidence, orderedDimensions } from './person-evidence';
import { nodeFixture } from './person-test-helpers';
import {
  orderCapabilityDimensions,
  missingVisibleCapabilityEvidence,
} from './person-display-policy';

type Dimension = PersonData['dimensions'][number];
const catalogue = (): Dimension[] => [
  { id: 'prof', name: '专业度', axis: 'prof', core: true },
  { id: 'mot', name: '内生动力', axis: 'pot', core: true },
  { id: 'wis', name: '智慧力', axis: 'pot', core: true },
  { id: 'grit', name: '坚毅力', axis: 'pot', core: true },
  { id: 'lead', name: '领导力', axis: 'pot', core: false },
  { id: 'open', name: '开放性', axis: 'pot', core: false },
];
const ids = (rows: readonly Dimension[]) => rows.map((row) => row.id);

describe('能力谱展示顺序', () => {
  it('读取接入点直接输出原型顺序：核心维度为内生动力、智慧力、坚毅力', () => {
    const data = nodeFixture();
    // Catalogue rows arrive in ID order, the order the reader used to show.
    data.dimensions = [...catalogue()].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(ids(orderedDimensions(data))).toEqual([
      'prof',
      'mot',
      'wis',
      'grit',
      'lead',
      'open',
    ]);
  });
  it('未知维度保留原位置，其余组和维度保留原有稳定顺序', () => {
    const [prof, mot, wis, grit, lead, open] = catalogue();
    const unknown: Dimension = {
      id: 'future-core',
      name: '智慧力',
      axis: 'pot',
      core: true,
    };
    const input = [open!, grit!, unknown, prof!, wis!, mot!, lead!];
    const result = orderCapabilityDimensions(input);
    expect(ids(result)).toEqual([
      'open',
      'mot',
      'future-core',
      'prof',
      'wis',
      'grit',
      'lead',
    ]);
    for (const index of [0, 2, 3, 6]) expect(result[index]).toBe(input[index]);
  });
  it('按真实ID和潜力核心标记选择，名称或其他组同名ID不参与重排', () => {
    const input: Dimension[] = [
      { id: 'grit', name: '内生动力', axis: 'prof', core: true },
      { id: 'wis', name: '坚毅力', axis: 'pot', core: false },
      { id: 'new', name: '智慧力', axis: 'pot', core: true },
    ];
    expect(orderCapabilityDimensions(input)).toEqual(input);
  });
  it('返回新数组并保留全部对象、分数与来源，不修改冻结输入', () => {
    const input = Object.freeze(
      catalogue()
        .reverse()
        .map((row, index) =>
          Object.freeze({
            ...row,
            value: (index % 5) + 1,
            sources: Object.freeze([{ fragmentId: 'demo-' + index }]),
          }),
        ),
    );
    const snapshot = JSON.stringify(input);
    const result = orderCapabilityDimensions(input);
    expect(result).not.toBe(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(result.every((row) => input.includes(row))).toBe(true);
    expect(orderCapabilityDimensions(result)).toEqual(result);
  });
  it('相同ID维持原始相对顺序，且空集合仍为空', () => {
    const [prof, mot, wis, grit] = catalogue();
    const first = { ...mot!, name: '演示第一条' };
    const second = { ...mot!, name: '演示第二条' };
    expect(
      orderCapabilityDimensions([grit!, first, wis!, second, prof!]),
    ).toEqual([first, second, wis, grit, prof]);
    expect(orderCapabilityDimensions([])).toEqual([]);
  });
});

describe('当前可见证据的缺证提示', () => {
  it.each([
    ['prof', '待补专业度评分'],
    ['mot', '待补主动性相关的事件'],
    ['wis', '待补判断与取舍相关的事件'],
    ['grit', '待补受挫后如何反应的事件'],
    ['lead', '待补带动他人的事件'],
    ['open', '待补接受反馈相关的事件'],
  ])('固定原型维度%s使用肯定式待补提示', (id, text) => {
    expect(missingVisibleCapabilityEvidence(id)).toBe(text);
  });
  it.each(['future-dimension', '__proto__', 'constructor', ''])(
    '未知维度%s保持通用待补提示，不回显标识',
    (id) => {
      expect(missingVisibleCapabilityEvidence(id)).toBe('待补已确认的事件');
    },
  );
  it('整块缺证保持通用下一步，已知可见记录只提示补具体行为', () => {
    const visible = new Set(['grit']);
    expect(missingVisibleCapabilityEvidence()).toBe('待补已确认的事件');
    expect(missingVisibleCapabilityEvidence(undefined, visible)).toBe(
      '待补已确认的事件',
    );
    expect(missingVisibleCapabilityEvidence('grit', visible)).toBe(
      '有记录，待补具体行为',
    );
    expect(missingVisibleCapabilityEvidence('mot', visible)).toBe(
      '待补主动性相关的事件',
    );
  });
  it('真实授权读取中的未知分可提示有记录，保持未知且不产生分数', async () => {
    const data = nodeFixture();
    for (const row of data.confirmations.filter(
      (row) => row.dimensionId === 'grit',
    )) {
      row.status = 'unknown';
      row.value = null;
      row.anchorId = null;
    }
    const evidence = await collectEvidence(data, 'one', talentSources(data));
    const visible = new Set(
      evidence.keyEvents.flatMap((row) =>
        row.scores.map((score) => score.dimensionId),
      ),
    );
    expect(evidence.effective.some((row) => row.dimension.id === 'grit')).toBe(
      false,
    );
    expect(missingVisibleCapabilityEvidence('grit', visible)).toBe(
      '有记录，待补具体行为',
    );
    expect(
      data.confirmations.find((row) => row.dimensionId === 'grit')!.status,
    ).toBe('unknown');
  });
  it('隐藏管理观察与完全缺少该事件得到同样提示，不泄露记录存在', async () => {
    const data = nodeFixture();
    data.events[1]!.title = 'SENTINEL-hidden';
    data.statements[1]!.kind = 'management_observation';
    const hidden = await collectEvidence(data, 'one', talentSources(data));
    const absent = structuredClone(data);
    absent.events = absent.events.filter((row) => row.id !== 'event-1');
    const none = await collectEvidence(absent, 'one', talentSources(absent));
    const hint = (evidence: typeof hidden) =>
      missingVisibleCapabilityEvidence(
        'grit',
        new Set(
          evidence.keyEvents.flatMap((row) =>
            row.scores.map((score) => score.dimensionId),
          ),
        ),
      );
    expect(JSON.stringify(hidden)).not.toContain('SENTINEL-hidden');
    expect(hint(hidden)).toBe('待补受挫后如何反应的事件');
    expect(hint(hidden)).toBe(hint(none));
  });
});
