import type { PersonData } from './person-data';

type Dimension = PersonData['dimensions'][number];
// Fixed prototype Y catalogue IDs, not display labels or score order.
const coreRank = new Map([
  ['mot', 0],
  ['wis', 1],
  ['grit', 2],
]);
const pendingByDimension = new Map([
  ['prof', '待补专业度评分'],
  ['mot', '待补主动性相关的事件'],
  ['wis', '待补判断与取舍相关的事件'],
  ['grit', '待补受挫后如何反应的事件'],
  ['lead', '待补带动他人的事件'],
  ['open', '待补接受反馈相关的事件'],
]);
const knownCore = (row: Dimension) =>
  row.axis === 'pot' && row.core && coreRank.has(row.id);

/** Consume the existing stable catalogue order after its grouping/ID sort.
 * Reorder only known potential-core slots; all other positions and row objects
 * remain unchanged. This helper never derives or sorts a person's scores.
 */
export function orderCapabilityDimensions<T extends Dimension>(
  dimensions: readonly T[],
): T[] {
  const core = dimensions
    .filter(knownCore)
    .sort((a, b) => coreRank.get(a.id)! - coreRank.get(b.id)!);
  let next = 0;
  return dimensions.map((row) => (knownCore(row) ? core[next++]! : row));
}

/** Call only after the existing authorized/effective projection found a gap.
 * visibleDimensionIds, when supplied, must come solely from readable event
 * cards, never raw confirmations or a hidden-record count. Like prototype
 * UI.missText, an already visible record can ask for more concrete behavior.
 * These hints describe a next step, not absence of evidence outside that view.
 */
export function missingVisibleCapabilityEvidence(
  dimensionId?: Dimension['id'],
  visibleDimensionIds?: ReadonlySet<Dimension['id']>,
): string {
  if (dimensionId === undefined) return '待补已确认的事件';
  if (visibleDimensionIds?.has(dimensionId)) return '有记录，待补具体行为';
  return pendingByDimension.get(dimensionId) ?? '待补已确认的事件';
}
