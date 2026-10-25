/** Align both isolated samples to the nearest device-pixel origin at scale 1.
 * This never changes dimensions, typography, spacing, or product-page layout.
 */
export function captureOffset(origin: { x: number; y: number }) {
  return {
    x: Math.round(origin.x) - origin.x,
    y: Math.round(origin.y) - origin.y,
  };
}
