import { test, expect, login, type DemoRole } from './fixtures';

/**
 * BOW-847 回执页的逐件确认。逐件确认、改分和撤销跑在开发样张 /dev/receipt 上；真实路由
 * /receipt 按 897 的批次读取在服务端判断能不能看。next dev 不跑整理 worker，真实批次停在
 * 处理中，所以真实路由只走到读出这份回执为止。
 */
test('mentor: confirm one event, undo within five seconds, then change a score with a reason', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/receipt?role=mentor`);
  const first = page.locator('#rc-e-d1');
  await expect(page.locator('#rc-h')).toHaveText('等你确认3');
  await expect(page.getByRole('button', { name: /全部确认/ })).toHaveCount(0);

  await first.getByRole('button', { name: '确认这件事' }).click();
  await expect(
    page.getByText('已确认沈亦初的这件事，已进入档案'),
  ).toBeVisible();
  await expect(first).toHaveAttribute('data-state', 'confirmed');
  await expect(first.locator('.n-block__sig')).toHaveText('叶青');
  await expect(page.locator('#rc-h')).toHaveText('等你确认2');
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('已撤销，回到待确认')).toBeVisible();
  await expect(first).toHaveAttribute('data-state', 'ai');
  await expect(page.locator('#rc-h')).toHaveText('等你确认3');

  const second = page.locator('#rc-e-d2');
  await second.getByRole('button', { name: '改分' }).click();
  await second.getByLabel('坚毅力的分数').selectOption('4');
  await second.getByRole('button', { name: '保存并确认' }).click();
  await expect(second.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    '改了分，写一句理由',
  );
  await second.getByRole('textbox').fill('补救计划落实到每天的回归');
  await second.getByRole('button', { name: '保存并确认' }).click();
  await expect(
    page.getByText('已确认方景深的这件事（已改分），已进入档案'),
  ).toBeVisible();
  await expect(second).toHaveAttribute('data-state', 'confirmed');
  await expect(second.getByText('AI 原为 3')).toBeVisible();
});

test('the undo offer ends with the five-second window', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/receipt?role=mentor`);
  await page
    .locator('#rc-e-d3')
    .getByRole('button', { name: '确认这件事' })
    .click();
  await expect(page.getByRole('button', { name: '撤销' })).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(0, {
    timeout: 8_000,
  });
  await expect(page.locator('#rc-e-d3')).toHaveAttribute(
    'data-state',
    'confirmed',
  );
});

test('a save conflict stays on the card until the latest version is loaded', async ({
  page,
  referenceApp,
}) => {
  await page.goto(
    `${referenceApp.baseURL}/dev/receipt?role=mentor&scene=conflict`,
  );
  const first = page.locator('#rc-e-d1');
  await first.getByRole('button', { name: '确认这件事' }).click();
  await expect(first.getByRole('alert')).toContainText('这件事刚有新的版本');
  await first.getByRole('button', { name: '载入最新版本' }).click();
  await expect(first.getByRole('alert')).toHaveCount(0);
  await first.getByRole('button', { name: '确认这件事' }).click();
  await expect(first).toHaveAttribute('data-state', 'confirmed');
});

test('files still processing update the receipt when they are read', async ({
  page,
  referenceApp,
}) => {
  await page.goto(
    `${referenceApp.baseURL}/dev/receipt?role=mentor&scene=processing`,
  );
  await expect(page.locator('.n-rstate')).toHaveText('处理中');
  await expect(page.getByText('待换文件')).toBeVisible();
  await expect(page.locator('.n-rstate')).toHaveText('待核对', {
    timeout: 15_000,
  });
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('hr sees whose confirmation each event waits for and cannot confirm it', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/receipt?role=hr`);
  await expect(page.locator('#rc-h')).toHaveText('等叶青确认');
  await expect(page.getByRole('button', { name: '确认这件事' })).toHaveCount(0);
});

test('the receipt is usable at phone width', async ({ page, referenceApp }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${referenceApp.baseURL}/dev/receipt?role=mentor`);
  const first = page.locator('#rc-e-d1');
  await first.getByRole('button', { name: '改分' }).click();
  await first.getByLabel('专业度的分数').selectOption('3');
  await first.getByRole('textbox').fill('压测数据是组里一起做的');
  await first.getByRole('button', { name: '保存并确认' }).click();
  await expect(first).toHaveAttribute('data-state', 'confirmed');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

for (const [role, heading] of [
  ['hrbp', '回执链接失效'],
  ['mentor', '回执链接失效'],
  ['ceo', '回执链接失效'],
  ['admin', '这一页属于业务视角'],
] as [DemoRole, string][])
  test(`${role}: /receipt for a batch that does not exist shows「${heading}」`, async ({
    page,
    context,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto(`${referenceApp.baseURL}/receipt?id=d-ms2`);
    await expect(page.locator('.n-state__title')).toHaveText(heading);
    await expect(page.locator('.n-rcpt')).toHaveCount(0);
  });

test('mentor: a batch handed in on /record opens on the real receipt route, for the submitter only', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto(`${referenceApp.baseURL}/record`);
  await page
    .getByRole('combobox', { name: '记录给谁' })
    .selectOption({ index: 1 });
  await page
    .getByRole('textbox', { name: '说说这次发生了什么' })
    .fill('演示：今天主动同步了进度。');
  await page.getByRole('button', { name: '整理成关键事件' }).click();
  await expect(page).toHaveURL(/batch=/);
  const batch = new URL(page.url()).searchParams.get('batch')!;

  await page.goto(`${referenceApp.baseURL}/receipt?id=${batch}`);
  await expect(page.locator('.n-rstate')).toContainText('处理中');
  await expect(page.locator('h1')).not.toHaveText('回执');
  await expect(page.getByText('统一投递', { exact: false })).toBeVisible();
  // 企业微信回执还没接通：不写「回执也会发到」
  await expect(page.getByText('回执也会发到')).toHaveCount(0);
  await expect(page.locator('.n-state__title')).toHaveCount(0);

  // Another business account does not see this batch.
  await context.clearCookies();
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto(`${referenceApp.baseURL}/receipt?id=${batch}`);
  await expect(page.locator('.n-state__title')).toHaveText(
    /回执链接失效|这份回执不在你的查看范围里/,
  );
  await expect(page.locator('.n-rcpt')).toHaveCount(0);
});
