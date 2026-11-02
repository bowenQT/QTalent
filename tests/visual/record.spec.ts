import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { compareElements, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';

/**
 * BOW-847 记一件事 against prototype Y (app/record.html, in the pinned reference), same
 * run, element by element, on the development sample /dev/record: writing, waiting
 * for confirmation, and saved.
 *
 * Left out on purpose, each registered in docs/reference-route-map.md:
 * - the voice and attachment buttons: neither is connected, so they show as such
 *   (greyed, saying so); the hint beside them says only what works today;
 * - tags and the tagging step of the trail: the record contract (BOW-844/897) has no
 *   tags, so the trail has three steps and no tag row;
 * - arranging itself: the prototype writes the draft in place as it goes, the batch
 *   here hands the draft over when it is done; only the outcome is compared;
 * - who: the prototype finds the person in the sentence; here the person is chosen
 *   first, since the server derives the evaluation node from them;
 * - the undo toast, which is fixed to the viewport.
 */
const SENTENCE =
  '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了，分工比之前清楚多了。';

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
  await opened.locator('#ev-text').waitFor();
  await stabilize(opened);
  // The right column is sticky to a viewport whose shell differs; in flow on both.
  await opened.addStyleTag({
    content: '.nt-sticky { position: static !important; }',
  });
  return opened;
}

/** Arrange the sentence and wait until the draft waits for confirmation. */
async function arrange(page: Page) {
  await page.locator('#ev-text').fill(SENTENCE);
  await page.locator('#ev-shape').click();
  await page.locator('#ev-save').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('#score-hint')).not.toBeEmpty();
  // The engineering side hands focus to the title; the comparison is of the page at rest.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
}

const writing = [
  ['head', '.nt-head'],
  ['who', '.n-event__head'],
  ['label', '.n-eventin__label'],
  ['field', '#ev-text'],
  ['arrange', '#ev-shape'],
  ['anchors', '#anchor'],
  ['how', 'aside > .n-card'],
] as const;

// Blocks holding a composited child (小犇) or several text runs are compared child by
// child: every match of the selector, in order, with the same count on both sides.
const waiting = [
  ['who', '.n-event__head > *', '.n-event__head'],
  ['title', '.n-event__title'],
  ['sbi', '.n-event__sbar'],
  ['score-ai', '.n-score >> nth=0'],
  ['score-unknown', '.n-score >> nth=1'],
  ['actions', '.nt-row:has(#ev-save)'],
  ['anchors', '#anchor > b, #anchor > .n-badge, #anchor li', '#anchor'],
] as const;

const saved = [
  ['sbi', '.n-event__sbar > *', '.n-event__sbar'],
  ['score-confirmed', '.n-score >> nth=0'],
  ['score-unknown', '.n-score >> nth=1'],
  ['sign', '.n-event__sign'],
] as const;

async function same(
  prototype: Page,
  actual: Page,
  blocks: readonly (readonly [string, string, string?])[],
  testInfo: Parameters<typeof compareElements>[2],
  prefix: string,
) {
  // Text first: a data difference stops the pixel comparison. The「谁」list is left
  // out: the sample follows prototype Y on main, two people more than the pinned one.
  const text = (page: Page, selector: string) =>
    page.locator(selector).evaluateAll((elements) =>
      elements.map((element) => {
        const copy = element.cloneNode(true) as HTMLElement;
        for (const option of copy.querySelectorAll('option:not(:checked)'))
          option.remove();
        // Source whitespace between elements differs and is not drawn in flex rows;
        // spacing is the pixel comparison's to check.
        return (copy.textContent ?? '').replace(/\s+/g, '');
      }),
    );
  for (const [name, selector] of blocks)
    expect(await text(actual, selector), `${prefix}-${name} text`).toEqual(
      await text(prototype, selector),
    );
  // Children compared one by one must also sit in the same place in their block.
  const layout = (page: Page, selector: string, parent: string) =>
    page.locator(selector).evaluateAll((elements, query) => {
      const origin = document.querySelector(query)!.getBoundingClientRect();
      return elements.map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x - origin.x, box.y - origin.y, box.width, box.height].map(
          (value) => Math.round(value * 10) / 10,
        );
      });
    }, parent);
  for (const [name, selector, parent] of blocks)
    if (parent)
      expect(
        await layout(actual, selector, parent),
        `${prefix}-${name} layout`,
      ).toEqual(await layout(prototype, selector, parent));
  for (const [name, selector] of blocks) {
    const count = await prototype.locator(selector).count();
    await expect(
      actual.locator(selector),
      `${prefix}-${name} count`,
    ).toHaveCount(count);
    for (let index = 0; index < count; index++)
      await compareElements(
        prototype.locator(selector).nth(index),
        actual.locator(selector).nth(index),
        testInfo,
        `${prefix}-${name}${count > 1 ? `-${index + 1}` : ''}`,
        // The shells differ by half a pixel in height; compare from whole pixels.
        { snap: true },
      );
  }
}

for (const [viewportName, viewport] of viewports)
  test(`record a thing at ${viewportName}`, async ({
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
      const prototype = await open(
        referenceContext,
        `${server.url}/prototype/y/app/record.html?as=hrbp`,
        viewport,
      );
      const actual = await open(
        context,
        `${referenceApp.baseURL}/dev/record?role=hr`,
        viewport,
      );
      await same(prototype, actual, writing, testInfo, `${viewportName}-write`);

      await arrange(prototype);
      // The node is derived from the chosen person (owner ruling #248 6564917769);
      // the prototype finds the same person in the sentence.
      await actual.locator('#ev-person').selectOption('p-x11');
      await arrange(actual);
      await same(prototype, actual, waiting, testInfo, `${viewportName}-wait`);
      // Arranging is compared by outcome: the same first steps, in the same order.
      const steps = (page: Page) =>
        page.locator('.n-trail__step').allInnerTexts();
      expect(await steps(actual)).toEqual(
        (await steps(prototype)).filter((step) => step !== '从标签库里打标签'),
      );

      await prototype.locator('#ev-save').click();
      await actual.locator('#ev-save').click();
      await prototype.locator('.n-event__sign').waitFor();
      await actual.locator('.n-event__sign').waitFor();
      await same(prototype, actual, saved, testInfo, `${viewportName}-saved`);
    } finally {
      await referenceContext.close();
      await server.close();
    }
  });
