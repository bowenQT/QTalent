import type { Page } from '@playwright/test';
import { test, expect, login } from './fixtures';

/**
 * BOW-853 find-people in a real browser. The flow runs on the development sample
 * /dev/staffing (prototype seed data through the staffing contract) until the demand
 * read (BOW-852) and matching read (BOW-854) are on main; who may open the page is
 * checked on the real /staffing route with real sign-ins.
 */
const card = (page: Page, name: string) =>
  page.locator('#cands > article').filter({
    has: page.getByRole('link', { name, exact: true }),
  });

test('a mentor is stopped at /staffing; managers and HR get the page', async ({
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
  await expect(page.locator('#needcard, #cands')).toHaveCount(0);

  await context.clearCookies();
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/staffing?project=pr-ts');
  await expect(page.getByRole('heading', { name: '找人待接通' })).toBeVisible();
  await expect(page).toHaveTitle('找人 · Niu-Talent');
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
