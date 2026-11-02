import { test, expect, login } from './fixtures';
import {
  seededHypothesis,
  seedSelectionDraft,
  seedStandardIteration,
} from './standard-iteration-seed';

/*
 * BOW-920: 判断对照 → 归因 → 起草 → 保存并预览影响 → 提交 → 确认发布 / 撤销 / 退回,
 * first on the development sample, then on the real routes over the --init batch.
 */
const sample = '/dev/standard-iteration';
const batchName = '第六期选拔与结营对照（演示）';

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

test('the third act runs on the real routes: compare, attribute, draft, publish and undo', async ({
  page,
  context,
  referenceApp,
}) => {
  await seedStandardIteration(referenceApp.pool);

  await test.step('HR attributes the stored batch and drafts a revision', async () => {
    await login(context, 'hrbp', referenceApp.baseURL);
    await page.goto('/judge');
    await expect(
      page.getByRole('heading', { level: 1, name: batchName }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /^许致远/ })).toBeVisible();
    await expect(page.getByText(seededHypothesis)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/准确率|%/);
    await page.getByRole('button', { name: '采纳并归因' }).click();
    await page
      .getByLabel('理由（必填，会署名留档）')
      .fill('演示：作品评审只看结果，没要求说明本人负责的部分');
    await page.getByRole('button', { name: '确认归因' }).click();
    await page.getByRole('button', { name: '起草修订' }).click();
    const draft = page.getByRole('dialog', { name: '起草入营选拔标准修订？' });
    await draft.getByLabel('修订理由').fill('演示：补一条个人贡献核验');
    await draft.getByRole('button', { name: '起草修订' }).click();
    await expect(page).toHaveURL(/\/rules\?.*draft=/, { timeout: 30_000 });

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
    expect((await page.goto('/rules'))?.status()).toBe(404);
  });

  await test.step('the manager publishes and undoes it, and sees no names or cases', async () => {
    await context.clearCookies();
    await login(context, 'ceo', referenceApp.baseURL);
    await page.goto('/judge');
    await expect(page.getByText(batchName).first()).toBeVisible();
    await expect(page.getByTestId('judge-case')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(
      /许致远|叶青|苏少卿|准确率|%/,
    );

    await page.goto('/rules?r=front&line=xe-select');
    await page.getByRole('button', { name: '确认发布 xe-select-v2' }).click();
    await page
      .getByRole('dialog', { name: '确认发布 xe-select-v2？' })
      .getByRole('button', { name: '确认发布 xe-select-v2' })
      .click();
    await expect(page.locator('#seal')).toBeVisible();
    await page.getByRole('button', { name: '撤销' }).click();
    await expect(
      page.getByText('已撤销，xe-select-v2 回到待确认'),
    ).toBeVisible();
  });

  await test.step('a mentor reads only their own judgments, with no rate', async () => {
    await context.clearCookies();
    await login(context, 'mentor', referenceApp.baseURL);
    await page.goto('/judge?rater=me');
    await expect(
      page.getByRole('heading', { level: 1, name: '我的判断对照' }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/准确率|%/);
    await page.goto('/rules?r=front&line=xe-select');
    await expect(
      page.getByRole('heading', { name: '人才评价规则由 HR 和管理者维护' }),
    ).toBeVisible();
  });

  await test.step('an admin keeps to the business-view notice', async () => {
    await context.clearCookies();
    await login(context, 'admin', referenceApp.baseURL);
    await page.goto('/judge');
    await expect(
      page.getByRole('heading', { name: '这一页属于业务视角' }),
    ).toBeVisible();
  });
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
