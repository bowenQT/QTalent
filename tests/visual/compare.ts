import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { captureStyle } from './capture-geometry';
import {
  boxDifferences,
  maskStyle,
  relativeRects,
  snapPadding,
  uniqueRects,
  type BoxKey,
  type Rect,
} from './region-geometry';
export async function stabilize(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.decode().catch(() => undefined),
      ),
    );
  });
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  });
}
/**
 * Page-level masks: the global reference masks plus page-supplied selectors.
 * Call order on a page pair: normalizeRegions → stabilize → matchingMasks →
 * compare / compareElements.
 */
export async function matchingMasks(
  left: Page,
  right: Page,
  extraSelectors: readonly string[] = [],
) {
  // Use the union of actual boxes on BOTH renders. A missing badge/recent block must
  // not create a differently positioned mask on the production side.
  const selectors = [...new Set([...referenceConfig.masks, ...extraSelectors])];
  const boxes: Rect[] = [];
  for (const page of [left, right])
    for (const selector of selectors)
      for (const locator of await page.locator(selector).all()) {
        const box = await locator.boundingBox();
        if (box) boxes.push(box);
      }
  for (const page of [left, right]) {
    const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    await page.evaluate(
      (styles) => {
        for (const style of styles) {
          const mask = document.createElement('div');
          mask.dataset.visualMask = 'true';
          Object.assign(mask.style, style);
          document.body.append(mask);
        }
      },
      boxes.map((box) => maskStyle(box, scroll)),
    );
  }
}
/**
 * Masks inside a compared element. Selectors are prototype-side and match
 * within the element on both sides; the union of element-relative boxes is
 * covered at the same relative position on both sides, so aligned widths and
 * omitted engineering nodes never shift a mask onto other content. Measure
 * only after width alignment: use it through `compareElements({ mask })`.
 */
export async function maskWithin(
  reference: Locator,
  actual: Locator,
  selectors: readonly string[],
) {
  const measure = (locator: Locator) =>
    locator.evaluate((element, list) => {
      const box = (node: Element) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        container: box(element),
        border: { x: -element.clientLeft, y: -element.clientTop },
        rects: list.flatMap((selector) =>
          [...element.querySelectorAll(selector)].map(box),
        ),
      };
    }, selectors);
  const sides = [
    [reference, await measure(reference)],
    [actual, await measure(actual)],
  ] as const;
  const rects = uniqueRects(
    sides.flatMap(([, side]) => relativeRects(side.container, side.rects)),
  );
  for (const [locator, side] of sides)
    await locator.evaluate(
      (element, styles) => {
        if (getComputedStyle(element).position === 'static')
          (element as HTMLElement).style.position = 'relative';
        for (const style of styles) {
          const mask = document.createElement('div');
          mask.dataset.visualMask = 'true';
          Object.assign(mask.style, style);
          element.append(mask);
        }
      },
      rects.map((rect) => maskStyle(rect, side.border)),
    );
}
/**
 * Moves the whole page so the element's layout top is a whole pixel. Chrome
 * rounds text baselines by the layout fraction, so two samples with different
 * fractions can differ by a full line pixel; raster snapping cannot fix that.
 */
export async function snapLayout(locator: Locator) {
  const top = await locator.evaluate((element) => {
    document.documentElement.style.paddingTop = '';
    return element.getBoundingClientRect().top + window.scrollY;
  });
  const padding = snapPadding(top);
  if (padding)
    await locator.evaluate((_, value) => {
      document.documentElement.style.paddingTop = `${value}px`;
    }, padding);
}
/**
 * Tidies rendered DOM before comparison; never edits prototype files.
 * `omit` hides prototype-only blocks (masks cannot absorb layout shift).
 * `replace` swaps data-driven containers for same-size placeholders on both
 * sides; their content is asserted through the DOM instead.
 */
