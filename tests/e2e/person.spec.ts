import type { Page } from '@playwright/test';
import { test, expect, login } from './fixtures';
import { startPrototypeServer } from '../visual/prototype-server';

// 样本：导师所带、三种视角都可见的演示学员；范围外样本取导师不带、HR 范围内的另一人。
const SAMPLE = 'p-x07';
const OUTSIDE_MENTOR = 'p-x01';
const MENTOR_FORBIDDEN = [
  'referencePosition',
  'managementObservations',
  'calibrationHistory',
  'versionsAndChanges',
  'management-observation',
  '"performance"',
  'quadrant',
  '能力象限',
  '参考位置',
  '双高',
  '高潜待练',
  '专业骨干',
  '待观察',
  '导师视角已隐藏',
  // 结营评审只给与结营节点有当前评价关系的人；导师所带的学员也一样（#284）。
  '结营评审',
  '导师留用建议',
  '结营结论',
  // 节点结论、北森面评属于管理者与 HR 变体，导师这里连「待接入」也没有。
  '待接入',
  '节点结论',
  '北森面评',
];
// 管理者与 HR 变体里，读取还没接通的三类记录（BOW-906、902、904）。
const PENDING = ['北森面评 · 待接入', '节点结论 · 待接入', '管理观察 · 待接入'];

async function expectPending(page: Page) {
  await expect(
    page.getByRole('list', { name: '待接入的记录' }).getByRole('listitem'),
  ).toHaveText(PENDING);
}

async function prototypeName(id: string) {
  const server = await startPrototypeServer();
  try {
    const response = await fetch(
      `${server.url}/prototype/y/app/js/data-xe6.js`,
    );
    const text = await response.text();
    const match = new RegExp(`"id": *"${id}", *"name": *"([^"]+)"`).exec(text);
    return match?.[1] ?? null;
  } finally {
    await server.close();
  }
}

async function openFirstCite(page: Page) {
  const mark = page.locator('#facts .n-cite__mark').first();
  const action = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && Boolean(request.headers()['next-action']),
  );
  await mark.hover();
  return { mark, request: await action };
}

