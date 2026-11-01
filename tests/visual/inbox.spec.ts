import type { Browser, Locator } from '@playwright/test';
import { test, expect } from '../e2e/fixtures';
import { referenceConfig } from './reference-config';
import { startPrototypeServer } from './prototype-server';
import { compareElements, expectSameBox, stabilize } from './compare';

/**
 * 待核对 against the pinned reference (prototype-reference.json). At that commit
 * inbox.html only has the 人名 / 课题 items, so the four BOW-862 kinds have no pixel
 * baseline there. What the reference does carry is compared: the page frame
 * (heading, two-column split, side card title) for HR and mentor, and the 核对卡
 * from the design-system page, which every kind reuses. Item content, the lede and
 * the「会归到这些人」dock are registered as gaps in the PR.
 */
async function openPrototype(browser: Browser, path: string) {
  const server = await startPrototypeServer();
  const context = await browser.newContext({
    viewport: referenceConfig.desktop,
    locale: 'zh-CN',
    reducedMotion: 'reduce',
  });
  const prototype = await context.newPage();
  await prototype.goto(`${server.url}/prototype/y/${path}`);
  await stabilize(prototype);
  return {
    prototype,
    close: async () => {
      await context.close();
      await server.close();
    },
  };
}

const styleKeys = [
  'font-size',
  'font-weight',
  'line-height',
  'color',
  'background-color',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-top-color',
  'border-radius',
  'gap',
  'grid-template-columns',
] as const;
/**
 * `tracks` compares grid columns by count, for a sample that sits in a narrower
 * column than the page (the design-system card is in a two-column grid).
 */
const styleOf = (locator: Locator, tracks: boolean) =>
  locator.evaluate(
    (element, { keys, tracks }) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(
        keys.map((key) => {
          const value = style.getPropertyValue(key);
          return [
            key,
            tracks && key === 'grid-template-columns'
              ? `${value.split(' ').length} tracks`
              : value,
          ];
        }),
      );
    },
    { keys: [...styleKeys], tracks },
  );
async function expectSameStyle(
  reference: Locator,
  actual: Locator,
  name: string,
  { tracks = false } = {},
) {
  expect
    .soft(await styleOf(actual, tracks), `${name} computed style`)
    .toEqual(await styleOf(reference, tracks));
}

for (const [as, role] of [
  ['hrbp', 'hr'],
  ['mentor', 'mentor'],
] as const)
  test(`${role}: page frame matches inbox.html?as=${as}`, async ({
    browser,
    page,
  }) => {
    const { prototype, close } = await openPrototype(
      browser,
      `app/inbox.html?as=${as}`,
    );
    try {
      await page.goto(`/dev/inbox?role=${role}`);
      await stabilize(page);
      // The kind filter comes from 81e4fd4 and is not in the pinned reference
      // (参照待同步); take it out of the flow so the split below lines up.
      await page
        .getByRole('group', { name: '按类型筛选' })
        .evaluate((node) => ((node as HTMLElement).style.display = 'none'));
      // The heading block shrinks to its text, and the lede differs from the
      // reference, so the heading is compared by position, not width.
      await expectSameStyle(
        prototype.locator('.nt-head h1'),
        page.locator('.nt-head h1'),
        'heading',
      );
      await expectSameBox(
        prototype.locator('.nt-head h1'),
        page.locator('.nt-head h1'),
        'heading',
        { keys: ['x', 'y', 'height'] },
      );
      for (const selector of ['.nt-split', '#cards']) {
        await expectSameStyle(
          prototype.locator(selector),
          page.locator(selector),
          selector,
        );
        await expectSameBox(
          prototype.locator(selector),
          page.locator(selector),
          selector,
          { keys: ['x', 'y', 'width'] },
        );
      }
      await expectSameStyle(
        prototype.locator('.nt-head p'),
        page.locator('.nt-head p'),
        'lede',
      );
      // The side column only has a card once something is put aside.
      await page
        .locator('.n-verify')
        .first()
        .getByRole('button', { name: '都不是，稍后处理' })
        .click();
      await expect(page.locator('aside .n-card')).toHaveCount(1);
      await expectSameBox(
        prototype.locator('aside.nt-sticky'),
        page.locator('aside.nt-sticky'),
        'side column',
        { keys: ['x', 'y', 'width'] },
      );
      await expectSameStyle(
        prototype.locator('aside .n-card').first(),
        page.locator('aside .n-card').first(),
        'side card',
      );
      await expectSameStyle(
        prototype.locator('aside .n-section-title').first(),
        page.locator('aside .n-section-title').first(),
        'side card title',
      );
      // A card in the column: same width and frame as the prototype's first card.
      await expectSameBox(
        prototype.locator('#cards .n-verify').first(),
        page.locator('#cards .n-verify').first(),
        'first card',
        { keys: ['x', 'y', 'width'] },
      );
    } finally {
      await close();
    }
  });

test('each kind reuses the design-system 核对卡', async ({
  browser,
  page,
}, testInfo) => {
  const { prototype, close } = await openPrototype(
    browser,
    'design-system.html',
  );
  try {
    await page.goto('/dev/inbox?role=hr');
    await stabilize(page);
    const reference = prototype.locator('#c-verify .n-verify');
    await expect(reference).toHaveCount(1);
    for (const id of ['i-spk', 'i-xz', 'i-region', 'i-int']) {
      const item = page.locator(`article#${id}`);
      await expectSameStyle(reference, item, `${id} card`);
      await expectSameStyle(
        reference.locator('.n-src'),
        item.locator('.n-src'),
        `${id} source tag`,
      );
      await expectSameStyle(
        reference.locator('.n-verify__q'),
        item.locator('.n-verify__q'),
        `${id} question`,
      );
      await expectSameStyle(
        reference.locator('.n-choices'),
        item.locator('.n-choices').first(),
        `${id} choices`,
        { tracks: true },
      );
      await expectSameStyle(
        reference.locator('.n-choice').first(),
        item.locator('.n-choice').first(),
        `${id} choice`,
      );
    }
    // A choice that cannot be picked looks it (`.n-choice:disabled`, 81e4fd4).
    const scope = page
      .locator('article#i-region .n-choice')
      .filter({ hasText: '整理框出的范围' });
    await expect(scope).toBeDisabled();
    const look = await scope.evaluate((node) => {
      const style = getComputedStyle(node);
      return { opacity: Number(style.opacity), cursor: style.cursor };
    });
    expect(look.opacity).toBeLessThan(1);
    expect(look.cursor).toBe('not-allowed');
    // The same「都不是，稍后处理」choice, pixel for pixel.
    await compareElements(
      reference.locator('.n-choice').last(),
      page
        .locator('article#i-spk .n-choice')
        .filter({ hasText: '都不是，稍后处理' }),
      testInfo,
      'inbox-choice-later',
    );
  } finally {
    await close();
  }
});
