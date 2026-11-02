import { test, expect, login } from './fixtures';

/*
 * The manager home from the real entry (版本 Y DY-04): 找人, then 值得关注的人 on the
 * left and 值得关注的项目, 我的关注 on the right. Their reads are not on main, so each
 * card says 待接通 with no count, and 判断提醒 is not drawn.
 */
test('manager lands on the workbench with the DY-04 blocks in place', async ({
  context,
  page,
  referenceApp,
}) => {
  test.setTimeout(120_000);
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto('/work');
  await expect(page.getByRole('region', { name: '找人' })).toBeVisible({
    timeout: 30_000,
  });
  const columns = page.locator('.nt-ceo');
  await expect(columns.locator('h3.n-section-title')).toHaveText([
    '值得关注的人',
    '值得关注的项目',
    '我的关注',
  ]);
  for (const title of ['值得关注的人', '值得关注的项目', '我的关注'])
    await expect(columns.getByText(`${title}待接通`)).toBeVisible();
  await expect(columns.locator('.n-count')).toHaveCount(0);
  await expect(page.locator('#jsig')).toHaveCount(0);
  await expect(page.getByText('需要我看')).toHaveCount(0);
});
