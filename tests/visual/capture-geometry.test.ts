import { describe, expect, it } from 'vitest';
import { captureOffset } from './capture-geometry';
describe('shared component raster origin', () => {
  it('leaves integer origins untouched', () => {
    expect(captureOffset({ x: 24, y: 88 })).toEqual({ x: 0, y: 0 });
  });
  it('uses only the measured fractional origin, with no per-component correction', () => {
    expect(captureOffset({ x: 24.25, y: 88.75 })).toEqual({
      x: -0.25,
      y: 0.25,
    });
    expect(captureOffset({ x: -2.25, y: -8.75 })).toEqual({
      x: 0.25,
      y: -0.25,
    });
  });
  it('handles half-pixel boundaries consistently on either side of zero', () => {
    expect(captureOffset({ x: 0.5, y: -0.5 })).toEqual({ x: 0.5, y: 0.5 });
    expect(captureOffset({ x: 0.484375, y: 0.515625 })).toEqual({
      x: -0.484375,
      y: 0.484375,
    });
  });
});
