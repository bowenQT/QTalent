import type { Page } from '@playwright/test';
import { test, expect, login } from './fixtures';
import { seedDemand } from './staffing-seed';

/**
 * BOW-853 find-people in a real browser. The real /staffing route runs the demand card on
 * BOW-852 (real sign-ins, Server Actions and the isolated test database); there is no
 * worker or model here, so a drafted demand is written into the database directly.
 * Matching (BOW-854) is not on main: the candidate flow still runs on the development
 * sample /dev/staffing (prototype seed data through the staffing contract).
 */
const card = (page: Page, name: string) =>
  page.locator('#cands > article').filter({
    has: page.getByRole('link', { name, exact: true }),
  });

test('a mentor is stopped at /staffing; HR sends a sentence and its drafting job starts', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto('/staffing?project=pr-ts');
  await expect(
    page.getByRole('heading', { name: '这一页属于其他视角' }),
  ).toBeVisible();
  await expect(
    page.getByText('找 owner 和项目找人只对管理者和 HR 开放。'),
  ).toBeVisible();
  await expect(page).toHaveTitle('这一页属于其他视角 · Niu-Talent');
  await expect(page.locator('#needcard, #cands, #sq')).toHaveCount(0);

  await context.clearCookies();
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/staffing');
  await expect(
    page.getByRole('heading', { name: '选一个项目再找人' }),
  ).toBeVisible();
  await page.goto('/staffing?project=pr-ts');
  await expect(page).toHaveTitle('找人 · Niu-Talent');
  // Entered from a project: the entry names it and offers no general sayings.
  await expect(
    page.getByRole('heading', { name: '为「业务成功部 TS 新人组」找人' }),
  ).toBeVisible();
  await expect(page.locator('.n-ask')).toHaveCount(0);
  await page
    .getByRole('textbox', { name: '描述项目和要找的人' })
    .fill('演示：TS 新人组要一个能带大家对齐节奏的牵头人');
  await page.getByRole('button', { name: '开始' }).click();
  // No worker here: the job stays queued, and the trail says so.
  await expect(page.getByText('理解需求')).toBeVisible();
  await expect(page).toHaveURL(/\/staffing\?project=pr-ts&job=[^&]+$/);
  const { rows } = await referenceApp.pool.query(
    "SELECT input_text, current_revision FROM staffing_demands WHERE project_id = 'pr-ts'",
  );
  expect(rows).toEqual([
    {
      input_text: '演示：TS 新人组要一个能带大家对齐节奏的牵头人',
      current_revision: 0,
    },
  ]);
  // A reload follows the same job; the sentence stays in this tab, not in the address.
  await page.reload();
  await expect(page.getByText('理解需求')).toBeVisible();
  await expect(
    page.locator('.nt-head p', {
      hasText: '演示：TS 新人组要一个能带大家对齐节奏的牵头人',
    }),
  ).toBeVisible();
  expect(decodeURIComponent(page.url())).not.toContain('牵头人');
  // Reading the job is refused after another reload: 「回到输入框」 brings the sentence back.
  await page.route('**/api/jobs/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: '{"status":"forbidden"}',
    }),
  );
  await page.reload();
  await expect(page.locator('.nt-field-error[role="alert"]')).toHaveText(
    '起草结果现在在你的查看范围之外，可以回到输入框再发一次。',
  );
  await page.getByRole('button', { name: '回到输入框' }).click();
  await expect(
    page.getByRole('textbox', { name: '描述项目和要找的人' }),
  ).toHaveValue('演示：TS 新人组要一个能带大家对齐节奏的牵头人');
});

test('on BOW-852 data, HR edits and confirms the demand; matching shows as not connected', async ({
  page,
  context,
  referenceApp,
}) => {
  await seedDemand(referenceApp.pool, [
    {
      id: 'e2e-demand-ts',
      projectId: 'pr-ts',
      revision: 1,
      inputText: '演示：TS 新人组要一个能带大家对齐节奏的牵头人',
      requirements: [
        { id: 'r1', text: '担任过组长或牵头人', priority: 'required' },
        { id: 'r2', text: '懂测试和部署', priority: 'bonus' },
      ],
      status: 'draft',
    },
  ]);
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/staffing?project=pr-ts&demand=e2e-demand-ts');
  await expect(
    page.getByRole('heading', { name: '为「业务成功部 TS 新人组」找人' }),
  ).toBeVisible();
  await expect(
    page.getByText('来自：「演示：TS 新人组要一个能带大家对齐节奏的牵头人」'),
  ).toBeVisible();

  // Only the confirm caption before confirming: nothing is matched yet.
  await expect(
    page.getByText('改了要求，候选人会按新要求重新核对。'),
  ).toHaveCount(0);
  // By keyboard: saving keeps the focus on the toggled requirement.
  await page
    .getByRole('button', { name: '懂测试和部署：加分，切换为必须项' })
    .focus();
  await page.keyboard.press('Enter');
  const toggled = page.getByRole('button', {
    name: '懂测试和部署：必须，切换为加分项',
  });
  await expect(toggled).toBeVisible();
  await expect(toggled).toBeFocused();
  await page.getByRole('textbox', { name: '补一句要求' }).fill('10 月能到岗');
  await page.keyboard.press('Enter');
  await expect(page.locator('#reqs li').last()).toHaveText('必须10 月能到岗');
  await page.getByRole('button', { name: '确认需求' }).focus();
  await page.keyboard.press('Enter');
  // Confirming replaces the button: the focus moves to the confirmed line.
  await expect(page.getByText(/确认 · 按这版要求核对候选人/)).toBeFocused();
  await expect(
    page.getByText('改了要求，候选人会按新要求重新核对。'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '候选人核对待接通' }),
  ).toBeVisible();
  await expect(page.locator('#cands > article')).toHaveCount(0);
  const { rows } = await referenceApp.pool.query(
    "SELECT current_revision FROM staffing_demands WHERE id = 'e2e-demand-ts'",
  );
  expect(rows).toEqual([{ current_revision: 4 }]);

  // The confirmed revision is what a reload, and a manager, read back.
  await page.reload();
  await expect(page.getByText(/确认 · 按这版要求核对候选人/)).toBeVisible();
  await context.clearCookies();
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto('/staffing?project=pr-ts&demand=e2e-demand-ts');
  await expect(page.locator('#reqs li')).toHaveText([
    '必须担任过组长或牵头人',
    '必须懂测试和部署',
    '必须10 月能到岗',
  ]);
  await page.goto('/staffing?project=pr-agent&demand=e2e-demand-ts');
  await expect(
    page.getByRole('heading', { name: '需求链接失效' }),
  ).toBeVisible();
});

