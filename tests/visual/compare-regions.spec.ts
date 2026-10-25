import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  expectSameBox,
  maskWithin,
  matchingMasks,
  normalizeRegions,
  snapLayout,
} from './compare';

/**
 * 截图比较接口自身的浏览器用例：两侧都用 setContent 构造的小页面，
 * 不需要数据库、原型服务或应用服务，所以直接用 Playwright 自带夹具。
 */
const base =
  '<style>body{margin:0;font:16px/20px sans-serif}.card{width:240px;border:2px solid #333;padding:8px;background:#fff}</style>';
async function pair(browser: Browser, page: Page, left: string, right: string) {
  const other = await browser.newPage();
  await page.setContent(base + left);
  await other.setContent(base + right);
  return other;
}
const masks = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-visual-mask]')].map(
      (mask) => {
        const { x, y, width, height } = mask.getBoundingClientRect();
        return { x, y, width, height };
      },
    ),
  );

test.describe('page masks', () => {
  test('keep the global masks and add page selectors as a union on both sides', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      '<div class="nt-recent" style="margin:10px;width:50px;height:20px"></div>',
      '<div style="height:40px"></div><p class="extra" style="margin:0;width:30px;height:10px"></p>',
    );
    await matchingMasks(page, right);
    expect(await masks(page)).toEqual([
      { x: 10, y: 10, width: 50, height: 20 },
    ]);
    expect(await masks(right)).toEqual(await masks(page));
    await matchingMasks(page, right, ['.extra', '.nt-recent']);
    const expected = [
      { x: 10, y: 10, width: 50, height: 20 },
      { x: 10, y: 10, width: 50, height: 20 },
      { x: 0, y: 40, width: 30, height: 10 },
    ];
    expect(await masks(page)).toEqual(expected);
    expect(await masks(right)).toEqual(expected);
    await right.close();
  });
});

test.describe('region normalization', () => {
  test('omits prototype-only blocks and replaces data-driven containers', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      '<p class="only">原型独有</p><div class="sum" style="width:200px"><p>甲</p><p>乙</p></div>',
      '<p class="only">两侧都有</p><div class="sum" style="width:200px"><p>丙</p></div>',
    );
    await normalizeRegions(page, right, { omit: ['.only'], replace: ['.sum'] });
    await expect(page.locator('.only')).toBeHidden();
    await expect(right.locator('.only')).toBeVisible();
    const left = await page.locator('.sum').boundingBox();
    const other = await right.locator('.sum').boundingBox();
    expect(other?.width).toBe(left?.width);
    expect(other?.height).toBe(left?.height);
    expect(left?.height).toBeGreaterThan(0);
    await expect(page.locator('.sum p')).toHaveCount(0);
    await expect(right.locator('.sum p')).toHaveCount(0);
    await right.close();
  });
  test('turns inline placeholders into sized boxes', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      '<span class="tag">甲乙丙</span>',
      '<span class="tag">丁戊己</span>',
    );
    const size = await page.locator('.tag').boundingBox();
    await normalizeRegions(page, right, { replace: ['.tag'] });
    for (const side of [page, right]) {
      const tag = side.locator('.tag');
      await expect(tag).toHaveCSS('display', 'inline-block');
      const box = await tag.boundingBox();
      expect([box?.width, box?.height]).toEqual([size?.width, size?.height]);
    }
    await right.close();
  });
  test('rejects replacement pairs with different counts', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      '<i class="x"></i><i class="x"></i>',
      '<i class="x"></i>',
    );
    await expect(
      normalizeRegions(page, right, { replace: ['.x'] }),
    ).rejects.toThrow(
      'normalizeRegions replace .x: prototype 2, engineering 1',
    );
    await right.close();
  });
});

test.describe('element masks', () => {
  const card = (note: string) =>
    `<div class="card"><p style="margin:0">相同内容</p><p class="note" style="margin:0">${note}</p></div>`;
  test('cover the same relative region inside bordered cards at different page positions', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      card('原型说明'),
      `<div style="height:37px"></div>${card('工程说明')}`,
    );
    const shot = () =>
      Promise.all([
        page.locator('.card').screenshot(),
        right.locator('.card').screenshot(),
      ]);
    const [before, after] = await shot();
    expect(before.equals(after)).toBe(false);
    await maskWithin(page.locator('.card'), right.locator('.card'), ['.note']);
    for (const side of [page, right]) {
      const note = await side.locator('.note').boundingBox();
      expect(await side.locator('[data-visual-mask]').boundingBox()).toEqual(
        note,
      );
    }
    const [left, other] = await shot();
    expect(left.equals(other)).toBe(true);
    await right.close();
  });
  test('cover prototype-only nodes on the engineering side too', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      card('原型说明'),
      '<div class="card"><p style="margin:0">相同内容</p><p style="margin:0">　</p></div>',
    );
    await maskWithin(page.locator('.card'), right.locator('.card'), ['.note']);
    expect(await masks(right)).toEqual(await masks(page));
    expect(await masks(right)).toHaveLength(1);
    await right.close();
  });
});

test.describe('layout snapping', () => {
  test('moves fractional element tops to whole pixels without accumulating', async ({
    page,
  }) => {
    await page.setContent(
      `${base}<div style="height:10.25px"></div><p class="t" style="margin:0">文字</p>`,
    );
    const target = page.locator('.t');
    const top = () =>
      target.evaluate((e) => e.getBoundingClientRect().top + scrollY);
    expect(await top()).toBe(10.25);
    await snapLayout(target);
    expect(await top()).toBe(11);
    await snapLayout(target);
    expect(await top()).toBe(11);
    expect(
      await page.evaluate(() => document.documentElement.style.paddingTop),
    ).toBe('0.75px');
  });
});

test.describe('box checks', () => {
  test('pass within tolerance on the requested keys', async ({
    browser,
    page,
  }) => {
    const right = await pair(
      browser,
      page,
      '<div class="b" style="margin-left:10px;width:100px;height:20px"></div>',
      '<div class="b" style="margin:30px 0 0 11px;width:100px;height:20px"></div>',
    );
    await expectSameBox(page.locator('.b'), right.locator('.b'), 'b', {
      keys: ['x', 'width'],
    });
    await right.close();
  });
  test('report differences as soft failures', async ({ browser, page }) => {
    test.fail(true, 'width differs by 2px beyond the 1px default tolerance');
    const right = await pair(
      browser,
      page,
      '<div class="b" style="width:100px;height:20px"></div>',
      '<div class="b" style="width:102px;height:20px"></div>',
    );
    await expectSameBox(page.locator('.b'), right.locator('.b'), 'b');
    await right.close();
  });
});
