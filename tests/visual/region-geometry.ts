/**
 * Pure geometry behind the region helpers in compare.ts. Kept apart from the browser code
 * (like capture-geometry.ts) so the arithmetic is unit-tested without Playwright.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type BoxKey = 'x' | 'y' | 'width' | 'height';

export const allBoxKeys: readonly BoxKey[] = ['x', 'y', 'width', 'height'];

/**
 * Rectangles relative to the container's top-left corner, clipped to the container.
 * Rectangles that fall outside it or have no area are dropped.
 */
export function relativeRects(container: Rect, rects: readonly Rect[]): Rect[] {
  const result: Rect[] = [];
  for (const rect of rects) {
    const left = Math.max(rect.x - container.x, 0);
    const top = Math.max(rect.y - container.y, 0);
    const right = Math.min(rect.x + rect.width - container.x, container.width);
    const bottom = Math.min(
      rect.y + rect.height - container.y,
      container.height,
    );
    if (right - left <= 0 || bottom - top <= 0) continue;
    result.push({ x: left, y: top, width: right - left, height: bottom - top });
  }
  return result;
}

const key = (value: number) => Math.round(value * 100);

/** Drops rectangles equal to an earlier one at 0.01px resolution; keeps the order. */
export function uniqueRects(rects: readonly Rect[]): Rect[] {
  const seen = new Set<string>();
  const result: Rect[] = [];
  for (const rect of rects) {
    const id = [rect.x, rect.y, rect.width, rect.height].map(key).join(',');
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(rect);
  }
  return result;
}

/** Style of one mask block; `scroll` turns a viewport rectangle into document coordinates. */
export function maskStyle(rect: Rect, scroll: { x: number; y: number }) {
  return {
    position: 'absolute',
    left: `${rect.x + scroll.x}px`,
    top: `${rect.y + scroll.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    background: '#ff00ff',
    zIndex: '2147483647',
    pointerEvents: 'none',
  };
}

/** Which of `keys` differ by more than `tolerance`, with both values. */
export function boxDifferences(
  reference: Rect,
  actual: Rect,
  keys: readonly BoxKey[] = allBoxKeys,
  tolerance = 1,
): { key: BoxKey; reference: number; actual: number }[] {
  return keys
    .filter((name) => Math.abs(reference[name] - actual[name]) > tolerance)
    .map((name) => ({
      key: name,
      reference: reference[name],
      actual: actual[name],
    }));
}

/**
 * Extra html padding-top that moves a layout y to a whole pixel: 0 for an integer,
 * otherwise `1 - fraction`. Chrome rounds text baselines by the fractional part of the
 * layout coordinate, so two pages with different fractions differ by a row of pixels.
 */
export function snapPadding(top: number): number {
  const fraction = top - Math.floor(top);
  return fraction ? 1 - fraction : 0;
}
