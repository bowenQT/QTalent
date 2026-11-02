import type { PersonOption } from './types';

/**
 * 「从原话里识别」：在「谁」的候选里找原话中出现的姓名（#248 编排裁决，B1）。
 * 候选来自服务端按当前权限过滤的 845 `page()`，这里只做精确匹配，不调模型、不做模糊匹配。
 * 只有毫无歧义时才自动选中：原话里出现的候选姓名恰好一个，且这个姓名在候选里没有重名。
 * 其余情况都返回 null，页面走已有的「在「谁」里选一位同事」：
 * - 重名（两位「王一鸣」）；
 * - 姓名互相包含（候选有「王一」和「王一鸣」，原话写「王一鸣」时两个姓名都算出现）；
 * - 原话里出现了多位候选的姓名。
 * - 姓名里的字不到 2 个时不参与自动选中：按字形（Intl.Segmenter）计数，只数含字母类字符
 *   （`\p{L}`）的字形；单字「一」会命中「今天一起」，纯 emoji 或符号也不算姓名。
 * 赛后可以由 845 在整理时识别（两阶段授权）替代。
 */
const graphemes = new Intl.Segmenter('zh', { granularity: 'grapheme' });
/** 姓名里含字母类字符的字形个数；👍🏽、👩‍💻 这类组合 emoji 一个也不算。 */
function letterCount(name: string) {
  let count = 0;
  for (const { segment } of graphemes.segment(name))
    if (/\p{L}/u.test(segment)) count += 1;
  return count;
}

export function recognizePerson(
  text: string,
  people: readonly PersonOption[],
): string | null {
  const byName = new Map<string, PersonOption[]>();
  for (const person of people) {
    const name = person.name.trim();
    if (letterCount(name) < 2) continue;
    byName.set(name, [...(byName.get(name) ?? []), person]);
  }
  const hits = [...byName].filter(([name]) => text.includes(name));
  if (hits.length !== 1) return null;
  const [[, owners]] = hits as [[string, PersonOption[]]];
  return owners.length === 1 ? owners[0]!.id : null;
}
