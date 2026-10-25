/** Align both isolated samples to the nearest device-pixel origin at scale 1.
 * This never changes dimensions, typography, spacing, or product-page layout.
 */
export function captureOffset(origin: { x: number; y: number }) {
  return {
    x: Math.round(origin.x) - origin.x,
    y: Math.round(origin.y) - origin.y,
  };
}

/** Identical compositing removes LCD-vs-grayscale raster differences between
 * independent sample pages. The zero-depth transform does not move or scale UI.
 */
export function captureStyle(origin: { x: number; y: number }) {
  const offset = captureOffset(origin);
  return {
    position: 'relative',
    left: `${offset.x}px`,
    top: `${offset.y}px`,
    transform: 'translateZ(0)',
  };
}
