import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  compareElements,
  expectSameBox,
  maskWithin,
  matchingMasks,
  normalizeRegions,
  snapLayout,
} from './compare';

/**
 * Behaviour of the shared comparison helpers on small hand-built pages. No application
 * and no database are involved: each side is a static document in its own page.
 */
async function pair(browser: Browser, left: string, right: string) {
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  });
  const reference = await context.newPage();
  const actual = await context.newPage();
  const style = 'body { margin: 0; font: 16px/20px sans-serif; }';
  await reference.setContent(`<style>${style}</style>${left}`);
  await actual.setContent(`<style>${style}</style>${right}`);
  return { context, reference, actual };
}

const maskBlocks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-visual-mask]')].map(
      (mask) => ({
        left: mask.style.left,
        top: mask.style.top,
        width: mask.style.width,
        height: mask.style.height,
      }),
    ),
  );

test.describe('matchingMasks', () => {
  const globalBlock =
    '<div data-nav-count style="position:absolute;left:10px;top:20px;width:30px;height:12px"></div>';
  const extraBlock =
    '<div class="mine" style="position:absolute;left:100px;top:50px;width:40px;height:16px"></div>';

  test('without extra selectors it masks only what referenceConfig names, on both sides', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      globalBlock + extraBlock,
      extraBlock,
    );
    await matchingMasks(reference, actual);
    const expected = [
      { left: '10px', top: '20px', width: '30px', height: '12px' },
    ];
    expect(await maskBlocks(reference)).toEqual(expected);
    expect(await maskBlocks(actual)).toEqual(expected);
    await context.close();
  });

  test('extra selectors add to the global ones and cover the union of both sides', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      globalBlock,
      extraBlock,
    );
    await matchingMasks(reference, actual, ['.mine', '.mine']);
    const expected = [
      { left: '10px', top: '20px', width: '30px', height: '12px' },
      { left: '100px', top: '50px', width: '40px', height: '16px' },
    ];
    expect(await maskBlocks(reference)).toEqual(expected);
    expect(await maskBlocks(actual)).toEqual(expected);
    await context.close();
  });
});

test.describe('normalizeRegions', () => {
  test('omit hides nodes on the prototype side only', async ({ browser }) => {
    const html = '<p class="legacy">old</p><p class="kept">same</p>';
    const { context, reference, actual } = await pair(browser, html, html);
    await normalizeRegions(reference, actual, { omit: ['.legacy'] });
    const display = (page: Page, selector: string) =>
      page.locator(selector).evaluate((el) => getComputedStyle(el).display);
    expect(await display(reference, '.legacy')).toBe('none');
    expect(await display(actual, '.legacy')).toBe('block');
    expect(await display(reference, '.kept')).toBe('block');
    await context.close();
  });

  test('replace turns the matching nodes of both sides into equal empty boxes', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      '<div class="slot" style="width:200px"><p>one<br>two<br>three</p></div><div class="slot" style="width:90px">tag</div>',
      '<div class="slot" style="width:200px"><p>other</p></div><div class="slot" style="width:90px">longer tag</div>',
    );
    await normalizeRegions(reference, actual, { replace: ['.slot'] });
    const sizes = (page: Page) =>
      page.locator('.slot').evaluateAll((nodes) =>
        nodes.map((node) => {
          const { width, height } = node.getBoundingClientRect();
          return { width, height, children: node.childNodes.length };
        }),
      );
    const left = await sizes(reference);
    expect(left[0]).toEqual({ width: 200, height: 60, children: 0 });
    expect(await sizes(actual)).toEqual(left);
    await context.close();
  });

  test('replace also drops state decoration such as an inset shadow outline', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      '<div class="slot" style="width:200px;height:40px;box-shadow:inset 0 0 0 2px #36c">light</div>',
      '<div class="slot" style="width:200px;height:40px;box-shadow:none">ink</div>',
    );
    await normalizeRegions(reference, actual, { replace: ['.slot'] });
    expect(
      (await reference.locator('.slot').screenshot()).equals(
        await actual.locator('.slot').screenshot(),
      ),
    ).toBeTruthy();
    await context.close();
  });

  test('replace fails loudly when the two sides match different numbers of nodes', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      '<p class="slot">a</p><p class="slot">b</p>',
      '<p class="slot">a</p>',
    );
    await expect(
      normalizeRegions(reference, actual, { replace: ['.slot'] }),
    ).rejects.toThrow(
      '".slot" matches 2 nodes in the prototype and 1 in the engineering page',
    );
    await context.close();
  });

  // The container widths differ, so the soft assertion must report it.
  test.fail(
    'replace does not hide a container width difference',
    async ({ browser }) => {
      const { context, reference, actual } = await pair(
        browser,
        '<div class="slot" style="width:200px">a</div>',
        '<div class="slot" style="width:260px">a</div>',
      );
      try {
        await normalizeRegions(reference, actual, { replace: ['.slot'] });
      } finally {
        await context.close();
      }
    },
  );
});

