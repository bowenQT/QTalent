/** Capability quadrant: professional level x potential, nothing finer than 2x2. */
export const quadrants = ['hh', 'hl', 'lh', 'll'] as const;
export type Quadrant = (typeof quadrants)[number];

export const quadrantNames: Record<Quadrant, string> = {
  hh: '双高',
  hl: '高潜待练',
  lh: '专业骨干',
  ll: '待观察',
};

/** Plane coordinates: x grows with professional level, y grows downwards (high potential on top). */
export type MiniQuadPoint = { quadrant: Quadrant; x: number; y: number };

export type MiniQuadReference =
  | ({ state: 'placed' } & MiniQuadPoint)
  /** Not enough material: no dot is drawn, never the lower-left corner. */
  | { state: 'insufficient' };

function assertQuadrant(quadrant: string) {
  if (!Object.hasOwn(quadrantNames, quadrant))
    throw new Error(`Unknown quadrant: ${quadrant}`);
}

/**
 * Past formal calibrations (oldest first) plus the current reference position. The
 * component knows nothing about permissions; a page that must hide it does not render it.
 */
export function MiniQuad({
  calibrations,
  reference,
}: {
  calibrations: readonly (MiniQuadPoint & { label: string })[];
  reference: MiniQuadReference;
}) {
  calibrations.forEach((point) => assertQuadrant(point.quadrant));
  if (reference.state === 'placed') assertQuadrant(reference.quadrant);
  const last = calibrations[calibrations.length - 1];
  const caption = last
    ? `${calibrations.map((point) => point.label).join(' → ')} · ${quadrantNames[last.quadrant]}`
    : '还没有正式校准';
  const status =
    reference.state === 'placed'
      ? `当前参考位置：${quadrantNames[reference.quadrant]}`
      : '当前参考位置：资料不足';
  return (
    <div className="n-miniquad" aria-label={`历次校准：${caption}。${status}`}>
      <div className="n-miniquad__plane" />
      {calibrations.length > 1 ? (
        <svg aria-hidden="true">
          <path
            d={calibrations
              .map(
                (point, i) =>
                  `${i ? 'L' : 'M'}${point.x * 132} ${point.y * 80}`,
              )
              .join(' ')}
          />
        </svg>
      ) : null}
      {reference.state === 'placed' ? (
        <span
          className="n-miniquad__pt nt-ref"
          style={{ left: `${reference.x * 100}%`, top: `${reference.y * 83}%` }}
          title={status}
        />
      ) : null}
      {calibrations.map((point, i) => (
        <span
          key={i}
          className={`n-miniquad__pt${i === calibrations.length - 1 ? ' is-now' : ''}`}
          style={{ left: `${point.x * 100}%`, top: `${point.y * 83}%` }}
          title={`${point.label}：${quadrantNames[point.quadrant]}`}
        />
      ))}
      <span className="n-miniquad__cap">{caption}</span>
    </div>
  );
}
