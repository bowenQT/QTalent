import { test, expect, login, type DemoRole, demoPassword } from './fixtures';
import { startPrototypeServer } from '../visual/prototype-server';
for (const [role, count] of [
  ['ceo', 22],
  ['hrbp', 22],
  ['mentor', 19],
] as const) {
  test(`${role}: exact prototype project scope and supported filters`, async ({
    page,
    context,
    browser,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto('/projects');
    await expect(page.locator('.n-project')).toHaveCount(count);
    const server = await startPrototypeServer();
    const prototypeContext = await browser.newContext();
    try {
      const prototype = await prototypeContext.newPage();
      await prototype.goto(
        `${server.url}/prototype/y/app/projects.html?as=${role}`,
      );
      await expect(prototype.locator('.n-project')).toHaveCount(count);
      expect(await page.locator('.n-project__name').allTextContents()).toEqual(
        await prototype.locator('.n-project__name').allTextContents(),
      );
      await page.getByRole('button', { name: '已归档', exact: true }).click();
      await prototype
        .getByRole('button', { name: '已归档', exact: true })
        .click();
      expect(await page.locator('.n-project__name').allTextContents()).toEqual(
        await prototype.locator('.n-project__name').allTextContents(),
      );
    } finally {
      await prototypeContext.close();
      await server.close();
    }
    if (role === 'mentor')
      await expect(page.getByRole('button', { name: '新建项目' })).toHaveCount(
        0,
      );
  });
}
test('admin is denied before any project name or title is returned', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/projects');
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
  await expect(page.locator('.n-project')).toHaveCount(0);
  await expect(page).toHaveTitle('这一页属于业务视角 · Niu-Talent');
  await expect(page.getByRole('button', { name: '新建项目' })).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: '系统管理', exact: true }),
  ).toBeVisible();
  expect(await page.content()).not.toContain('口语搭子');
});
test('login, accessible creation, request replay and account logout', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('邮箱').fill('ceo@qtalent.test');
  await page.getByLabel('密码').fill(demoPassword);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByLabel('项目名称')).toBeFocused();
  await page.getByLabel('项目名称').fill('浏览器隔离测试项目');
  await page.getByRole('checkbox').first().check();
  const actionRequest = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && Boolean(request.headers()['next-action']),
  );
  await page.getByRole('button', { name: '创建', exact: true }).click();
  const request = await actionRequest;
  await expect(page.getByRole('status')).toContainText('项目已创建');
  await expect(
    page.getByRole('link', { name: '浏览器隔离测试项目', exact: true }),
  ).toHaveCount(1);
  const headers = request.headers();
  delete headers['content-length'];
  delete headers.host;
  const response = await page.request.post(request.url(), {
    headers,
    data: request.postDataBuffer()!,
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole('link', { name: '浏览器隔离测试项目', exact: true }),
  ).toHaveCount(1);
  const detail = await page
    .getByRole('link', { name: '浏览器隔离测试项目', exact: true })
    .getAttribute('href');
  const missing = await page.request.get(detail!);
  expect(missing.status()).toBe(404);
  await page.getByRole('button', { name: /账号：/ }).click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login$/);
});
test('keyboard focus stays in creation dialog and returns to its trigger', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp' satisfies DemoRole, referenceApp.baseURL);
  await page.goto('/projects');
  const trigger = page.getByRole('button', { name: '新建项目' });
  await trigger.click();
  await expect(page.getByLabel('项目名称')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    page.getByRole('button', { name: '创建', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

for (const reason of ['revoked', 'expired'] as const) {
  test(`last business grant ${reason}: safe denial and working sign-out`, async ({
    page,
    context,
    referenceApp,
  }) => {
    await login(context, 'hrbp', referenceApp.baseURL);
    await page.goto('/projects');
    await expect(page.locator('.n-project')).toHaveCount(22);
    await referenceApp.pool.query(
      reason === 'revoked'
        ? 'UPDATE directory_grants SET revoked_at = $1 WHERE account_id = $2'
        : 'UPDATE directory_grants SET valid_to = $1 WHERE account_id = $2',
      ['2026-09-04', 'demo-hrbp'],
    );
    await page.reload();
    await expect(
      page.getByRole('heading', { name: '查看权限已更新' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('查看权限已更新 · Niu-Talent');
    await expect(page.locator('.n-project')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '新建项目', exact: true }),
    ).toHaveCount(0);
    expect(await page.content()).not.toContain('口语搭子');
    await page.getByRole('button', { name: '退出并切换账号' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/projects');
    await expect(page).toHaveURL(/\/login$/);
  });
}
