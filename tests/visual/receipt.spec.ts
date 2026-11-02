import type { BrowserContext, Page } from '@playwright/test';
import manifest from '../fixtures/prototype-manifest.json' with { type: 'json' };
import { test, expect } from '../e2e/fixtures';
import { compareElements, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';

/**
 * BOW-847 回执页 against prototype Y (app/receipt.html?id=d-ms2, mentor), same run,
 * element by element, on the development sample /dev/receipt.
 *
 * The prototype page arrived with BOW-898 (#250, 81e4fd4), after the pinned reference
 * commit. Until X1 moves prototype-reference.json past it (requested in #248), the pinned
 * baseline has no such page and these comparisons are skipped, which the PR reports as not
 * verified through this spec; the manual same-run comparison against the working-tree
 * prototype is in the PR.
 *
 * Left out on purpose, each registered in docs/reference-route-map.md: the summary count
 * of people and the people list (897 lists only identified subjects; the prototype also
 * counts the two names still waiting to be identified), the waiting-to-be-identified cards
 * and the review rows (no speaker label in the contract, and review is not connected), and
 * the file rows (the receipt carries no length or page count per file).
 */
const page = 'prototype/y/app/receipt.html';
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
  await opened.locator('.n-rcpt').first().waitFor();
  await stabilize(opened);
  // The right column is sticky to a viewport whose shell differs; in flow on both.
  await opened.addStyleTag({
    content: '.nt-sticky { position: static !important; }',
  });
  return opened;
}

const blocks = [
  ['head', '.nt-head'],
  ['files-title', '.nt-split .n-card >> nth=0 >> .n-section-title'],
  ['review-title', '.nt-split .n-card >> nth=1 >> .n-section-title'],
  ['confirm-title', '#rc-h'],
  ['event-1', '#confirm .n-rcpt >> nth=0'],
  ['event-2', '#confirm .n-rcpt >> nth=1'],
  ['event-3', '#confirm .n-rcpt >> nth=2'],
] as const;

for (const [viewportName, viewport] of viewports)
  test(`receipt at ${viewportName}`, async ({
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
        `${server.url}/${page}?id=d-ms2&as=mentor`,
        viewport,
      );
      const actual = await open(
        context,
        `${referenceApp.baseURL}/dev/receipt?role=mentor`,
        viewport,
      );
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
          { snap: true },
        );
    } finally {
      await referenceContext.close();
      await server.close();
    }
  });
