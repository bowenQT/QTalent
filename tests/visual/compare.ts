import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { captureStyle } from './capture-geometry';
import {
  allBoxKeys,
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
 * Page-level masks: `referenceConfig.masks` plus the page's own `extraSelectors`
 * (de-duplicated). Rectangles are the union of both renders and are painted at the same
 * document coordinates on both sides.
 */
export async function matchingMasks(
  left: Page,
  right: Page,
  extraSelectors: readonly string[] = [],
) {
  // Use the union of actual boxes on BOTH renders. A missing badge/recent block must
  // not create a differently positioned mask on the production side.
  const selectors = [...new Set([...referenceConfig.masks, ...extraSelectors])];
  const boxes = [];
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

type Measured = {
  container: Rect;
  clientLeft: number;
  clientTop: number;
  nodes: Rect[];
};

/**
 * Masks inside the compared element. Selectors are matched within the element on both
 * sides (write the prototype's selector); each side's rectangles are taken relative to
 * its own element, united, and painted at the same relative position on both. Page-level
 * masks would land in the wrong place once the element widths and positions are aligned.
 * Call it through compareElements' `mask` option, after the widths are aligned.
 */
export async function maskWithin(
  reference: Locator,
  actual: Locator,
  selectors: readonly string[],
) {
  const measure = (locator: Locator) =>
    locator.evaluate((element, list): Measured => {
      const rect = (target: Element) => {
        const { x, y, width, height } = target.getBoundingClientRect();
        return { x, y, width, height };
      };
      return {
        container: rect(element),
        clientLeft: element.clientLeft,
        clientTop: element.clientTop,
        nodes: list.flatMap((selector) =>
          [...element.querySelectorAll(selector)].map(rect),
        ),
      };
    }, selectors);
  const sides = [await measure(reference), await measure(actual)];
  const rects = uniqueRects(
    sides.flatMap((side) => relativeRects(side.container, side.nodes)),
  );
  if (!rects.length) return;
  for (const [locator, side] of [
    [reference, sides[0]],
    [actual, sides[1]],
  ] as const)
    await locator.evaluate(
      (element, input) => {
        const host = element as HTMLElement;
        if (getComputedStyle(host).position === 'static')
          host.style.position = 'relative';
        for (const { style, rect } of input.masks) {
          const mask = document.createElement('div');
          mask.dataset.visualMask = 'true';
          Object.assign(mask.style, style, {
            // An absolute child is placed against the padding box, inside the border.
            left: `${rect.x - input.clientLeft}px`,
            top: `${rect.y - input.clientTop}px`,
          });
          host.append(mask);
        }
      },
      {
        clientLeft: side.clientLeft,
        clientTop: side.clientTop,
        masks: rects.map((rect) => ({
          rect,
          style: maskStyle(rect, { x: 0, y: 0 }),
        })),
      },
    );
}

/**
 * Whole-pixel layout origin for the element: html gets a padding-top that moves the
 * element's document y to an integer, shifting the page as one without changing any
 * distance inside it. Repeating it never accumulates.
 */
export async function snapLayout(locator: Locator) {
  const top = await locator.evaluate((element) => {
    document.documentElement.style.paddingTop = '';
    return element.getBoundingClientRect().top + window.scrollY;
  });
  const padding = snapPadding(top);
  if (padding)
    await locator.evaluate((_element, value) => {
      document.documentElement.style.paddingTop = `${value}px`;
    }, padding);
}

type RegionRules = {
  /** Prototype only: nodes the production page does not render; removed from layout. */
  omit?: readonly string[];
  /** Both sides: the i-th match on each side becomes an equal, empty placeholder box. */
  replace?: readonly string[];
};

/**
 * Evens out regions before capture, in the rendered DOM only. Order of use:
 * normalizeRegions, stabilize, matchingMasks, then compare or compareElements.
 */
export async function normalizeRegions(
  reference: Page,
  actual: Page,
  rules: RegionRules,
) {
  for (const selector of rules.omit ?? [])
    await reference.evaluate((query) => {
      for (const node of document.querySelectorAll<HTMLElement>(query))
        node.style.setProperty('display', 'none', 'important');
    }, selector);
  for (const selector of rules.replace ?? []) {
    const boxes = (page: Page) =>
      page.evaluate((query) => {
        return [...document.querySelectorAll(query)].map((node) => {
          const { width, height } = node.getBoundingClientRect();
          return { width, height };
        });
      }, selector);
    const [left, right] = [await boxes(reference), await boxes(actual)];
    if (left.length !== right.length)
      throw new Error(
        `normalizeRegions: "${selector}" matches ${left.length} nodes in the prototype and ${right.length} in the engineering page`,
      );
    // A width difference means the container layout differs; a placeholder must not hide it.
    expect
      .soft(
        right.map((box) => box.width),
        `"${selector}" container width`,
      )
      .toEqual(left.map((box) => expect.closeTo(box.width, 0)));
    for (const page of [reference, actual])
      await page.evaluate(
        ({ query, sizes }) => {
          [...document.querySelectorAll<HTMLElement>(query)].forEach(
            (node, index) => {
              if (getComputedStyle(node).display === 'inline')
                node.style.display = 'inline-block';
              node.replaceChildren();
              Object.assign(node.style, {
                boxSizing: 'border-box',
                width: `${sizes[index].width}px`,
                height: `${sizes[index].height}px`,
                minHeight: `${sizes[index].height}px`,
                overflow: 'hidden',
                padding: '0',
                border: '0',
                background: '#e6e6e6',
              });
            },
          );
        },
        { query: selector, sizes: left },
      );
  }
}

/**
 * Geometry before pixels: soft-asserts that the two elements have the same rectangle in
 * document coordinates. Call it before compareElements, which forces the engineering
 * element to the prototype's width and would make a later measurement meaningless.
 */
export async function expectSameBox(
  reference: Locator,
  actual: Locator,
  name: string,
  options: { keys?: readonly BoxKey[]; tolerance?: number } = {},
) {
  const measure = (locator: Locator): Promise<Rect> =>
    locator.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + scrollX, y: y + scrollY, width, height };
    });
  const differences = boxDifferences(
    await measure(reference),
    await measure(actual),
    options.keys ?? allBoxKeys,
    options.tolerance ?? 1,
  );
  expect
    .soft(differences, `${name} box differs from the prototype`)
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
