import { test, expect, login, type DemoRole } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * 待核对. The real route has no cross-batch read yet (BOW-860 / 905 / 906), so it
 * says so; the four kinds are exercised on the development sample, whose
 * in-memory ports follow the BOW-897 contract.
 */
const card = (page: Page, id: string) => page.locator(`article#${id}`);
const toast = (page: Page) => page.locator('.nt-toasts');
const aside = (page: Page, title: string) =>
  page.locator('aside .n-card').filter({
    has: page.getByRole('heading', { name: new RegExp(`^${title}`) }),
  });

test('real route: HR and mentor see the not-connected state, admin is sent away', async ({
  page,
  context,
  referenceApp,
}) => {
  for (const role of ['hrbp', 'mentor'] as const satisfies DemoRole[]) {
    await context.clearCookies();
    await login(context, role, referenceApp.baseURL);
    await page.goto('/inbox');
    await expect(page).toHaveTitle('待核对 · Niu-Talent');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('待核对');
    await expect(page.getByText('待核对待接通')).toBeVisible();
    await expect(page.locator('.n-verify')).toHaveCount(0);
  }
  await context.clearCookies();
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto('/inbox');
  await expect(page).toHaveTitle('这一页属于业务视角 · Niu-Talent');
  await expect(page.getByRole('link', { name: '打开系统管理' })).toBeVisible();
  await expect(page.getByText('待核对待接通')).toHaveCount(0);
});

const kinds: {
  id: string;
  label: string;
  pick: string | RegExp;
  done: string;
  result: string;
  later: string;
}[] = [
  {
    id: 'i-spk',
    label: '说话人',
    pick: '季叙白',
    done: '已归到季叙白',
    result: '季叙白',
    later: '都不是，稍后处理',
  },
  {
    id: 'i-xz',
    label: '未知人员',
    pick: /名单外的人/,
    done: '已记下：名单外的人，只留在原件里',
    result: '名单外的人，只留在原件里',
    later: '都不是，稍后处理',
  },
  {
    id: 'i-region',
    label: '图片范围',
    pick: /整张只作附件/,
    done: '这张图只作附件保存',
    result: '整张只作附件',
    later: '稍后处理',
  },
  {
    id: 'i-int',
    label: '面试官',
    pick: /许致远/,
    done: '已关联到许致远，面评那一行可以导入了',
    result: '关联到许致远',
    later: '稍后处理',
  },
];

async function choose(item: Locator, name: string | RegExp) {
  await item
    .getByRole('button', { name, exact: typeof name === 'string' })
    .click();
}

test('sample, HR: each kind is resolved, undone from the toast and from「已核对」', async ({
  page,
}) => {
  await page.goto('/dev/inbox?role=hr');
  await expect(page.locator('.n-verify')).toHaveCount(5);
  for (const kind of kinds) {
    const item = card(page, kind.id);
    await expect(item).toContainText(`待核对 · ${kind.label}`);
    await choose(item, kind.pick);
    await expect(toast(page)).toContainText(kind.done);
    await expect(item).toHaveCount(0);
    await expect(aside(page, '已核对')).toContainText(kind.result);
    await toast(page)
      .locator('.n-toast', { hasText: kind.done })
      .getByRole('button', { name: '撤销' })
      .click();
    await expect(toast(page)).toContainText('已撤销，回到待核对');
    await expect(item).toBeVisible();
    await expect(aside(page, '已核对')).toHaveCount(0);
    // Again, this time undone from the side list.
    await choose(item, kind.pick);
    await expect(item).toHaveCount(0);
    await aside(page, '已核对').getByRole('button', { name: '撤销' }).click();
    await expect(item).toBeVisible();
  }
  await expect(page.locator('.n-verify')).toHaveCount(5);
});

test('sample, HR: each kind is put aside, brought back and resolved', async ({
  page,
}) => {
  await page.goto('/dev/inbox?role=hr');
  for (const kind of kinds) {
    const item = card(page, kind.id);
    await choose(item, kind.later);
    await expect(toast(page)).toContainText('已放到稍后处理，待办里仍会保留');
    await expect(item).toHaveCount(0);
    await expect(aside(page, '稍后处理')).toContainText(kind.label);
  }
  // The fifth item (阿泽) is still open; put it aside too.
  await choose(card(page, 'i-aze'), '都不是，稍后处理');
  await expect(
    page.getByRole('heading', { name: '现在没有要核对的' }),
  ).toBeVisible();
  await expect(aside(page, '稍后处理').getByRole('listitem')).toHaveCount(5);
  for (const kind of kinds) {
    await aside(page, '稍后处理')
      .getByRole('listitem')
      .filter({ hasText: kind.label })
      .first()
      .getByRole('button', { name: '继续核对' })
      .click();
    const item = card(page, kind.id);
    await expect(item).toBeVisible();
    await choose(item, kind.pick);
    await expect(item).toHaveCount(0);
    await expect(aside(page, '已核对')).toContainText(kind.result);
  }
  await expect(aside(page, '稍后处理').getByRole('listitem')).toHaveCount(1);
});

test('sample, mentor: own items only, reachable by keyboard', async ({
  page,
}) => {
  await page.goto('/dev/inbox?role=mentor');
  await expect(page.locator('.n-verify')).toHaveCount(2);
  await expect(card(page, 'i-int')).toHaveCount(0);
  await expect(card(page, 'i-region')).toHaveCount(0);
  const first = card(page, 'i-spk').getByRole('button', { name: '季叙白' });
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast(page)).toContainText('已归到季叙白');
  await expect(card(page, 'i-spk')).toHaveCount(0);
  const next = card(page, 'i-xz').getByRole('button', { name: /周初晴/ });
  await next.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: '都核对完了' })).toBeVisible();
  await expect(aside(page, '已核对').getByRole('listitem')).toHaveCount(2);
});