test.describe('maskWithin', () => {
  const card = (dynamic: string, extra = '') =>
    `<div id="card" style="box-sizing:border-box;margin:30px 0 0 40px;width:220px;padding:10px;border:6px solid #444">
       <p style="margin:0">fixed text</p>
       <p style="margin:8px 0 0"><span class="dyn" style="display:inline-block;width:120px;height:20px;overflow:hidden;white-space:nowrap">${dynamic}</span></p>
       ${extra}
       <p style="margin:8px 0 0">tail text</p>
     </div>`;

  test('hides differing content at the same position inside bordered elements', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      card('AAAAAAAA'),
      card('WWWWWWWW'),
    );
    const left = reference.locator('#card');
    const right = actual.locator('#card');
    // Without the mask the two renders differ, so the equality below proves the mask.
    expect(
      (await left.screenshot()).equals(await right.screenshot()),
    ).toBeFalsy();
    await maskWithin(left, right, ['.dyn']);
    expect(
      (await left.screenshot()).equals(await right.screenshot()),
    ).toBeTruthy();
    await context.close();
  });

  test('covers a node the engineering side lacks with the prototype rectangle', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      card(
        'same',
        '<p class="gone" style="margin:8px 0 0;height:20px;width:90px;background:#9cf">only here</p>',
      ),
      card(
        'same',
        '<p style="margin:8px 0 0;height:20px;width:90px;background:#fc9"></p>',
      ),
    );
    const left = reference.locator('#card');
    const right = actual.locator('#card');
    await maskWithin(left, right, ['.gone']);
    expect(
      (await left.screenshot()).equals(await right.screenshot()),
    ).toBeTruthy();
    await context.close();
  });

  test('compareElements applies the mask option after aligning widths', async ({
    browser,
  }, testInfo) => {
    const { context, reference, actual } = await pair(
      browser,
      card('AAAAAAAA'),
      card('WWWWWWWW').replace('width:220px', 'width:180px'),
    );
    await compareElements(
      reference.locator('#card'),
      actual.locator('#card'),
      testInfo,
      'masked-card',
      { mask: ['.dyn'] },
    );
    await context.close();
  });
});

test.describe('snapLayout', () => {
  test('moves a fractional layout origin onto a whole pixel and does not accumulate', async ({
    browser,
  }) => {
    const { context, reference } = await pair(
      browser,
      '<div id="box" style="margin-top:10.4px;height:30px">x</div>',
      '',
    );
    const top = () =>
      reference
        .locator('#box')
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    expect(await top()).toBeCloseTo(10.4, 1);
    await snapLayout(reference.locator('#box'));
    expect(await top()).toBe(11);
    await snapLayout(reference.locator('#box'));
    expect(await top()).toBe(11);
    await context.close();
  });

  test('leaves a whole-pixel origin untouched', async ({ browser }) => {
    const { context, reference } = await pair(
      browser,
      '<div id="box" style="margin-top:12px;height:30px">x</div>',
      '',
    );
    await snapLayout(reference.locator('#box'));
    expect(
      await reference.evaluate(() => document.documentElement.style.paddingTop),
    ).toBe('');
    await context.close();
  });
});

test.describe('expectSameBox', () => {
  const box = (left: number, width: number) =>
    `<div id="b" style="position:absolute;left:${left}px;top:20px;width:${width}px;height:40px"></div>`;

  test('passes within the tolerance and honours the key list', async ({
    browser,
  }) => {
    const { context, reference, actual } = await pair(
      browser,
      box(10, 300),
      box(10.8, 300.9),
    );
    await expectSameBox(
      reference.locator('#b'),
      actual.locator('#b'),
      'within tolerance',
    );
    await context.close();
  });

  test('ignores keys that are not listed', async ({ browser }) => {
    const { context, reference, actual } = await pair(
      browser,
      box(10, 300),
      box(90, 300),
    );
    await expectSameBox(
      reference.locator('#b'),
      actual.locator('#b'),
      'width only',
      { keys: ['width'] },
    );
    await context.close();
  });

  // The offsets differ by 80px, which must be reported as a soft failure.
  test.fail(
    'fails when a listed key differs beyond the tolerance',
    async ({ browser }) => {
      const { context, reference, actual } = await pair(
        browser,
        box(10, 300),
        box(90, 300),
      );
      try {
        await expectSameBox(
          reference.locator('#b'),
          actual.locator('#b'),
          'shifted box',
        );
      } finally {
        await context.close();
      }
    },
  );
});
