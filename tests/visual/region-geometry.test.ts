import { describe, expect, it } from 'vitest';
import {
  boxDifferences,
  maskStyle,
  relativeRects,
  snapPadding,
  uniqueRects,
} from './region-geometry';
const container = { x: 100, y: 50, width: 200, height: 80 };
describe('element-relative mask rectangles', () => {
  it('rebases rectangles inside the container onto its origin', () => {
    expect(
      relativeRects(container, [{ x: 120, y: 60, width: 30, height: 10 }]),
    ).toEqual([{ x: 20, y: 10, width: 30, height: 10 }]);
  });
  it('clips partially outside rectangles to the container', () => {
    expect(
      relativeRects(container, [
        { x: 80, y: 40, width: 40, height: 20 },
        { x: 280, y: 120, width: 50, height: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 20, height: 10 },
      { x: 180, y: 70, width: 20, height: 10 },
    ]);
  });
  it('drops rectangles fully outside or with zero area', () => {
    expect(
      relativeRects(container, [
        { x: 400, y: 60, width: 10, height: 10 },
        { x: 120, y: 60, width: 0, height: 10 },
        { x: 300, y: 60, width: 10, height: 10 },
      ]),
    ).toEqual([]);
  });
});
describe('mask rectangle union', () => {
  it('keeps first-seen order and removes duplicates within 0.01px', () => {
    expect(
      uniqueRects([
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 5, y: 6, width: 7, height: 8 },
        { x: 1.001, y: 2, width: 3, height: 4.004 },
        { x: 1.02, y: 2, width: 3, height: 4 },
      ]),
    ).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
      { x: 1.02, y: 2, width: 3, height: 4 },
    ]);
  });
});
describe('mask block style', () => {
  it('matches the existing page mask style at document coordinates', () => {
    expect(
      maskStyle({ x: 10.5, y: 20, width: 30, height: 40 }, { x: 0, y: 300 }),
    ).toEqual({
      position: 'absolute',
      left: '10.5px',
      top: '320px',
      width: '30px',
      height: '40px',
      background: '#ff00ff',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
  });
});
describe('box comparison', () => {
  const reference = { x: 10, y: 20, width: 300, height: 40 };
  it('accepts differences up to exactly the tolerance', () => {
    expect(
      boxDifferences(reference, { x: 11, y: 19, width: 301, height: 41 }),
    ).toEqual([]);
  });
  it('reports each key beyond the tolerance with both values', () => {
    expect(
      boxDifferences(reference, { x: 11.01, y: 20, width: 300, height: 38 }),
    ).toEqual([
      { key: 'x', reference: 10, actual: 11.01 },
      { key: 'height', reference: 40, actual: 38 },
    ]);
  });
  it('compares only the requested keys and honours a custom tolerance', () => {
    const actual = { x: 10, y: 90, width: 302, height: 10 };
    expect(boxDifferences(reference, actual, ['x', 'width'])).toEqual([
      { key: 'width', reference: 300, actual: 302 },
    ]);
    expect(boxDifferences(reference, actual, ['x', 'width'], 2)).toEqual([]);
  });
});
describe('layout snapping', () => {
  it('leaves whole-pixel tops alone', () => {
    expect(snapPadding(100)).toBe(0);
  });
  it('pads up to the next whole pixel', () => {
    expect(snapPadding(100.25)).toBe(0.75);
    expect(snapPadding(100.5)).toBe(0.5);
    expect(snapPadding(100.999)).toBeCloseTo(0.001, 6);
  });
});
