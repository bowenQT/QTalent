import { describe, expect, it } from 'vitest';
import type { PersonPrintSheet, PrintScore } from './ports';
import {
  formalLine,
  identityLine,
  monthDay,
  printedEvents,
  sharedSource,
  sourceLine,
} from './print-view';

const score = (source: PrintScore['source']): PrintScore => ({
  id: 's',
  dimensionLabel: '专业度',
  value: 3,
  anchor: '达到本届学员预期',
  quote: null,
  scoredByName: '演示评分人',
  ruleVersionLabel: '评价规则 v1',
  source,
});

describe('print view', () => {
  it('writes days and the identity line, leaving missing parts out', () => {
    expect(monthDay('2026-08-07')).toBe('08-07');
    expect(
      identityLine({
        name: '演示甲',
        demo: true,
        teamPath: '演示部 / 一组',
        jobTitle: '后端方向',
        level: null,
        tenureLabel: '入营 2 个月',
        batchName: null,
      }),
    ).toBe('演示部 / 一组 · 后端方向 · 入营 2 个月');
  });

  it('writes one source per event only when every score shares it', () => {
    const a = { exact: true, text: '观察表 · 第 1 行' };
    expect(sharedSource([score(a), score({ ...a })])).toEqual(a);
    expect(sharedSource([score(a), score({ ...a, exact: false })])).toBeNull();
    expect(
      sharedSource([
        score(a),
        score({ exact: true, text: '观察表 · 第 2 行' }),
      ]),
    ).toBeNull();
    expect(sharedSource([score(a), score(null)])).toBeNull();
    expect(sharedSource([score(null)])).toBeNull();
    expect(sharedSource([])).toBeNull();
    expect(sourceLine(a)).toBe('来源：观察表 · 第 1 行');
    expect(sourceLine({ exact: false, text: 'A；B' })).toBe('全部来源：A；B');
  });

  it('writes the formal position, or that it waits for calibration', () => {
    expect(
      formalLine({
        status: 'ready',
        quadrantLabel: '待观察',
        calibrationLabel: '中期',
        frozenOn: '2026-08-10',
        confirmedByName: '演示 HR',
      }),
    ).toBe('待观察 · 中期校准 · 08-10 冻结 · 演示 HR确认');
    expect(formalLine({ status: 'pending' })).toBe('待正式校准');
  });

  it('counts only events that hold a confirmed score', () => {
    const event = (id: string, scores: PrintScore[]) => ({
      id,
      occurredOn: '2026-08-01',
      title: id,
      projectName: null,
      recorderName: '演示记录人',
      scores,
    });
    const sheet = {
      events: [event('a', [score(null), score(null)]), event('b', [])],
    } as unknown as PersonPrintSheet;
    expect(printedEvents(sheet)).toEqual({
      events: [sheet.events[0]],
      scoreCount: 2,
    });
  });
});
