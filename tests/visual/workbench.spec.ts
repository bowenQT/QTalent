import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { compareElements, expectSameBox, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import {
  notRendered,
  prototypeRole,
  withinMasks,
  type WorkbenchRole,
} from './workbench-masks';

/**
 * BOW-841 workbench sections against prototype Y, same run, element by element.
 * The engineering side is the development sample /dev/workbench (fixed demo views): the
 * real read (BOW-838) and the revised contract (#202) are not on main yet. When /work
 * reads real data, this spec moves to it and keeps the same comparisons.
 * Whole-page pixels are not compared: blocks that are not rendered move everything
 * below them. Positions are checked separately (expectSameBox) before pixels.
 */
// Same instant on both sides, so the time-of-day greeting matches (UTC 07:00 → 上午好).
const instant = new Date('2026-09-04T07:00:00Z');

async function open(
  context: BrowserContext,
  url: string,
  viewport: { width: number; height: number } = referenceConfig.desktop,
) {
  await context.clock.setFixedTime(instant);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url);
  return page;
}

/** Layout blocks in prototype order; `afterPrevious` when nothing omitted sits between. */
type Block = { name: string; selector: string; afterPrevious: boolean };
const head: Block = {
  name: 'head',
  selector: '.nt-head',
  afterPrevious: false,
};
const blocks: Record<WorkbenchRole, Block[]> = {
  manager: [
    head,
    { name: 'find', selector: 'section.n-find', afterPrevious: true },
  ],
  hr: [
    head,
    { name: 'composer', selector: '#composer', afterPrevious: false },
    { name: 'asks', selector: '.n-asks', afterPrevious: true },
  ],
  mentor: [
    head,
    { name: 'composer', selector: '#composer', afterPrevious: true },
    { name: 'asks', selector: '.n-asks', afterPrevious: true },
    { name: 'students', selector: '#students', afterPrevious: true },
  ],
};

/** Pixel comparisons: element selector (same on both sides) and masks inside it. */
type Sample = { name: string; selector: string; mask?: readonly string[] };
function samples(role: WorkbenchRole, desktop: boolean): Sample[] {
  if (role === 'manager')
    return [
      { name: 'head', selector: '.nt-head > div:first-child' },
      { name: 'find', selector: 'section.n-find', mask: withinMasks.composer },
    ];
  const shared: Sample[] = [
    { name: 'greeting', selector: '.nt-head h1' },
    { name: 'composer', selector: '#composer', mask: withinMasks.composer },
  ];
  if (role === 'hr')
    return [
      ...shared,
      { name: 'ask', selector: '.n-asks > .n-ask:first-child' },
    ];
  const rows = Array.from({ length: 10 }, (_, index) => ({
    name: `student-${index + 1}`,
    selector: `.n-students__list > li:nth-child(${index + 1}) > div:not(.n-students__acts)`,
  }));
  return [
    ...shared,
    { name: 'asks', selector: '.n-asks' },
    // Whole card first, since later samples restyle its rows; desktop width only: on a
    // phone the prototype's extra recommend button narrows each row and rewraps it.
    ...(desktop
      ? [
          {
            name: 'students',
            selector: '#students',
            mask: withinMasks.studentActs,
          },
        ]
      : []),
    { name: 'students-title', selector: '#students > h3' },
    { name: 'students-caption', selector: '#students > .nt-caption' },
    ...rows,
  ];
}

/** Top and bottom relative to the main column, so the shell above does not count. */
const span = (locator: Locator) =>
  locator.evaluate((element) => {
    const main = document.querySelector('#main')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { top: box.top - main.top, bottom: box.bottom - main.top };
  });

