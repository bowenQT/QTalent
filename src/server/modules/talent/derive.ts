import type { ReferencePosition } from '../../../contracts/person';
export interface PositionScore {
  eventId: string;
  occurredOn: string;
  dimensionId: string;
  axis: 'prof' | 'pot';
  core: boolean;
  value: number;
  ruleVersionId: string;
}
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
/** P0 uses the published default placement policy (requirements v1.2 3.8.2).
 * This is a reference only; never a frozen position or a talent total.
 */
export function deriveReferencePosition(
  scores: PositionScore[],
  today: string,
): ReferencePosition {
  const end = new Date(today + 'T00:00:00Z');
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const recent = scores.filter((score) => {
    const time = new Date(score.occurredOn + 'T00:00:00Z');
    return time >= start && time <= end;
  });
  const professional = recent.filter((score) => score.axis === 'prof');
  const potential = recent.filter(
    (score) => score.axis === 'pot' && score.core,
  );
  const axes = [...professional, ...potential];
  if (axes.some((score) => score.ruleVersionId !== 'rubric-v1'))
    return { status: 'unknown', reason: '评分规则版本兼容性尚未接入' };
  const dimensions = [...new Set(potential.map((score) => score.dimensionId))];
  if (
    new Set(professional.map((score) => score.eventId)).size < 2 ||
    new Set(potential.map((score) => score.eventId)).size < 2 ||
    dimensions.length < 2
  )
    return {
      status: 'insufficient_evidence',
      reason: '尚未达到参考位置的证据门槛',
    };
  const prof = mean(professional.map((score) => score.value));
  const pot = mean(
    dimensions.map((id) =>
      mean(
        potential
          .filter((score) => score.dimensionId === id)
          .map((score) => score.value),
      ),
    ),
  );
  // Extra potential items (not core): their mean of at least 4 only sets a flag.
  // It never moves the quadrant and never adds a coordinate.
  const extras = recent.filter((score) => score.axis === 'pot' && !score.core);
  return {
    status: 'ready',
    data: {
      kind: 'reference',
      bonus: extras.length > 0 && mean(extras.map((score) => score.value)) >= 4,
      quadrant:
        prof >= 3.5
          ? pot >= 3.5
            ? 'high_professional_high_potential'
            : 'high_professional_low_potential'
          : pot >= 3.5
            ? 'low_professional_high_potential'
            : 'low_professional_low_potential',
    },
  };
}
