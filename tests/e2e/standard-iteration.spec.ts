import { test, expect, login } from './fixtures';
import { seedSelectionDraft } from './standard-iteration-seed';

/*
 * BOW-920 on the development sample (contract-shaped data, BOW-918/919/921 not on
 * main): 判断对照 → 归因 → 起草 → 保存并预览影响 → 提交 → 确认发布 / 撤销 / 退回.
 * The real routes are checked to say 待接通 and show no sample data.
 */
const sample = '/dev/standard-iteration';

test('HR drafts a revision from an attribution and the manager publishes, undoes and returns it', async ({
  page,
}) => {
  await page.goto(`${sample}?role=hr&seed=fresh`);
  await expect(
    page.getByRole('heading', { name: 'XEngineer 第六期判断对照' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^综合判断：/ }).click();
  await expect(page.getByTestId('judge-case').first()).toBeVisible();

  await page.getByRole('button', { name: '起草修订' }).click();
  const draft = page.getByRole('dialog', { name: '起草入营选拔标准修订？' });
  await draft.getByRole('button', { name: '起草修订' }).click();
  await expect(page).toHaveURL(/view=standard/);
  await page.getByRole('button', { name: '采用 AI 建议' }).click();
  await page.getByRole('button', { name: '保存并预览影响' }).click();
  await expect(page.locator('#impact')).toContainText('83');
  await page.getByRole('button', { name: '提交管理者确认' }).click();
  await expect(
    page.getByText('已提交 xe-select-v2，待管理者确认'),
  ).toBeVisible();

  await page.goto(`${sample}?role=manager&view=standard`);
  await page.getByRole('button', { name: '确认发布 xe-select-v2' }).click();
  await page
    .getByRole('dialog', { name: '确认发布 xe-select-v2？' })
    .getByRole('button', { name: '确认发布 xe-select-v2' })
    .click();
  await expect(page.locator('#seal')).toBeVisible();
  await page.getByRole('button', { name: '撤销' }).click();
  await expect(page.getByText('已撤销，xe-select-v2 回到待确认')).toBeVisible();
  await expect(page.locator('#seal')).toHaveCount(0);

  await page.getByRole('button', { name: '退回修改' }).click();
  const back = page.getByRole('dialog', { name: '退回 xe-select-v2？' });
  await back.getByLabel('退回理由').fill('刚过线一档也写一句要看到什么');
  await back.getByRole('button', { name: '退回修改' }).click();
  await expect(
    page.getByText('已退回给苏晚修改，理由在苏晚的待办里'),
  ).toBeVisible();

  await page.goto(`${sample}?role=hr&view=standard`);
  await expect(page.getByText(/程远 \d\d-\d\d 退回：/)).toBeVisible();
});

test('a rater sees the locked stage and 样本不足, never a rate or ranking', async ({
  page,
}) => {
  await page.goto(`${sample}?role=rater&rater=ye&seed=fresh`);
  await expect(
    page.getByRole('heading', { name: '我的判断对照' }),
  ).toBeVisible();
  await expect(page.locator('.n-jcase__deny').first()).toContainText('无权限');
  await page.goto(`${sample}?role=rater&rater=gu`);
  await expect(page.getByRole('heading', { name: '样本不足' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/准确率|%/);
});

for (const width of [375, 1366])
  test(`sample pages keep to the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const query of [
      'role=hr&seed=fresh',
      'role=hr&view=standard&seed=returned',
      'role=manager&view=standard&seed=pending',
      'role=rater&rater=ye',
    ]) {
      await page.goto(`${sample}?${query}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        query,
      ).toBe(true);
    }
  });

test('/rules reads the standard from the database; /judge stays 待接通 until its read is connected', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/judge');
  await expect(
    page.getByRole('heading', { name: '判断对照待接通' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('判断对照 · Niu-Talent');
  await page.goto('/rules?r=front&line=xe-select');
  await expect(
    page.getByRole('heading', { name: '还没有生效的入营选拔标准' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/许致远|第六期判断对照/);
  expect((await page.goto('/rules'))?.status()).toBe(404);

  await context.clearCookies();
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto('/rules?r=front&line=xe-select');
  await expect(
    page.getByRole('heading', { name: '还没有生效的入营选拔标准' }),
  ).toBeVisible();

  await context.clearCookies();
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto('/judge?rater=me');
  await expect(
    page.getByRole('heading', { name: '我的判断对照' }),
  ).toBeVisible();
  await page.goto('/rules?r=front&line=xe-select');
  await expect(
    page.getByRole('heading', { name: '人才评价规则由 HR 和管理者维护' }),
  ).toBeVisible();

  await context.clearCookies();
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/judge');
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
});

test('/rules: HR submits the drafted revision; the manager publishes and may undo within five seconds', async ({
  page,
  context,
  referenceApp,
}, testInfo) => {
  await seedSelectionDraft(referenceApp.pool);
  const shot = (name: string) =>
    page.screenshot({ path: testInfo.outputPath(`${name}.png`) });

  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/rules?r=front&line=xe-select');
  await page.getByRole('button', { name: '添加要点' }).click();
  await page.getByLabel('要点名称').fill('个人贡献核验');
  await page
    .getByLabel('要点说明')
    .fill('组队作品里每位成员说明本人做了哪部分');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '保存并预览影响' }).click();
  await expect(page.locator('#impact')).toBeVisible();
  await page.getByRole('button', { name: '提交管理者确认' }).click();
  await expect(
    page.getByText('已提交 xe-select-v2，待管理者确认'),
  ).toBeVisible();

  await context.clearCookies();
  await login(context, 'ceo', referenceApp.baseURL);
  const publish = async () => {
    await page.getByRole('button', { name: '确认发布 xe-select-v2' }).click();
    await page
      .getByRole('dialog', { name: '确认发布 xe-select-v2？' })
      .getByRole('button', { name: '确认发布 xe-select-v2' })
      .click();
    await expect(page.locator('#seal')).toBeVisible();
    await expect(
      page.getByText('已发布 xe-select-v2，之后新建的期次默认用新版'),
    ).toBeVisible();
  };
  for (const width of [375, 1366]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.goto('/rules?r=front&line=xe-select');
    await publish();
    await shot(`undo-open-${width}`);
    await page.getByRole('button', { name: '撤销' }).click();
    await expect(
      page.getByText('已撤销，xe-select-v2 回到待确认'),
    ).toBeVisible();
    await expect(page.locator('#seal')).toHaveCount(0);
    await shot(`undo-done-${width}`);
  }

  // Left alone, the undo closes with the window and the publication stands.
  await publish();
  await expect(page.getByRole('button', { name: '撤销' })).toBeHidden({
    timeout: 10_000,
  });
  await shot('undo-closed-1366');
  await page.goto('/rules?r=front&line=xe-select');
  await expect(page.getByText(/生效中 xe-select-v2/)).toBeVisible();
  await expect(
    page.getByText(/xe-select-v1 已替代，XEngineer 第六期.*保持 xe-select-v1/),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '回到工作台' })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await shot('undo-closed-375');
});
