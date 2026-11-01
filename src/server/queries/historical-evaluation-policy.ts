/** Permission requirement for the four approved, pinned prototype history kinds.
 * The baseline's restricted graduation row requires existing performance access;
 * this does not change its historical kind, source category, scale or values.
 * New source types/free-text labels need their own confirmed classification.
 */
export function historicalEvaluationRequiredKind(row: {
  kind: string;
  sourceCategory: string;
}): 'evaluation' | 'performance' | null {
  if (row.sourceCategory !== 'prototype_baseline') return null;
  switch (row.kind) {
    case '训练营周评':
    case 'MS 路演评审':
    case '奖项答辩':
      return 'evaluation';
    case '结营评审':
      return 'performance';
    default:
      return null;
  }
}
