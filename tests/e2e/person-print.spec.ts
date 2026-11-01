import type { Page } from '@playwright/test';
import { expect, login, test } from './fixtures';

/**
 * The profile print (BOW-911) on the development sample /dev/person-print: prototype Y's
 * print of the same pseudonymous people, through in-memory ports. `window.print` is
 * stubbed so the sheet can be read under print media.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
});
const printed = (page: Page) =>
  page.evaluate(() => (window as unknown as { printed: number }).printed);
const sheet = (page: Page) => page.locator('#print-sheet');

test('HR prints a profile: the dialog says what stays, the sheet holds confirmed content only', async ({
  page,
}) => {
  await page.goto('/dev/person-print?role=hr&person=x07');
  // A plain browser print shows one line pointing to the entry, not the page.
  await page.emulateMedia({ media: 'print' });
  await expect(sheet(page)).toHaveText(
    '档案请用页面上的「打印档案」打印：打印内容只含已确认的部分，并记入审计日志。',
  );
  await expect(page.getByRole('heading', { name: '孟映雪 演示' })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expect(sheet(page)).toBeHidden();

  await page.getByRole('button', { name: '打印档案' }).click();
  const dialog = page.getByRole('dialog', { name: '打印孟映雪的档案' });
  await expect(dialog.locator('.n-dialog__facts li')).toHaveText([
    '会打印：基本信息、4 件关键事件里 9 条已确认的维度分（附行为锚点、引用、评分人、规则版本和来源位置）、能力象限的正式位置',
    '留在系统里：待采纳的 AI 摘要、系统给的参考位置',
  ]);
  await dialog.getByRole('button', { name: '打印' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => printed(page)).toBe(1);
  await expect(
    page.getByText('已打开打印。只含已确认的内容，已记入审计日志'),
  ).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  await expect(sheet(page)).toBeVisible();
  await expect(page.locator('.nt-head')).toBeHidden();
  await expect(sheet(page).locator('h1')).toHaveText('孟映雪 演示');
  await expect(sheet(page).locator('.n-print__meta dd')).toHaveText([
    '2026-09-04 15:00',
    '苏晚',
    /^截至打印时已确认的内容/,
  ]);
  await expect(sheet(page).locator('section h2')).toHaveText([
    '能力象限 · 正式位置',
    '关键事件与已确认的维度分 4 件 · 9 条',
  ]);
  await expect(sheet(page).getByText('待正式校准')).toBeVisible();
  await expect(
    sheet(page).locator('.n-print__evs > li > .n-print__src'),
  ).toHaveText([
    '来源：XEngineer 第六期观察表 · W7–W8 · 突出表现 · 第 12 行',
    '来源：夏季黑客松评审表（演示） · 第 4 行',
    '来源：XEngineer 第六期观察表 · W4–W5 · 突出表现 · 第 12 行',
    '来源：XEngineer 第六期观察表 · W1–W3 · 待改进 · 第 12 行',
  ]);
  // Nothing reads as a total, a percentage or a ranking; no AI suggestion is listed.
  await expect(sheet(page)).not.toContainText(/总分|%|排名|胜任/);
  await expect(sheet(page).locator('.n-print__evs')).not.toContainText('AI');

  // After printing the sheet goes back to the line.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(sheet(page).locator('.n-print__idle')).toBeVisible();
});

test('a manager prints sources per score where they differ, and the formal position', async ({
  page,
}) => {
  await page.goto('/dev/person-print?role=manager&person=x03');
  await page.getByRole('button', { name: '打印档案' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '打印' }).click();
  await expect.poll(() => printed(page)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(
    sheet(page).getByText('待观察 · 中期校准 · 08-10 冻结 · 苏晚确认'),
  ).toBeVisible();
  const events = sheet(page).locator('.n-print__evs > li');
  await expect(events.nth(1).locator('li .n-print__src')).toHaveText([
    '来源：XEngineer 第六期观察表 · W4–W5 · 突出表现 · 第 8 行',
    '来源：XEngineer 第六期观察表 · W4–W5 · 突出表现 · 第 8 行',
    '来源：XEngineer 第六期观察表 · W4–W5 · 待改进 · 第 8 行',
  ]);
  await expect(events.nth(2).locator('li .n-print__src').last()).toHaveText(
    '全部来源：XEngineer 第六期观察表 · W1–W3 · 突出表现 · 第 8 行；XEngineer 第六期观察表 · W1–W3 · 待改进 · 第 8 行',
  );
  await expect(sheet(page).locator('.n-print__meta dd').nth(1)).toHaveText(
    '程远',
  );
});

test('a refused or unconnected print prints nothing; a mentor has no entry', async ({
  page,
}) => {
  await page.goto('/dev/person-print?role=hr&print=deny');
  await page.getByRole('button', { name: '打印档案' }).click();
  const refusal = page.getByRole('dialog', {
    name: '这份档案已移出你的导出范围',
  });
  await expect(refusal).toContainText('这次尝试已记入审计日志');
  await refusal.getByRole('button', { name: '知道了' }).click();
  await expect(refusal).toBeHidden();

  await page.goto('/dev/person-print?role=hr&print=live');
  await page.getByRole('button', { name: '打印档案' }).click();
  const notice = page.getByRole('dialog', { name: '档案打印待接通' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: '知道了' }).click();
  expect(await printed(page)).toBe(0);

  await page.goto('/dev/person-print?role=mentor');
  await expect(page.getByRole('button', { name: '打印档案' })).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(sheet(page)).toHaveText(
    '档案打印只对管理者和这个人的归属 HR 开放，打印内容只含已确认的部分，并记入审计日志。',
  );
});

test('by keyboard: the dialog opens, keeps a lost print and returns focus on cancel', async ({
  page,
}) => {
  await page.goto('/dev/person-print?role=hr&print=fail');
  const entry = page.getByRole('button', { name: '打印档案' });
  await entry.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '打印孟映雪的档案' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '打印' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert')).toHaveText(
    '打印稿生成失败，可以再点一次「打印」。',
  );
  await dialog.getByRole('button', { name: '取消' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(entry).toBeFocused();
  expect(await printed(page)).toBe(0);
});

test('on the person page, managers and HR get the entry and the print is not connected; the mentor has none', async ({
  page,
  context,
  referenceApp,
}) => {
  for (const role of ['ceo', 'hrbp'] as const) {
    await context.clearCookies();
    await login(context, role, referenceApp.baseURL);
    await page.goto('/person?id=p-x07');
    const entry = page
      .locator('header.nt-head .nt-head__acts')
      .getByRole('button', {
        name: '打印档案',
      });
    await entry.click();
    const notice = page.getByRole('dialog', { name: '档案打印待接通' });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: '知道了' }).click();
    await expect(notice).toBeHidden();
    await expect(entry).toBeFocused();
    expect(await printed(page)).toBe(0);
  }
  await context.clearCookies();
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto('/person?id=p-x07');
  await expect(page.locator('header.nt-head')).toBeVisible();
  await expect(page.locator('.nt-head__acts')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(sheet(page)).toHaveText(
    '档案打印只对管理者和这个人的归属 HR 开放，打印内容只含已确认的部分，并记入审计日志。',
  );
});
