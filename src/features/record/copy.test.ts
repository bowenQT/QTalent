import { describe, expect, it } from 'vitest';
import { copy } from './copy';

/** 把静态字符串和文案函数的返回值都摊平成一组可检查的文字。 */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function')
    return strings((value as (...args: unknown[]) => unknown)(1, 'x', 'y'));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object')
    return Object.values(value).flatMap(strings);
  return [];
}

const all = strings(copy);

// 受控术语原样使用（资料不足）；其余按 docs/ui-copy.md 不写否定句式
const NEGATIVE = /不|没|无|未|非|别|勿|暂无|尚|并非|免/;
// 受控术语，以及含「别」字的正常词「识别」
const CONTROLLED = /资料不足|识别/g;
// 内部名称不上界面
const INTERNAL = /rubric|operation|jobId|job_id|qwen|Jev|schema|draftId/i;
// 免责声明与过程解释
const PROCESS = /仅供参考|不代表|AI 正在|我将|系统会先|可能出错/;

describe('文案结构检查', () => {
  it('有文案可查', () => {
    expect(all.length).toBeGreaterThan(80);
  });

  it('不出现否定句式', () => {
    const offenders = all.filter((text) =>
      NEGATIVE.test(text.replace(CONTROLLED, '')),
    );
    expect(offenders).toEqual([]);
  });

  it('不出现内部名称、免责声明与过程解释', () => {
    expect(all.filter((text) => INTERNAL.test(text))).toEqual([]);
    expect(all.filter((text) => PROCESS.test(text))).toEqual([]);
  });

  it('不出现「不是……而是……」对举', () => {
    expect(all.filter((text) => /不是.*而是|而不是|并非/.test(text))).toEqual(
      [],
    );
  });

  it('撤销窗口与页面说明一致', () => {
    expect(copy.page.lead).toContain('5 秒内');
  });
});
