import type { BrowserContext, Locator, Page } from '@playwright/test';
import { test, expect, login } from '../e2e/fixtures';
import { draftThenConfirmed, seedDemand } from '../e2e/staffing-seed';
import { samplePages } from '../../src/app/dev/staffing/samples';
import { compareElements, expectSameBox, stabilize } from './compare';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import {
  entryScene,
  scenes,
  withinMasks,
  type StaffingScene,
} from './staffing-masks';

/**
 * BOW-853 find-people page against prototype Y, same run, element by element.
 * The header and demand card are compared on the real /staffing route, on the BOW-852
 * demand read (the sample's demand written into the isolated test database). The
 * candidates are compared on the development sample /dev/staffing: the matching read
 * (BOW-854) is not on main yet, and the real route shows matching as not connected.
 */
const viewports = [
  ['desktop', referenceConfig.desktop],
  ['mobile-width', referenceConfig.mobile],
] as const;

async function open(
  context: BrowserContext,
  url: string,
  viewport: { width: number; height: number },
) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(url);
  return page;
}

/** Top and bottom relative to the main column, so the shell above does not count. */
const span = (locator: Locator) =>
  locator.evaluate((element) => {
    const main = document.querySelector('#main')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { top: box.top - main.top, bottom: box.bottom - main.top };
  });

async function expectSameGap(
  prototype: Page,
  page: Page,
  above: string,
  below: string,
  name: string,
) {
  const gap = async (target: Page) =>
    (await span(target.locator(below).first())).top -
    (await span(target.locator(above).first())).bottom;
  expect
    .soft(await gap(page), `gap ${name}`)
    .toBeCloseTo(await gap(prototype), 0);
}

const noOverflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );

