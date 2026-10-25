import { describe, expect, it } from 'vitest';
import { captureOffset, captureStyle } from './capture-geometry';
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

describe('isolated sample compositing', () => {
  it('uses a geometry-neutral composited layer on both raster origins', () => {
    expect(captureStyle({ x: 280, y: 419.1875 })).toEqual({
      position: 'relative',
      left: '0px',
      top: '-0.1875px',
      transform: 'translateZ(0)',
    });
    expect(captureStyle({ x: 49, y: 159.5 })).toEqual({
      position: 'relative',
      left: '0px',
      top: '0.5px',
      transform: 'translateZ(0)',
    });
  });
});