test('manager: profile blocks, citations, timeline and source read refusals', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'ceo', referenceApp.baseURL);
  await page.goto(`/person?id=${SAMPLE}`);
  const name = await page.getByRole('heading', { level: 1 }).textContent();
  expect(name).toBeTruthy();
  await expect(page).toHaveTitle(/ · Niu-Talent$/);
  await expect(page.locator('#facts li')).not.toHaveCount(0);
  await expect(page.getByText('能力象限', { exact: true })).toBeVisible();
  await expect(page.locator('.n-miniquad')).toHaveCount(1);
  await expect(page.locator('#spectrum')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/总分|排名|%/);
  await expectPending(page);

  // 悬停展开原文：读到的摘录出现在浮层里；演示基线来源带说明与「演示」。
  const { mark, request } = await openFirstCite(page);
  const pop = mark.locator('xpath=ancestor::span[contains(@class,"n-cite")]');
  await expect(pop.locator('.n-cite__pop')).not.toContainText('读取原文中');
  await expect(pop.locator('.n-cite__pop')).toContainText('演示');
  await expect(
    pop.locator('.n-cite__pop button[aria-label*="播放"]'),
  ).toHaveCount(0);

  // 键盘：聚焦角标即展开，Esc 关闭后焦点仍在角标上。
  const second = page.locator('#facts .n-cite__mark').nth(1);
  await second.focus();
  await expect(second).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-expanded', 'false');

  // 服务端负向用例：重放读取请求，换掉片段或原件版本，都拿不到摘录。
  const body = request.postData() ?? '';
  const headers = request.headers();
  delete headers['content-length'];
  delete headers.host;
  const original = /"fragmentId":"([^"]+)","originalVersionId":"([^"]+)"/.exec(
    body,
  );
  expect(original, 'source read payload').toBeTruthy();
  const replay = async (data: string) =>
    (
      await page.request.post(request.url(), {
        headers,
        data: Buffer.from(data),
      })
    ).text();
  const genuine = await replay(body);
  expect(genuine).toContain('"success"');
  for (const forged of [
    body.replace(original![1], 'forged-fragment'),
    body.replace(original![2], 'forged-version'),
  ]) {
    const text = await replay(forged);
    expect(text).not.toContain('"success"');
    expect(text).not.toContain('"excerpt"');
  }

  // 时间线：点标题展开事件卡；关键事件链接先展开再滚动并聚焦。
  const firstOpen = page.locator('.nt-tl-open').first();
  await firstOpen.click();
  await expect(firstOpen).toHaveAttribute('aria-expanded', 'true');
  await expect(
    page.locator(`#${await firstOpen.getAttribute('aria-controls')} .n-event`),
  ).toBeVisible();
  await firstOpen.click();
  await expect(firstOpen).toHaveAttribute('aria-expanded', 'false');
  const factLink = page.locator('#facts a.nt-plink').first();
  const target = (await factLink.getAttribute('href'))!;
  await factLink.click();
  const targetOpen = page.locator(`${target} .nt-tl-open`);
  await expect(targetOpen).toHaveAttribute('aria-expanded', 'true');
  await expect(targetOpen).toBeFocused();

  // 能力谱展开一行，点其中的事件跳到时间线并展开。
  const row = page.locator('button.n-spectrum__row').first();
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const eventLink = page.locator('.n-spectrum__list a').first();
  const eventTarget = (await eventLink.getAttribute('href'))!;
  await eventLink.click();
  await expect(page.locator(`${eventTarget} .nt-tl-open`)).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  // 带 #ev-… 进入时，该事件已展开。
  await page.goto(`/person?id=${SAMPLE}${target}`);
  await expect(page.locator(`${target} .nt-tl-open`)).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('hr: reference position is visible for a cohort member', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto(`/person?id=${SAMPLE}`);
  await expect(page.getByText('能力象限', { exact: true })).toBeVisible();
  await expect(page.getByText('参考位置', { exact: true })).toBeVisible();
  await expect(page.locator('.n-miniquad')).toHaveCount(1);
  // 结营评审按管理受限的历史资料列出，保留原量表，不换算成维度分。
  const review = page.locator('.n-tl__item', { hasText: '结营评审' });
  await expect(review).toHaveCount(1);
  await expect(review).toContainText('管理受限');
  await expect(review.locator('.n-scale')).toContainText('能力等级');
  await expect(review.locator('.n-score')).toHaveCount(0);
  await expectPending(page);
});

test('mentor: no quadrant, change or management content in the page or the response', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'mentor', referenceApp.baseURL);
  const response = await page.goto(`/person?id=${SAMPLE}`);
  const raw = await response!.text();
  for (const word of MENTOR_FORBIDDEN) expect(raw).not.toContain(word);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('.n-miniquad')).toHaveCount(0);
  const text = (await page.locator('main').textContent()) ?? '';
  for (const word of MENTOR_FORBIDDEN) expect(text).not.toContain(word);
});

test('mentor: a missing person and one outside the scope look the same', async ({
  page,
  context,
  referenceApp,
}) => {
  const outsideName = await prototypeName(OUTSIDE_MENTOR);
  expect(outsideName, 'out-of-scope sample name').toBeTruthy();
  await login(context, 'mentor', referenceApp.baseURL);
  const read = async (id: string) => {
    const response = await page.goto(`/person?id=${id}`);
    const raw = await response!.text();
    await expect(page.getByText('人员链接失效', { exact: true })).toBeVisible();
    return {
      raw,
      title: await page.title(),
      robots: await page
        .locator('meta[name="robots"]')
        .first()
        .getAttribute('content'),
      main: (await page.locator('main').textContent())?.replaceAll(
        /p-[a-z0-9-]+|does-not-exist/g,
        '',
      ),
    };
  };
  const missing = await read('does-not-exist');
  const outside = await read(OUTSIDE_MENTOR);
  expect(outside.title).toBe('人员链接失效 · Niu-Talent');
  expect(outside.title).toBe(missing.title);
  expect(outside.robots).toBe(missing.robots);
  expect(outside.robots).toContain('noindex');
  expect(outside.main).toBe(missing.main);
  expect(outside.raw).not.toContain(outsideName!);
  await expect(
    page.getByRole('link', { name: '回到人才列表' }),
  ).toHaveAttribute('href', '/people');
});

test('admin: the profile is refused before any person data is read', async ({
  page,
  context,
  referenceApp,
}) => {
  const sampleName = await prototypeName(SAMPLE);
  await login(context, 'admin', referenceApp.baseURL);
  const response = await page.goto(`/person?id=${SAMPLE}`);
  await expect(page.locator('.n-state__title')).toHaveText(
    '这一页属于业务视角',
  );
  await expect(page).toHaveTitle('这一页属于业务视角 · Niu-Talent');
  expect(await response!.text()).not.toContain(sampleName!);
});
