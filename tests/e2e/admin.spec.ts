import { test, expect, login } from './fixtures';

/*
 * BOW-916: the system administrator's landing loop (business-view notice → 打开系统管理
 * → /admin, brand link → /admin) and 接入状态, whose reads are not connected yet.
 * The populated states run on the development sample.
 */
test('the administrator reaches 系统管理 from the business-view notice and the brand link', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/projects');
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
  await expect(page.locator('a.nt-brand')).toHaveAttribute('href', '/admin');
  await page.getByRole('link', { name: '打开系统管理' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page).toHaveTitle('系统管理 · Niu-Talent');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '接入状态' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText('待接通', { exact: true })).toHaveCount(6);
  await expect(page.locator('body')).not.toContainText(/0 次|0 条|都已处理/);
  await page.getByRole('tab', { name: '审计日志' }).click();
  await expect(
    page.getByRole('heading', { name: '审计日志待接通' }),
  ).toBeVisible();
});

test('business accounts are refused 系统管理', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/admin');
  await expect(
    page.getByRole('heading', { name: '这一页只给系统管理员' }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: '接入状态' })).toHaveCount(0);
});

test('sample: a failed task is re-queued, and 375px keeps to the viewport', async ({
  page,
}) => {
  await page.goto('/dev/admin-connections?wecom=down');
  await expect(page.getByText('已断开')).toBeVisible();
  await page.getByRole('button', { name: '重试' }).first().click();
  await expect(
    page.getByText('已重新排队，处理结果会更新在这里'),
  ).toBeVisible();
  await expect(page.getByText('2 个待处理 · 1 个已重新排队')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  for (const query of ['', '?pending=1', '?empty=1&wecom=never']) {
    await page.goto(`/dev/admin-connections${query}`);
    await expect(page.locator('h1')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      query,
    ).toBe(true);
  }
});
