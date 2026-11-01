/** Permission requirement for the four approved, pinned prototype history kinds.
 * The baseline's graduation row needs restricted evaluation access, not the
 * personnel-material restriction that excludes every role from model input.
 * Its historical kind, source category, scale and values remain unchanged.
 * New source types/free-text labels need their own confirmed classification.
 */
export function historicalEvaluationRequiredKind(row: {
  kind: string;
  sourceCategory: string;
}): 'evaluation' | 'restricted-evaluation' | null {
  if (row.sourceCategory !== 'prototype_baseline') return null;
  switch (row.kind) {
    case '训练营周评':
    case 'MS 路演评审':
    case '奖项答辩':
      return 'evaluation';
    case '结营评审':
      return 'restricted-evaluation';
    default:
      return null;
  }
}
