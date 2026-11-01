import { test, expect, login, type DemoRole } from './fixtures';

/**
 * BOW-907 interview import preview. The rows run on the development sample /dev/import
 * (BOW-906 import decisions are not on main); the real /import route is checked for who
 * may open it and for showing the preview read as not connected.
 */
test('confirmed rows stay confirmed after leaving the preview and coming back', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/import`);
  const row = (id: string) => page.locator(`#iv-${id}`);
  await page.getByRole('button', { name: '是孟逸尘' }).click();
  await expect(row('r1')).toHaveAttribute('data-state', 'confirmed');
  await expect(page.locator('.n-ivbar')).toContainText('已确认 1 行');
  await row('r2').getByRole('combobox').selectOption('B');
  await expect(row('r2').locator('.n-ivscale')).toContainText('系统设计 B');

  // Leave through the interviewer review link, then come back.
  await row('r2').getByRole('link', { name: '去核对' }).click();
  await expect(page).toHaveURL(/\/inbox#i-int$/);
  await page.goBack();
  await expect(row('r1')).toHaveAttribute('data-state', 'confirmed');
  await expect(row('r1')).toContainText('已确认是孟逸尘');
  await expect(row('r2').getByRole('combobox')).toHaveValue('B');
  await expect(row('r5')).toHaveAttribute('data-state', 'confirm');

  await page.reload();
  await expect(row('r1')).toHaveAttribute('data-state', 'confirmed');
  await row('r1').getByRole('button', { name: '改回' }).click();
  await expect(row('r1')).toHaveAttribute('data-state', 'confirm');
  await expect(
    page.getByRole('button', { name: '导入已确认的 0 行' }),
  ).toBeDisabled();
});

test('skipped, waiting to be identified and unread rows are told apart and handled', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/import`);
  await expect(page.locator('.n-note')).toHaveText(
    '这份文件 08-20 导入过一次，那次已导入的 1 行这次跳过，其余行照常确认。',
  );

  const unknown = page.locator('#iv-r7');
  await expect(unknown.locator('.n-badge').first()).toHaveText('待认人');
  await unknown.getByRole('button', { name: '放进待核对' }).click();
  await expect(
    page.getByText('已放进待核对，北森同步后再确认是谁'),
  ).toBeVisible();
  await expect(unknown).toHaveAttribute('data-state', 'sent');
  await expect(
    unknown.getByRole('link', { name: '查看待核对' }),
  ).toHaveAttribute('href', '/inbox#i-iv-r7');

  const unread = page.locator('#iv-r2');
  await expect(unread.locator('.is-miss')).toHaveText('系统设计 待补录');
  await expect(
    page.getByRole('figure', { name: '第 3 页「系统设计」一栏的页面图' }),
  ).toBeVisible();

  const skipped = page.locator('details.nt-fold');
  await expect(skipped.locator('li').first()).toBeHidden();
  await skipped.locator('summary').click();
  await expect(skipped.locator('li')).toHaveText([
    /唐语桐.*北森状态：淘汰/,
    /宋知意.*北森状态：已发 offer · 未入职/,
    /谷嘉树.*08-20 已导入过/,
  ]);
  for (const id of ['r3', 'r4', 'r6'])
    await expect(page.locator(`#iv-${id}`)).toHaveCount(0);

  await expect(page.locator('.n-ivscale .is-na').first()).toHaveText(
    '管理能力 · 非管理岗免评',
  );
  await expect(page.locator('.n-ivscale .n-scale__tag').first()).toHaveText(
    '原量表 · 单独保存',
  );
  await expect(page.locator('.n-score')).toHaveCount(0);
  await expect(page.locator('.n-ivbar')).toContainText('导入待接通');
});

for (const [role, heading] of [
  ['hrbp', '面评预览待接通'],
  ['mentor', '面评导入由 HR 处理'],
  ['ceo', '面评导入由 HR 处理'],
  ['admin', '这一页属于业务视角'],
] as [DemoRole, string][])
  test(`${role}: /import shows「${heading}」`, async ({
    page,
    context,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto(`${referenceApp.baseURL}/import?id=imp-1`);
    await expect(page.locator('.n-state__title')).toHaveText(heading);
    await expect(page.locator('.n-ivrow')).toHaveCount(0);
  });
