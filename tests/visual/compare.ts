import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { captureStyle } from './capture-geometry';
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
export async function matchingMasks(left: Page, right: Page) {
  // Use the union of actual boxes on BOTH renders. A missing badge/recent block must
  // not create a differently positioned mask on the production side.
  const boxes = [];
  for (const page of [left, right])
    for (const selector of referenceConfig.masks)
      for (const locator of await page.locator(selector).all()) {
        const box = await locator.boundingBox();
        if (box) boxes.push(box);
      }
  for (const page of [left, right])
    await page.evaluate((rectangles) => {
      for (const box of rectangles) {
        const mask = document.createElement('div');
        mask.dataset.visualMask = 'true';
        Object.assign(mask.style, {
          position: 'absolute',
          left: `${box.x + scrollX}px`,
          top: `${box.y + scrollY}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          background: '#ff00ff',
          zIndex: '2147483647',
          pointerEvents: 'none',
        });
        document.body.append(mask);
      }
    }, boxes);
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
) {
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