export async function normalizeRegions(
  reference: Page,
  actual: Page,
  rules: { omit?: readonly string[]; replace?: readonly string[] },
) {
  for (const selector of rules.omit ?? [])
    await reference.locator(selector).evaluateAll((elements) => {
      for (const element of elements)
        (element as HTMLElement).style.setProperty(
          'display',
          'none',
          'important',
        );
    });
  for (const selector of rules.replace ?? []) {
    const left = await reference.locator(selector).all();
    const right = await actual.locator(selector).all();
    if (left.length !== right.length)
      throw new Error(
        `normalizeRegions replace ${selector}: prototype ${left.length}, engineering ${right.length}`,
      );
    for (const [index, item] of left.entries()) {
      const pair = right[index]!;
      const size = await item.evaluate((element) => {
        const { width, height } = element.getBoundingClientRect();
        return { width, height };
      });
      const actualWidth = await pair.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      expect
        .soft(actualWidth, `${selector} [${index}] width before placeholder`)
        .toBe(size.width);
      for (const locator of [item, pair])
        await locator.evaluate((element, box) => {
          const style = (element as HTMLElement).style;
          const inline = getComputedStyle(element).display === 'inline';
          element.replaceChildren();
          for (const [name, value] of Object.entries({
            ...(inline ? { display: 'inline-block' } : {}),
            'box-sizing': 'border-box',
            width: `${box.width}px`,
            height: `${box.height}px`,
            'min-height': '0',
            overflow: 'hidden',
            padding: '0',
            border: '0',
            background: '#ff00ff',
          }))
            style.setProperty(name, value, 'important');
        }, size);
    }
  }
}
/** Geometry before pixels: call before compareElements, which aligns widths. */
export async function expectSameBox(
  reference: Locator,
  actual: Locator,
  name: string,
  options: { keys?: readonly BoxKey[]; tolerance?: number } = {},
) {
  const box = (locator: Locator) =>
    locator.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + scrollX, y: y + scrollY, width, height };
    });
  expect
    .soft(
      boxDifferences(
        await box(reference),
        await box(actual),
        options.keys,
        options.tolerance,
      ),
      `${name} document box`,
    )
    .toEqual([]);
}
export async function compare(
  reference: Buffer,
  actual: Buffer,
  testInfo: TestInfo,
  name: string,
) {
  const left = PNG.sync.read(reference),
    right = PNG.sync.read(actual);
  await testInfo.attach(`${name}-prototype`, {
    body: reference,
    contentType: 'image/png',
  });
  await testInfo.attach(`${name}-engineering`, {
    body: actual,
    contentType: 'image/png',
  });
  expect
    .soft(
      { width: right.width, height: right.height },
      'render geometry differs',
    )
    .toEqual({ width: left.width, height: left.height });
  const geometryMatches =
    left.width === right.width && left.height === right.height;
  if (!geometryMatches) {
    await testInfo.attach(`${name}-metrics`, {
      contentType: 'application/json',
      body: JSON.stringify({
        width: left.width,
        height: left.height,
        actualWidth: right.width,
        actualHeight: right.height,
        differingPixels: null,
        diffPixelRatio: null,
        pixelThreshold: referenceConfig.pixelThreshold,
        maxDiffPixelRatio: referenceConfig.maxDiffPixelRatio,
      }),
    });
    return;
  }
  const diff = new PNG({ width: left.width, height: left.height });
  const count = pixelmatch(
    left.data,
    right.data,
    diff.data,
    left.width,
    left.height,
    { threshold: referenceConfig.pixelThreshold },
  );
  await testInfo.attach(`${name}-diff`, {
    body: PNG.sync.write(diff),
    contentType: 'image/png',
  });
  await testInfo.attach(`${name}-metrics`, {
    contentType: 'application/json',
    body: JSON.stringify({
      width: left.width,
      height: left.height,
      differingPixels: count,
      diffPixelRatio: count / (left.width * left.height),
      pixelThreshold: referenceConfig.pixelThreshold,
      maxDiffPixelRatio: referenceConfig.maxDiffPixelRatio,
    }),
  });
  expect
    .soft(
      count / (left.width * left.height),
      `same-run visual diff for ${name}`,
    )
    .toBeLessThanOrEqual(referenceConfig.maxDiffPixelRatio);
}
export async function compareElements(
  reference: Locator,
  actual: Locator,
  testInfo: TestInfo,
  name: string,
  options: { mask?: readonly string[]; snap?: boolean } = {},
) {
  if (options.snap) {
    await snapLayout(reference);
    await snapLayout(actual);
  }
  const box = await reference.boundingBox();
  if (!box) throw new Error(`Missing reference component ${name}`);
  // Component samples inherit stage width. Match only that width, never styles or contents.
  await actual.evaluate((element, width) => {
    (element as HTMLElement).style.width = `${width}px`;
  }, box.width);
  await reference.scrollIntoViewIfNeeded();
  await actual.scrollIntoViewIfNeeded();
  const naturalReference = await reference.boundingBox();
  const naturalActual = await actual.boundingBox();
  if (!naturalReference || !naturalActual)
    throw new Error(`Missing component geometry ${name}`);
  expect
    .soft(
      { width: naturalActual.width, height: naturalActual.height },
      `${name} natural CSS geometry`,
    )
    .toEqual({
      width: naturalReference.width,
      height: naturalReference.height,
    });
  if (options.mask?.length) await maskWithin(reference, actual, options.mask);
  // The same component can sit at fractional coordinates in two different sample
  // pages. Snap both raster origins symmetrically, never a per-component 1px fix.
  // The same neutral layer also prevents LCD/grayscale text raster mismatch.
  for (const [locator, geometry] of [
    [reference, naturalReference],
    [actual, naturalActual],
  ] as const) {
    await locator.evaluate((element, style) => {
      Object.assign((element as HTMLElement).style, style);
    }, captureStyle(geometry));
  }
  await testInfo.attach(`${name}-geometry`, {
    contentType: 'application/json',
    body: JSON.stringify({
      rasterization: 'integer origin; translateZ(0) on both isolated samples',
      naturalReference,
      naturalActual,
      alignedReference: await reference.boundingBox(),
      alignedActual: await actual.boundingBox(),
    }),
  });
  await compare(
    await reference.screenshot({ animations: 'disabled' }),
    await actual.screenshot({ animations: 'disabled' }),
    testInfo,
    name,
  );
}
