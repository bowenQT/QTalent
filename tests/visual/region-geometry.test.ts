import { describe, expect, it } from 'vitest';
import {
  boxDifferences,
  maskStyle,
  relativeRects,
  snapPadding,
  uniqueRects,
} from './region-geometry';

const container = { x: 100, y: 200, width: 300, height: 120 };

describe('rectangles relative to a container', () => {
  it('moves the origin to the container corner', () => {
    expect(
      relativeRects(container, [{ x: 110, y: 230, width: 50, height: 20 }]),
    ).toEqual([{ x: 10, y: 30, width: 50, height: 20 }]);
  });

  it('clips a rectangle that partly leaves the container', () => {
    expect(
      relativeRects(container, [
        { x: 90, y: 190, width: 30, height: 30 },
        { x: 380, y: 300, width: 100, height: 100 },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 20, height: 20 },
      { x: 280, y: 100, width: 20, height: 20 },
    ]);
  });

  it('drops rectangles outside the container or without area', () => {
    expect(
      relativeRects(container, [
        { x: 0, y: 0, width: 50, height: 50 },
        { x: 500, y: 250, width: 10, height: 10 },
        { x: 400, y: 250, width: 10, height: 10 },
        { x: 120, y: 250, width: 0, height: 10 },
        { x: 120, y: 250, width: 10, height: 0 },
      ]),
    ).toEqual([]);
  });
});

describe('de-duplicated mask rectangles', () => {
  it('keeps the first of rectangles that agree within 0.01px, in order', () => {
    expect(
      uniqueRects([
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 5, y: 6, width: 7, height: 8 },
        { x: 1.001, y: 2, width: 3, height: 4.002 },
        { x: 1, y: 2, width: 3, height: 4 },
      ]),
    ).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 5, y: 6, width: 7, height: 8 },
    ]);
  });

  it('keeps rectangles that differ by 0.01px or more', () => {
    expect(
      uniqueRects([
        { x: 1, y: 2, width: 3, height: 4 },
        { x: 1.02, y: 2, width: 3, height: 4 },
      ]),
    ).toHaveLength(2);
  });
});

describe('mask block style', () => {
  it('matches the inline style matchingMasks used before it was extracted', () => {
    expect(
      maskStyle({ x: 10.5, y: 20, width: 30, height: 40.25 }, { x: 0, y: 300 }),
    ).toEqual({
      position: 'absolute',
      left: '10.5px',
      top: '320px',
      width: '30px',
      height: '40.25px',
      background: '#ff00ff',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
  });

  it('adds the scroll offset to turn viewport into document coordinates', () => {
    const style = maskStyle(
      { x: 1, y: 2, width: 3, height: 4 },
      { x: 50, y: 70 },
    );
    expect([style.left, style.top]).toEqual(['51px', '72px']);
  });
});

describe('box differences', () => {
  const box = { x: 10, y: 20, width: 300, height: 40 };

  it('passes a difference of exactly the tolerance and fails just above it', () => {
    expect(boxDifferences(box, { ...box, width: 301 })).toEqual([]);
    expect(boxDifferences(box, { ...box, width: 301.01 })).toEqual([
      { key: 'width', reference: 300, actual: 301.01 },
    ]);
    expect(boxDifferences(box, { ...box, width: 299 })).toEqual([]);
  });

  it('reports every differing key with both values', () => {
    expect(
      boxDifferences(box, { x: 14, y: 20, width: 300, height: 46 }),
    ).toEqual([
      { key: 'x', reference: 10, actual: 14 },
      { key: 'height', reference: 40, actual: 46 },
    ]);
  });

  it('compares only the requested keys', () => {
    const other = { x: 90, y: 90, width: 300, height: 90 };
    expect(boxDifferences(box, other, ['x', 'width'])).toEqual([
      { key: 'x', reference: 10, actual: 90 },
    ]);
    expect(boxDifferences(box, other, ['width'])).toEqual([]);
  });

  it('honours a custom tolerance', () => {
    expect(boxDifferences(box, { ...box, y: 25 }, undefined, 5)).toEqual([]);
    expect(boxDifferences(box, { ...box, y: 25.5 }, undefined, 5)).toHaveLength(
      1,
    );
  });
});

describe('layout snap padding', () => {
  it('is zero for a whole-pixel origin', () => {
    expect(snapPadding(100)).toBe(0);
    expect(snapPadding(0)).toBe(0);
  });

  it('is the distance up to the next whole pixel', () => {
    expect(snapPadding(100.25)).toBe(0.75);
    expect(snapPadding(100.5)).toBe(0.5);
    expect(snapPadding(100.999)).toBeCloseTo(0.001, 6);
  });

  it('moves any origin onto a whole pixel', () => {
    for (const top of [12.1, 57.77, 301.5, 0.01])
      expect(top + snapPadding(top)).toBeCloseTo(Math.ceil(top), 9);
  });
});
