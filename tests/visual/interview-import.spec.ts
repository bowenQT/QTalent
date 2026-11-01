import type { BrowserContext, Page } from '@playwright/test';
import manifest from '../fixtures/prototype-manifest.json' with { type: 'json' };
import { test, expect } from '../e2e/fixtures';
import { compareElements, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';

/**
 * BOW-907 interview import preview against prototype Y, same run, element by element,
 * on the development sample /dev/import (BOW-906 is not on main).
 *
 * The prototype page (app/import.html) arrived with BOW-898 (#250, 81e4fd4), after the
 * pinned reference commit. Until X1 moves prototype-reference.json past it (requested in
 * #248), the pinned baseline has no such page and these comparisons are skipped, which
 * the PR reports as not verified; the manual side-by-side at 81e4fd4 is in the PR.
 *
 * Left out on purpose: the import bar's action group (import is not connected, so the
 * engineering side shows「导入待接通」next to the disabled button) and the bar's place
 * on screen (it is sticky to a viewport whose shell differs).
 */
const page = 'prototype/y/app/import.html';
const pinned = manifest.files.some((file) => file.path === page);

test.skip(
  !pinned,
  `${page} 不在固定参照 ${referenceConfig.commit} 里，等 X1 更新 prototype-reference.json`,
);

const viewports = [
  ['desktop', referenceConfig.desktop],
  ['mobile-width', referenceConfig.mobile],
] as const;

async function open(
  context: BrowserContext,
  url: string,
  viewport: { width: number; height: number },
) {
  const opened = await context.newPage();
  await opened.setViewportSize(viewport);
  await opened.goto(url);
  await opened.locator('#iv-rows').waitFor();
  await stabilize(opened);
  return opened;
}

const blocks = [
  ['head', '.nt-head'],
  ['earlier-import', '.n-note'],
  ['summary', '.n-rsum'],
  ['row-confirm', '#iv-r1'],
  ['row-verify-unread', '#iv-r2'],
  ['row-confirm-redacted', '#iv-r5'],
  ['row-unknown', '#iv-r7'],
  ['skipped', 'details.nt-fold'],
  ['bar-caption', '.n-ivbar > .nt-muted'],
] as const;

for (const [viewportName, viewport] of viewports)
  test(`interview import preview at ${viewportName}`, async ({
    browser,
    context,
    referenceApp,
  }, testInfo) => {
    const server = await startPrototypeServer();
    const referenceContext = await browser.newContext({
      viewport,
      locale: 'zh-CN',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    try {
      const prototype: Page = await open(
        referenceContext,
        `${server.url}/${page}?as=hrbp&id=imp-1`,
        viewport,
      );
      const actual = await open(
        context,
        `${referenceApp.baseURL}/dev/import`,
        viewport,
      );
      // Text first: a data difference stops the pixel comparison.
      for (const [name, selector] of blocks)
        expect(
          await actual.locator(selector).allInnerTexts(),
          `${name} text`,
        ).toEqual(await prototype.locator(selector).allInnerTexts());
      for (const [name, selector] of blocks)
        await compareElements(
          prototype.locator(selector),
          actual.locator(selector),
          testInfo,
          `${viewportName}-${name}`,
        );
    } finally {
      await referenceContext.close();
      await server.close();
    }
  });
