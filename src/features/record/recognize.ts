import type { PersonOption } from './types';

/**
 * 「从原话里识别」：在「谁」的候选里找原话中完整出现的姓名（#248 编排裁决，B1）。
 * 候选来自服务端按当前权限过滤的 845 `page()`，这里只做精确匹配，不调模型、不做模糊匹配。
 * - 一个名字对上多个人：这个名字不算识别出来；
 * - 名字被另一位命中者的名字包含（「王一」和「王一鸣」）：只认长的那位；
 * - 最后不是恰好一位：返回 null，页面走已有的「在「谁」里选一位同事」。
 * 赛后可以由 845 在整理时识别（两阶段授权）替代。
 */
export function recognizePerson(
  text: string,
  people: readonly PersonOption[],
): string | null {
  const byName = new Map<string, PersonOption[]>();
  for (const person of people) {
    const name = person.name.trim();
    if (!name) continue;
    byName.set(name, [...(byName.get(name) ?? []), person]);
  }
  const hits = [...byName].filter(
    ([name, owners]) => owners.length === 1 && text.includes(name),
  );
  const names = hits.map(([name]) => name);
  const kept = hits.filter(
    ([name]) => !names.some((other) => other !== name && other.includes(name)),
  );
  return kept.length === 1 ? kept[0]![1][0]!.id : null;
}
