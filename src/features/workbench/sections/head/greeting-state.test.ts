import { describe, expect, it } from 'vitest';
import { dateLine, greetingFor, neutralGreeting } from './greeting-state';

describe('greetingFor', () => {
  it('switches at 11, 13 and 18 o’clock', () => {
    const cases: [number, string][] = [
      [0, '上午好'],
      [10, '上午好'],
      [11, '中午好'],
      [12, '中午好'],
      [13, '下午好'],
      [17, '下午好'],
      [18, '晚上好'],
      [23, '晚上好'],
    ];
    for (const [hour, part] of cases)
      expect(greetingFor(hour, '叶青')).toBe(`${part}，叶青`);
    expect(neutralGreeting('叶青')).toBe('你好，叶青');
  });
});

describe('dateLine', () => {
  it('computes the weekday, across months and years', () => {
    expect(dateLine('2026-09-04')).toBe('9 月 4 日 · 周五');
    expect(dateLine('2026-09-06')).toBe('9 月 6 日 · 周日');
    expect(dateLine('2026-10-31')).toBe('10 月 31 日 · 周六');
    expect(dateLine('2026-12-31')).toBe('12 月 31 日 · 周四');
    expect(dateLine('2027-01-01')).toBe('1 月 1 日 · 周五');
    expect(dateLine('2028-02-29')).toBe('2 月 29 日 · 周二');
  });
});
