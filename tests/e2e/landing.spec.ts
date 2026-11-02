import type { Page } from '@playwright/test';
import { test, expect, demoPassword, type DemoRole } from './fixtures';

/**
 * BOW-874: every preset account lands on the workbench after signing in through the
 * login form; `/` and the not-found page lead there too. One test, so the four
 * accounts share one isolated app and database.
 */
async function signIn(page: Page, role: DemoRole) {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(`${role}@qtalent.test`);
  await page.getByLabel('密码').fill(demoPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  // The first visit compiles /work in dev.
  await expect(page).toHaveURL(/\/work$/, { timeout: 30_000 });
}

test('preset accounts sign in to the workbench, and / and 404 lead back to it', async ({
  context,
  page,
}) => {
  await signIn(page, 'ceo');
  const nav = page.getByRole('complementary', { name: '主导航' });
  await expect(nav.getByRole('link', { name: '工作台' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('region', { name: '找人' })).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/work$/);

  await context.clearCookies();
  await signIn(page, 'hrbp');
  await expect(
    page.getByRole('textbox', { name: '描述你要做的事' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: '找人' })).toHaveCount(0);

  await context.clearCookies();
  await signIn(page, 'mentor');
  await expect(page.locator('#students h3')).toHaveText(/^我带的学员\d+ 人$/);
  const missing = await page.goto('/no-such-page');
  expect(missing?.status()).toBe(404);
  await expect(page.getByText('页面链接失效')).toBeVisible();
  await page.getByRole('link', { name: '回到工作台' }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.locator('#students')).toBeVisible();

  await context.clearCookies();
  await signIn(page, 'admin');
  await expect(page.getByText('这一页属于业务视角').first()).toBeVisible();
});