test('one sentence becomes a demand card, which is edited and confirmed before matching', async ({
  page,
}) => {
  await page.goto('/dev/staffing?role=manager&scene=new');
  await page.getByRole('button', { name: /^语音硬件端云联调要找一个/ }).click();
  const sentence = page.getByRole('textbox', { name: '描述项目和要找的人' });
  await sentence.focus();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByText('起草需求卡 · 2 步')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '为「语音硬件 · 端云联调」找人' }),
  ).toBeVisible();
  await expect(page.locator('#cands')).toHaveCount(0);

  // Keyboard only: switch the bonus item to required and add a requirement.
  const bonus = page.getByRole('button', {
    name: '写过测试并让 CI 稳定通过：加分，切换为必须项',
  });
  await bonus.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', {
      name: '写过测试并让 CI 稳定通过：必须，切换为加分项',
    }),
  ).toBeVisible();
  await page.getByRole('textbox', { name: '补一句要求' }).fill('能带新人');
  await page.keyboard.press('Enter');
  await expect(page.locator('#reqs li').last()).toHaveText('必须能带新人');

  await page.getByRole('button', { name: '确认需求' }).click();
  await expect(
    page.getByText('程远 09-04 确认 · 按这版要求核对候选人'),
  ).toBeVisible();
  await expect(page.locator('#cands > article')).toHaveCount(4);
});

test('each requirement shows a state or its progress, and every source opens', async ({
  page,
}) => {
  await page.goto('/dev/staffing?role=manager&scene=new');
  await page.getByRole('textbox', { name: '描述项目和要找的人' }).fill('找人');
  await page.getByRole('button', { name: '开始' }).click();
  await page.getByRole('button', { name: '确认需求' }).click();
  // Settled matching: one requirement waits for a person, one failed.
  await expect(page.getByText('待人工判断')).toBeVisible();

  const first = card(page, '许承宇');
  await expect(first.locator('li[data-s="yes"]')).toHaveCount(3);
  const failed = card(page, '方景深').locator('li[data-progress="failed"]');
  await expect(failed).toContainText('失败');
  await expect(failed).toContainText('判断失败，结论留空');
  await expect(failed).not.toHaveAttribute('data-s');
  await expect(page.locator('#cands')).not.toContainText(/总分|胜任率|%/);

  const cites = first.getByRole('button', { name: /^引用 1/ });
  await expect(cites).toHaveCount(3);
  await cites.first().focus();
  await page.keyboard.press('Enter');
  await expect(
    first.getByText('在语音模块经验丰富，负责架构底层的语音接口对接和设计'),
  ).toBeVisible();
});

test('a waiting requirement is judged by hand with a signature', async ({
  page,
}) => {
  await page.goto('/dev/staffing?role=hr&scene=new');
  await page.getByRole('textbox', { name: '描述项目和要找的人' }).fill('找人');
  await page.getByRole('button', { name: '开始' }).click();
  await page.getByRole('button', { name: '确认需求' }).click();

  const person = card(page, '孟映雪');
  await person.getByRole('button', { name: '人工判断' }).click();
  const form = page.getByRole('group', { name: /这条要求要你来判断/ });
  await expect(form).toContainText('孟映雪 · 10 月能到岗');
  const sign = form.getByRole('button', { name: '署名确认' });
  await form.getByRole('button', { name: '支持', exact: true }).click();
  await form.getByRole('textbox').fill('本人已确认 10 月中到岗');
  await expect(sign).toBeDisabled();
  await form.getByRole('checkbox').first().check();
  await sign.click();

  await expect(form).toHaveCount(0);
  const row = person.locator('li[data-req="r3"]');
  await expect(row).toHaveAttribute('data-s', 'yes');
  await expect(row).toContainText('本人已确认 10 月中到岗');
  await expect(row).toContainText('人工结论');
  await expect(row).toContainText('苏晚 · 09-04');
});
