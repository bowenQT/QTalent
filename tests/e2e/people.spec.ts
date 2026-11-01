import { test, expect, login, type DemoRole } from './fixtures';
import { startPrototypeServer } from '../visual/prototype-server';

/**
 * BOW-839 人才列表与速览，读 837 的真实列表。人和顺序逐个对原型：团队按拼音，
 * 组内按姓名拼音，不按任何分数或位置。
 */
for (const role of ['ceo', 'hrbp', 'mentor'] satisfies DemoRole[])
  test(`${role}: the same people, teams and facts as the prototype, in its order`, async ({
    page,
    context,
    browser,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto('/people');
    const heading = role === 'mentor' ? '所带学员' : '人才';
    await expect(page).toHaveTitle(`${heading} · Niu-Talent`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    const server = await startPrototypeServer();
    const prototypeContext = await browser.newContext();
    try {
      const prototype = await prototypeContext.newPage();
      await prototype.goto(
        `${server.url}/prototype/y/app/people.html?as=${role}`,
      );
      await expect(prototype.locator('#pp-list .n-person-row')).not.toHaveCount(
        0,
      );
      const texts = (page: typeof prototype, selector: string) =>
        page.locator(selector).allTextContents();
      expect(await texts(page, '#plist .n-person__name')).toEqual(
        await texts(prototype, '#pp-list .n-person__name'),
      );
      // Job title, level and the team's parent path have no columns yet (BOW-834
      // S1 / S2): compare the facts the read does carry, and the group sizes.
      // Project counts only include projects the caller may read (837): a mentor
      // can see fewer than the prototype, which counts them all.
      const carried = (metas: string[]) =>
        metas.map((meta) =>
          meta
            .split(' · ')
            .filter((part) =>
              role === 'mentor' ? /期$/.test(part) : /项目|期$/.test(part),
            ),
        );
      expect(carried(await texts(page, '#plist .n-person__meta'))).toEqual(
        carried(await texts(prototype, '#pp-list .n-person__meta')),
      );
      const sizes = (heads: string[]) =>
        heads.map((head) => head.split(' · ').at(-1));
      expect(sizes(await texts(page, '#plist .nt-team'))).toEqual(
        sizes(await texts(prototype, '#pp-list .nt-h2')),
      );
      expect(await texts(page, '.nt-head p')).toEqual(
        await texts(prototype, '.nt-head p'),
      );
      // 「可能需要重新校准」 has no field in the list read yet (route map, BOW-839).
      expect(await texts(page, '.nt-filter .n-chip')).toEqual(
        (await texts(prototype, '#pp-list .n-chip')).filter(
          (chip) => chip !== '可能需要重新校准',
        ),
      );
    } finally {
      await prototypeContext.close();
      await server.close();
    }
  });

test('filters by text, team and chip, and says so when nothing is left', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto('/people');
  const rows = page.locator('#plist .n-person-row');
  const all = await rows.count();
  const first = (await rows.first().locator('.n-person__name').textContent())!
    .replace('演示', '')
    .trim();
  await page.getByLabel('按姓名或岗位筛选').fill(first);
  await expect(rows.first()).toContainText(first);
  expect(await rows.count()).toBeLessThan(all);
  await page.getByLabel('按姓名或岗位筛选').fill('不存在的人');
  await expect(page.getByText('换个筛选条件试试。')).toBeVisible();
  await page.getByLabel('按姓名或岗位筛选').fill('');
  await expect(rows).toHaveCount(all);
  const team = page.getByLabel('团队');
  const option = await team.locator('option').nth(1).getAttribute('value');
  await team.selectOption(option!);
  await expect(page.locator('#plist .nt-team')).toHaveCount(1);
  await team.selectOption('all');
  await page.getByRole('button', { name: '资料不足', exact: true }).click();
  for (const row of await rows.all())
    await expect(row.getByText('资料不足')).toBeVisible();
});

test('the quick view opens from the keyboard and gives focus back to the row', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto('/people');
  const row = page.locator('#plist .n-person-row').nth(1);
  const name = (await row.locator('.n-person__name').textContent())!
    .replace('演示', '')
    .trim();
  await row.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name });
  await expect(drawer).toBeVisible();
  await expect(drawer).toBeFocused();
  await expect(page).toHaveURL(/\/people$/);
  await expect(drawer.getByRole('heading', { name: '关键事实' })).toBeVisible();
  await expect(drawer.getByRole('link', { name: '打开档案' })).toHaveAttribute(
    'href',
    /\/person\?id=/,
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(row).toBeFocused();
});

test('admin sees the business-view notice and no names', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/people');
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
  await expect(page).toHaveTitle('这一页属于业务视角 · Niu-Talent');
  await expect(page.locator('.n-person-row')).toHaveCount(0);
});