async function withPrototype(
  browser: import('@playwright/test').Browser,
  viewport: { width: number; height: number },
  run: (
    prototypeUrl: (path: string) => string,
    context: BrowserContext,
  ) => Promise<void>,
) {
  const server = await startPrototypeServer();
  const referenceContext = await browser.newContext({
    viewport,
    locale: 'zh-CN',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  try {
    await run(
      (path) => `${server.url}/prototype/y/app/${path}`,
      referenceContext,
    );
  } finally {
    await referenceContext.close();
    await server.close();
  }
}

for (const scene of scenes as readonly StaffingScene[])
  for (const [viewportName, viewport] of viewports)
    test(`${scene.name} find-people page at ${viewportName}`, async ({
      browser,
      context,
    }, testInfo) => {
      await withPrototype(browser, viewport, async (url, referenceContext) => {
        const prototype = await open(
          referenceContext,
          url(scene.prototype),
          viewport,
        );
        const page = await open(context, scene.sample, viewport);
        await expect(prototype.locator('#cands article').first()).toBeVisible();
        await expect(page.locator('#cands article').first()).toBeVisible();

        // Text first: a data difference stops the pixel comparison.
        const texts = (target: Page, selector: string) =>
          target.locator(selector).allTextContents();
        for (const selector of [
          '.nt-head h1',
          '.nt-head p',
          '.nt-head__acts .n-badge',
          '#reqs li',
          '#cands .n-person__name .nt-plink',
          '#pending h4',
        ])
          expect
            .soft(await texts(page, selector), selector)
            .toEqual(await texts(prototype, selector));
        // Per requirement: the state and the evidence sentence (the citation popover is
        // read on demand on the engineering side, so it is not in the text).
        const rows = (target: Page) =>
          target.$$eval('#cands article .n-reqs li', (items) =>
            items.map((li) => [
              (li as HTMLElement).dataset.s,
              li.querySelector(':scope > span:last-child')?.childNodes[0]
                ?.textContent,
            ]),
          );
        expect
          .soft(await rows(page), 'requirement rows')
          .toEqual(await rows(prototype));
        // Order is the contract's: supported required items only. No total, rate or
        // percentage on any candidate (a requirement may itself mention a percentage).
        expect(await page.locator('#cands').textContent()).not.toMatch(
          /总分|胜任率|匹配度|\d+\s*%/,
        );
        expect(await noOverflow(page), 'no horizontal overflow').toBe(true);

        await stabilize(prototype);
        await stabilize(page);
        for (const selector of ['.nt-head', '#needcard', '#cands', '#pending'])
          await expectSameBox(
            prototype.locator(selector),
            page.locator(selector),
            `${scene.name} ${selector}`,
            { keys: ['x', 'width'] },
          );
        expect
          .soft((await span(page.locator('.nt-head'))).top, 'head top')
          .toBeCloseTo((await span(prototype.locator('.nt-head'))).top, 0);
        await expectSameGap(
          prototype,
          page,
          '.nt-head',
          '#needcard',
          'head → demand card',
        );
        await expectSameGap(
          prototype,
          page,
          '#needcard',
          'h2.nt-h2',
          'demand card → candidates',
        );
        await expectSameGap(
          prototype,
          page,
          'h2.nt-h2',
          '#cands',
          'heading → first card',
        );

        const name = (part: string) => `${scene.name}-${viewportName}-${part}`;
        const pairs: {
          part: string;
          selector: string;
          mask?: readonly string[];
        }[] = [
          { part: 'head', selector: '.nt-head' },
          // The title alone: the shorter AI badge wraps differently at phone width.
          {
            part: 'demand-title',
            selector: '#needcard > .nt-row:first-child > h3',
          },
          {
            part: 'requirements',
            selector: '#reqs',
            mask: withinMasks.requirements,
          },
          { part: 'add-row', selector: '#needcard > .nt-row:has(#reqadd)' },
          { part: 'demand-caption', selector: '#needcard > .nt-caption' },
          {
            part: 'candidates-heading',
            selector: 'h2.nt-h2',
            mask: withinMasks.candidatesHeading,
          },
          { part: 'pending', selector: '#pending' },
        ];
        const count = await prototype.locator('#cands > article').count();
        for (let index = 1; index <= count; index++)
          pairs.push(
            {
              part: `candidate-${index}-name`,
              selector: `#cands > article:nth-child(${index}) .n-person__name .nt-plink`,
            },
            {
              part: `candidate-${index}-requirements`,
              selector: `#cands > article:nth-child(${index}) ul.n-reqs`,
              mask: withinMasks.candidateRows,
            },
          );
        for (const pair of pairs)
          await compareElements(
            prototype.locator(pair.selector),
            page.locator(pair.selector),
            testInfo,
            name(pair.part),
            { mask: pair.mask, snap: true },
          );
      });
    });

for (const [viewportName, viewport] of viewports)
  test(`manager find-people entry at ${viewportName}`, async ({
    browser,
    context,
  }, testInfo) => {
    await withPrototype(browser, viewport, async (url, referenceContext) => {
      const prototype = await open(
        referenceContext,
        url(entryScene.prototype),
        viewport,
      );
      const page = await open(context, entryScene.sample, viewport);
      await expect(page.locator('#sq')).toBeVisible();
      expect(await page.locator('.n-ask').allTextContents()).toEqual(
        await prototype.locator('.n-ask').allTextContents(),
      );
      expect(await page.locator('#sq').getAttribute('placeholder')).toBe(
        await prototype.locator('#sq').getAttribute('placeholder'),
      );
      expect(await noOverflow(page), 'no horizontal overflow').toBe(true);
      await stabilize(prototype);
      await stabilize(page);
      await expectSameGap(
        prototype,
        page,
        '.n-composer',
        '.n-asks',
        'composer → examples',
      );
      for (const [part, selector] of [
        ['title', '.nt-head h1'],
        ['composer', '.n-composer'],
        ['asks', '.n-asks'],
      ] as const)
        await compareElements(
          prototype.locator(selector),
          page.locator(selector),
          testInfo,
          `${entryScene.name}-${viewportName}-${part}`,
          { snap: true },
        );
    });
  });

/** The prototype scene's demand, on the real route, for the role the scene shows. */
const realScenes = [
  { scene: scenes[0], key: 'agent', role: 'ceo' },
  { scene: scenes[1], key: 'ts', role: 'hrbp' },
] as const;

for (const { scene, key, role } of realScenes)
  for (const [viewportName, viewport] of viewports)
    test(`${scene.name} demand card on the real route at ${viewportName}`, async ({
      browser,
      context,
      referenceApp,
    }, testInfo) => {
      const demand = samplePages[key].demand;
      if (demand.status !== 'confirmed') throw new Error('confirmed sample');
      await seedDemand(referenceApp.pool, draftThenConfirmed(demand));
      await login(context, role, referenceApp.baseURL);
      await withPrototype(browser, viewport, async (url, referenceContext) => {
        const prototype = await open(
          referenceContext,
          url(scene.prototype),
          viewport,
        );
        const page = await open(
          context,
          `/staffing?project=${demand.projectId}&demand=${demand.id}`,
          viewport,
        );
        await expect(prototype.locator('#needcard')).toBeVisible();
        await expect(page.locator('#needcard')).toBeVisible();
        for (const selector of ['.nt-head h1', '.nt-head p', '#reqs li'])
          expect
            .soft(
              await page.locator(selector).allTextContents(),
              `real ${selector}`,
            )
            .toEqual(await prototype.locator(selector).allTextContents());
        // Matching is not connected: the section says so, with no sample candidates.
        await expect(
          page.getByRole('heading', { name: '候选人核对待接通' }),
        ).toBeVisible();
        await expect(page.locator('#cands > article')).toHaveCount(0);
        expect(await noOverflow(page), 'no horizontal overflow').toBe(true);

        await stabilize(prototype);
        await stabilize(page);
        for (const selector of ['.nt-head', '#needcard'])
          await expectSameBox(
            prototype.locator(selector),
            page.locator(selector),
            `real ${scene.name} ${selector}`,
            { keys: ['x', 'width'] },
          );
        await expectSameGap(
          prototype,
          page,
          '.nt-head',
          '#needcard',
          'real head → demand card',
        );
        const name = (part: string) =>
          `real-${scene.name}-${viewportName}-${part}`;
        for (const pair of [
          { part: 'head', selector: '.nt-head' },
          {
            part: 'demand-title',
            selector: '#needcard > .nt-row:first-child > h3',
          },
          {
            part: 'requirements',
            selector: '#reqs',
            mask: withinMasks.requirements,
          },
          { part: 'add-row', selector: '#needcard > .nt-row:has(#reqadd)' },
          { part: 'demand-caption', selector: '#needcard > .nt-caption' },
        ])
          await compareElements(
            prototype.locator(pair.selector),
            page.locator(pair.selector),
            testInfo,
            name(pair.part),
            { mask: pair.mask, snap: true },
          );
      });
    });