/** Class list of the main column's direct children, in order. */
const order = (page: Page, omit: readonly string[] = []) =>
  page.evaluate((hidden) => {
    const skip = new Set(
      hidden.flatMap((selector) => [...document.querySelectorAll(selector)]),
    );
    return [...document.querySelector('#main')!.children]
      .filter((node) => !skip.has(node))
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`);
  }, omit);

for (const role of ['manager', 'hr', 'mentor'] satisfies WorkbenchRole[]) {
  for (const [viewportName, viewport] of [
    ['desktop', referenceConfig.desktop],
    ['mobile-width', referenceConfig.mobile],
  ] as const) {
    test(`${role} workbench sections at ${viewportName}`, async ({
      browser,
      context,
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
          `${server.url}/prototype/y/app/index.html?as=${prototypeRole[role]}`,
          viewport,
        );
        const page = await open(
          context,
          `/dev/workbench?role=${role}`,
          viewport,
        );
        await expect(prototype.locator('.nt-head h1')).toBeVisible();
        await expect(page.locator('.nt-head h1')).toHaveText(/上午好/);

        // Text first: a data difference stops the pixel comparison.
        const texts = (target: Page, selector: string) =>
          target.locator(selector).allTextContents();
        expect(await texts(page, '.nt-head h1')).toEqual(
          await texts(prototype, '.nt-head h1'),
        );
        expect(
          await page.locator('#composer-field').getAttribute('placeholder'),
        ).toBe(
          await prototype
            .locator('#composer-field')
            .getAttribute('placeholder'),
        );
        if (role === 'manager')
          expect(await texts(page, '.n-find__ask')).toEqual(
            await texts(prototype, '.n-find__ask'),
          );
        else
          expect(await texts(page, '.n-ask')).toEqual(
            (await texts(prototype, '.n-ask')).slice(0, role === 'hr' ? 1 : 2),
          );
        if (role === 'mentor')
          expect(await texts(page, '.n-students__list b')).toEqual(
            await texts(prototype, '.n-students__list b'),
          );

        // Arrangement: what is rendered keeps the prototype order.
        expect(await order(page)).toEqual(
          await order(prototype, notRendered[role]),
        );
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <=
              document.documentElement.clientWidth,
          ),
          'no horizontal overflow',
        ).toBe(true);

        await stabilize(prototype);
        await stabilize(page);
        // Positions before pixels: compareElements later forces the widths equal.
        // Vertical place: the first block from the top of the main column, the others by
        // their gap to the block above when the prototype has nothing omitted between.
        let previous: { reference: Locator; actual: Locator } | null = null;
        for (const block of blocks[role]) {
          const reference = prototype.locator(block.selector);
          const actual = page.locator(block.selector);
          await expectSameBox(reference, actual, `${role} ${block.name}`, {
            keys: ['x', 'width'],
          });
          const [left, right] = [await span(reference), await span(actual)];
          if (!previous)
            expect
              .soft(right.top, `${role} ${block.name} top in the main column`)
              .toBeCloseTo(left.top, 0);
          else if (block.afterPrevious) {
            const [above, below] = [
              await span(previous.reference),
              await span(previous.actual),
            ];
            expect
              .soft(right.top - below.bottom, `${role} gap above ${block.name}`)
              .toBeCloseTo(left.top - above.bottom, 0);
          }
          previous = { reference, actual };
        }
        for (const sample of samples(role, viewportName === 'desktop'))
          await compareElements(
            prototype.locator(sample.selector),
            page.locator(sample.selector),
            testInfo,
            `${role}-${viewportName}-${sample.name}`,
            { mask: sample.mask, snap: true },
          );
        if (role === 'mentor')
          await compareElements(
            prototype.locator('.n-students__acts .n-btn--ink').first(),
            page.locator('.n-students__acts .n-btn--ink').first(),
            testInfo,
            `${role}-${viewportName}-record-button`,
          );
      } finally {
        await referenceContext.close();
        await server.close();
      }
    });
  }
}

test('manager example panel opens on focus and matches the prototype', async ({
  browser,
  context,
}, testInfo) => {
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  try {
    const prototype = await open(
      referenceContext,
      `${server.url}/prototype/y/app/index.html?as=ceo`,
    );
    const page = await open(context, '/dev/workbench?role=manager');
    for (const target of [prototype, page]) {
      await expect(target.locator('.n-find__asks')).toBeHidden();
      await stabilize(target);
      await target.locator('#composer-field').focus();
      await expect(target.locator('.n-find__asks')).toBeVisible();
    }
    await expectSameBox(
      prototype.locator('.n-find__asks'),
      page.locator('.n-find__asks'),
      'manager example panel',
    );
    await compareElements(
      prototype.locator('.n-find__asks'),
      page.locator('.n-find__asks'),
      testInfo,
      'manager-find-asks',
    );
    // Typing hides the panel on both sides.
    for (const target of [prototype, page]) {
      await target.locator('#composer-field').fill('找');
      await expect(target.locator('.n-find__asks')).toBeHidden();
    }
  } finally {
    await referenceContext.close();
    await server.close();
  }
});
