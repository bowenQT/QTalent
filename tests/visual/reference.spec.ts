import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect, login, type DemoRole } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { captureStyle } from './capture-geometry';
import { componentSamples } from './component-samples';
async function stabilize(page: Page) {
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
async function matchingMasks(left: Page, right: Page) {
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
async function compare(
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
async function compareElements(
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
for (const role of ['ceo', 'hrbp', 'mentor'] satisfies DemoRole[]) {
  for (const [viewportName, viewport] of [
    ['desktop', referenceConfig.desktop],
    ['mobile-width', referenceConfig.mobile],
  ] as const) {
    test(`${role} shell and project list at ${viewportName}`, async ({
      browser,
      page,
      context,
      referenceApp,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await login(context, role, referenceApp.baseURL);
      const server = await startPrototypeServer();
      const referenceContext = await browser.newContext({
        viewport,
        locale: 'zh-CN',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      try {
        const prototype = await referenceContext.newPage();
        await prototype.goto(
          `${server.url}/prototype/y/app/projects.html?as=${role}`,
        );
        await page.goto('/projects');
        await expect(prototype.locator('.n-project')).not.toHaveCount(0);
        await expect(page.locator('.n-project')).not.toHaveCount(0);
        expect(
          await page.locator('.n-project__name').allTextContents(),
          'data/order mismatch, screenshot comparison intentionally stopped',
        ).toEqual(
          await prototype.locator('.n-project__name').allTextContents(),
        );
        expect(
          await page.locator('.n-project__goal').allTextContents(),
          'goal mismatch',
        ).toEqual(
          await prototype.locator('.n-project__goal').allTextContents(),
        );
        await stabilize(prototype);
        await stabilize(page);
        await matchingMasks(prototype, page);
        await compare(
          await prototype.screenshot({
            animations: 'disabled',
            fullPage: true,
          }),
          await page.screenshot({ animations: 'disabled', fullPage: true }),
          testInfo,
          `${role}-${viewportName}`,
        );
      } finally {
        await referenceContext.close();
        await server.close();
      }
    });
  }
}
test('new project dialog matches the current prototype render', async ({
  browser,
  page,
  context,
  referenceApp,
}, testInfo) => {
  await login(context, 'ceo', referenceApp.baseURL);
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
  });
  try {
    const prototype = await referenceContext.newPage();
    await prototype.goto(`${server.url}/prototype/y/app/projects.html?as=ceo`);
    await page.goto('/projects');
    await prototype.getByRole('button', { name: '新建项目' }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    expect(
      await page.locator('[name="ownerId"] option').allTextContents(),
      'eligible-person data mismatch',
    ).toEqual(await prototype.locator('#np-owner option').allTextContents());
    expect(
      await page.locator('.n-dialog .n-check').allTextContents(),
      'member labels and project load mismatch',
    ).toEqual(await prototype.locator('.n-dialog .n-check').allTextContents());
    await stabilize(prototype);
    await stabilize(page);
    const prototypeGeometry = await prototype
      .locator('.n-dialog')
      .boundingBox();
    const engineeringGeometry = await page.getByRole('dialog').boundingBox();
    await testInfo.attach('new-project-dialog-geometry', {
      contentType: 'application/json',
      body: JSON.stringify({
        prototype: prototypeGeometry,
        engineering: engineeringGeometry,
      }),
    });
    expect
      .soft(
        {
          width: engineeringGeometry?.width,
          height: engineeringGeometry?.height,
        },
        'dialog natural CSS geometry',
      )
      .toEqual({
        width: prototypeGeometry?.width,
        height: prototypeGeometry?.height,
      });
    await compare(
      await prototype
        .locator('.n-dialog')
        .screenshot({ animations: 'disabled' }),
      await page.getByRole('dialog').screenshot({ animations: 'disabled' }),
      testInfo,
      'new-project-dialog',
    );
  } finally {
    await referenceContext.close();
    await server.close();
  }
});
for (const sample of componentSamples) {
  test(`ported component ${sample.name} matches design-system controls`, async ({
    browser,
    page,
  }, testInfo) => {
    const server = await startPrototypeServer();
    const referenceContext = await browser.newContext({
      viewport: referenceConfig.desktop,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    try {
      const prototype = await referenceContext.newPage();
      await prototype.goto(`${server.url}/prototype/y/design-system.html`);
      await page.goto('/dev/design-system');
      await stabilize(prototype);
      await stabilize(page);
      await compareElements(
        prototype.locator(sample.reference),
        page.locator(sample.actual),
        testInfo,
        sample.name,
      );
    } finally {
      await referenceContext.close();
      await server.close();
    }
  });
}
