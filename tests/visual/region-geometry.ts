/** Pure geometry for visual masks and box checks. Browser code in compare.ts
 * measures; these functions decide, so they can be tested without Playwright.
 */
export type Rect = { x: number; y: number; width: number; height: number };
export type BoxKey = keyof Rect;

/** Rebase rectangles onto a container origin, clip them to the container and
 * drop empty results. Inputs share one coordinate space (e.g. the viewport). */
export function relativeRects(container: Rect, rects: readonly Rect[]): Rect[] {
  return rects.flatMap((rect) => {
    const left = Math.max(rect.x, container.x);
    const top = Math.max(rect.y, container.y);
    const right = Math.min(rect.x + rect.width, container.x + container.width);
    const bottom = Math.min(
      rect.y + rect.height,
      container.y + container.height,
    );
    if (right <= left || bottom <= top) return [];
    return [
      {
        x: left - container.x,
        y: top - container.y,
        width: right - left,
        height: bottom - top,
      },
    ];
  });
}

/** Remove duplicates measured on both renders, keeping first-seen order. */
export function uniqueRects(rects: readonly Rect[]): Rect[] {
  const seen = new Set<string>();
  return rects.filter((rect) => {
    const key = [rect.x, rect.y, rect.width, rect.height]
      .map((value) => Math.round(value * 100))
      .join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Inline style for one opaque mask block at document coordinates. */
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

export const boxKeys: readonly BoxKey[] = ['x', 'y', 'width', 'height'];

/** Keys whose values differ by more than the tolerance, with both values. */
export function boxDifferences(
  reference: Rect,
  actual: Rect,
  keys: readonly BoxKey[] = boxKeys,
  tolerance = 1,
) {
  return keys
    .filter((key) => Math.abs(reference[key] - actual[key]) > tolerance)
    .map((key) => ({ key, reference: reference[key], actual: actual[key] }));
}

/** Top padding that moves a fractional layout top to the next whole pixel.
 * Chrome rounds text baselines by the layout fraction; raster offsets alone
 * cannot fix a 1px line shift between two samples with different fractions.
 */
export function snapPadding(top: number) {
  const fraction = top - Math.floor(top);
  return fraction ? 1 - fraction : 0;
}
