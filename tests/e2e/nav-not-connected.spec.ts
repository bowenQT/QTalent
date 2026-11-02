import type { Page } from '@playwright/test';
import { test, expect, login } from './fixtures';

// Each entry compiles its route on first visit in dev.
test.describe.configure({ timeout: 240_000 });

/*
 * Every sidebar entry reached from the workbench opens a page: entries whose reads
 * are not connected say 待接通, and the bare rules entry opens the selection standard.
 */
async function openFromSidebar(page: Page, name: string, title: string) {
  await page.goto('/work');
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('link', { name, exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: `${title}待接通` }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('页面链接失效')).toHaveCount(0);
}

test('manager sidebar entries open pages instead of the 404', async ({
  context,
  page,
  referenceApp,
}) => {
  await login(context, 'ceo', referenceApp.baseURL);
  await openFromSidebar(page, '盘点', '盘点');
  await openFromSidebar(page, '人才项目', '关键节点复盘');
  await expect(page).toHaveURL(/\/program-actions$/);
  await openFromSidebar(page, '评审导览', '评审导览');
  await openFromSidebar(page, '手机版', '手机版');

  await page.goto('/work');
  await page
    .getByRole('complementary', { name: '主导航' })
    .getByRole('link', { name: '人才评价规则' })
    .click();
  await expect(page).toHaveURL(/\/rules\?r=front&line=xe-select$/);
  await expect(
    page.getByRole('heading', { name: 'XEngineer 入营选拔标准', level: 1 }),
  ).toBeVisible();

  const node = await page.goto('/program-actions?node=pg-def:n0');
  expect(node?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: '关键节点复盘待接通' }),
  ).toBeVisible();
});

test('HR sidebar entries open pages instead of the 404', async ({
  context,
  page,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await openFromSidebar(page, '人才项目', '人才项目');
  await expect(page).toHaveURL(/\/programs$/);
  await openFromSidebar(page, '评分复核', '评分复核');
  await openFromSidebar(page, '标签库', '标签库');
});
