import { test, expect, login } from './fixtures';

/**
 * BOW-861 回执页。批次读取还没接通，真实路由只说明「待接入」；
 * 整页的三种状态在开发样张上走，读的是按 897 契约校验过的演示回执。
 */
for (const role of ['ceo', 'hrbp', 'mentor'] as const)
  test(`${role}: the receipt route says the batch read is not connected yet`, async ({
    page,
    context,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto('/receipt?batch=demo-batch');
    await expect(page).toHaveTitle('回执 · Niu-Talent');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('回执');
    await expect(page.getByText('待接入', { exact: true })).toBeVisible();
    await expect(page.locator('.n-rsum, .n-file, .n-rcpt')).toHaveCount(0);
  });

test('a receipt link without a batch is a broken link with a way back', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/receipt');
  await expect(page.getByText('回执链接失效')).toBeVisible();
  await page.getByRole('link', { name: '回到工作台' }).click();
  await expect(page).toHaveURL(/\/work$/);
});

test('admin sees the business-view notice and nothing of the batch', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/receipt?batch=demo-batch');
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
  await expect(page.getByText('待接入', { exact: true })).toHaveCount(0);
});

for (const [state, label] of [
  ['processing', '处理中'],
  ['review', '待核对'],
  ['done', '已完成'],
] as const)
  for (const width of [1280, 375])
    test(`sample ${state} at ${width}px: state, counts and no sideways scroll`, async ({
      page,
      referenceApp,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(
        `${referenceApp.baseURL}/dev/design-system/receipt?state=${state}`,
      );
      await expect(page.locator('.n-rstate')).toHaveText(label);
      await expect(
        page.getByRole('list', { name: '这次读到了什么' }).locator('> li'),
      ).toHaveCount(5);
      if (state === 'processing')
        await expect(page.getByText('读完后统计')).toHaveCount(3);
      if (state === 'review') {
        await expect(page.locator('.n-rcpt')).toHaveCount(3);
        await expect(page.locator('.n-rcpt[data-state="held"]')).toHaveCount(2);
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
