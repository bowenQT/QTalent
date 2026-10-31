import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * BOW-841 workbench sections in a real browser, on the development sample /dev/workbench
 * (fixed demo views) until /work reads real data (BOW-838). Navigation targets are not
 * built yet (record BOW-847, find people BOW-853): only the navigation and the handover
 * are checked, never the target page.
 */
async function tabTo(page: Page, target: string, limit = 40) {
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press('Tab');
    if (
      await page
        .locator(target)
        .evaluate((node) => node === document.activeElement)
    )
      return;
  }
  throw new Error(`${target} is not reachable with Tab`);
}
const focused = (page: Page) =>
  page.evaluate(() => {
    const node = document.activeElement as HTMLElement;
    return {
      text: node.getAttribute('aria-label') ?? node.textContent?.trim(),
      ring: getComputedStyle(node).boxShadow !== 'none',
    };
  });
const draft = (page: Page, key: string) =>
  page.evaluate((name) => sessionStorage.getItem(name), key);

test('mentor reaches input, send, examples and every trainee by keyboard', async ({
  page,
}) => {
  await page.goto('/dev/workbench?role=mentor');
  await tabTo(page, '#composer-field');
  const order: string[] = [];
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press('Tab');
    const now = await focused(page);
    expect(now.ring, `${now.text} shows focus`).toBe(true);
    order.push(now.text ?? '');
  }
  expect(order).toEqual([
    '发送',
    '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了',
    '周初晴这周先画了接口图，再去找后端对齐',
    '季思齐',
    '记一件事',
  ]);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/record\?person=p-x06$/);
});

test('HR opens a slash command with the keyboard only', async ({ page }) => {
  await page.goto('/dev/workbench?role=hr');
  await tabTo(page, '#composer-field');
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox', { name: '命令' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option')).toHaveText([
    '记一件事/记',
    '为项目找人/找',
  ]);
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('option', { selected: true })).toHaveText(
    '为项目找人/找',
  );
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.type('找');
  await expect(menu.getByRole('option')).toHaveText(['为项目找人/找']);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/staffing\?new=1$/);
});

test('HR sends a sentence: the text goes through session storage, not the URL', async ({
  page,
}) => {
  await page.goto('/dev/workbench?role=hr');
  const field = page.getByRole('textbox', { name: '描述你要做的事' });
  await field.fill('谷嘉树这周把覆盖率补到了 80%');
  await field.press('Enter');
  await expect(field).toHaveValue('谷嘉树这周把覆盖率补到了 80%\n');
  await field.press('ControlOrMeta+Enter');
  await expect(page).toHaveURL(/\/record\?draft=work$/);
  expect(page.url()).not.toContain(encodeURIComponent('谷嘉树'));
  expect(JSON.parse((await draft(page, 'niu-talent:draft:record'))!)).toEqual({
    accountId: 'sample-hrbp',
    text: '谷嘉树这周把覆盖率补到了 80%',
    savedAt: expect.any(Number),
  });
});

test('manager example panel and find box send to find people with Enter', async ({
  page,
}) => {
  await page.goto('/dev/workbench?role=manager');
  const asks = page.locator('.n-find__asks');
  await expect(asks).toBeHidden();
  await tabTo(page, '#composer-field');
  await expect(asks).toBeVisible();
  await page.keyboard.press('Tab');
  expect((await focused(page)).text).toBe('开始找人');
  await expect(asks).toBeVisible();
  await page.keyboard.press('Tab');
  expect((await focused(page)).text).toBe(
    'MaaS 智能体平台要一个能牵头应用后端的人，10 月到岗',
  );
  await page.keyboard.press('Enter');
  const field = page.getByRole('textbox', { name: '描述你要找什么样的人' });
  await expect(field).toBeFocused();
  await expect(asks).toBeHidden();
  await field.press('Enter');
  await expect(page).toHaveURL(/\/staffing\?new=1&draft=work$/);
  expect(await draft(page, 'niu-talent:draft:staffing')).toContain(
    'MaaS 智能体平台',
  );
});
