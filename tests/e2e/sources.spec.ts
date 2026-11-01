import type { Page } from '@playwright/test';
import type { Pool } from 'pg';
import { test, expect, login } from './fixtures';
import { sourceHref } from '../../src/features/sources/source-href';

const SAMPLES = '/dev/design-system/sources';
const VIEW = `${SAMPLES}/view`;

// 样张里每种定位引用到的那一处，打开后应该落在这里。图片区域没有文字，按读屏标签认。
const KINDS = [
  ['document', '剩余任务按方案 B 重新拆分为 5 个 Issue'],
  ['pdf', '本周两次线上告警都在半小时内定位到具体服务'],
  ['spreadsheet', '主动补齐接口文档，联调时间缩短一半'],
  ['presentation', '搜索结果点击率从 21% 提升到 34%'],
  ['recording', '每个方案的验收标准都写清楚了'],
  ['video', '现场打开监控面板逐项解释'],
  ['image', null],
  ['code', 'export function rank'],
] as const;

const viewURL = (key: string) =>
  new RegExp(
    `${VIEW.replaceAll('/', '\\/')}\\?fragment=demo-frag-${key}&version=demo-ver-${key}$`,
  );

async function expectLocated(page: Page, text: string | null) {
  const target = page.locator('[aria-current="location"]');
  await expect(target).toHaveCount(1);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  if (text) await expect(target).toContainText(text);
  else await expect(target).toHaveAttribute('aria-label', /^引用的区域：/);
  return target;
}

async function openFrom(page: Page, scope: string, index = 0) {
  const cite = page.locator(`${scope} .n-cite`).nth(index);
  await cite.locator('.n-cite__mark').click();
  await cite.getByRole('link', { name: '查看原件' }).click();
}

test('every location kind opens from its citation, lands on the cited place and fits a phone', async ({
  page,
}) => {
  for (const [key, text] of KINDS) {
    await page.goto(SAMPLES);
    await openFrom(page, `[data-sample="kinds"] li[data-kind="${key}"]`);
    await expect(page).toHaveURL(viewURL(key));
    await expectLocated(page, text);
  }
  // 三个入口引用的是同一条出处：落到同一个地址、同一处。
  for (const index of [0, 1, 2]) {
    await page.goto(SAMPLES);
    await openFrom(page, '[data-sample="entries"]', index);
    await expect(page).toHaveURL(viewURL('document'));
    await expectLocated(page, KINDS[0][1]);
    await page.getByRole('link', { name: '返回' }).click();
    await expect(page).toHaveURL(new RegExp(`${SAMPLES}$`));
  }

  // 手机 375 宽：每种原件都在屏宽内，滚走后能回到引用的那一处。
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [key] of KINDS) {
    await page.goto(sourceHref(ids(key), VIEW));
    await expect(page.locator('[aria-current="location"]')).toBeFocused();
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll, `${key} overflows the phone width`).toBe(width.client);
  }
  // 播放条在手机宽仍画出波形，引用的时间段至少有一根看得见的刻度。
  for (const key of ['recording', 'video']) {
    await page.goto(sourceHref(ids(key), VIEW));
    const bars = await page.locator('.n-player__track i').evaluateAll((items) =>
      items.map((item) => ({
        width: item.getBoundingClientRect().width,
        mark: item.classList.contains('is-mark'),
      })),
    );
    expect(
      bars.every((bar) => bar.width >= 1),
      `${key} bars collapse`,
    ).toBe(true);
    expect(
      bars.some((bar) => bar.mark),
      `${key} has no marked bar`,
    ).toBe(true);
    await expect(page.locator('.n-player__track')).toBeInViewport();
  }
  await page.goto(sourceHref(ids('spreadsheet'), VIEW));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const target = page.locator('[aria-current="location"]');
  await page.getByRole('button', { name: '定位到原文' }).click();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();

  // 整份原件不在查看范围或打不开：只显示提取出的这一段，并写明原因。
  for (const [key, title, excerpt] of [
    ['pdf-restricted', '完整原件在你的查看范围之外', '复盘会上补充了回滚预案'],
    [
      'image-restricted',
      '完整原图在你的查看范围之外',
      '群聊截图里这一条是本人的周报摘要',
    ],
    ['image-failed', '原图暂时打不开', '看板上标出了两项延期任务'],
  ] as const) {
    await page.goto(sourceHref(ids(key), VIEW));
    await expect(page.getByText(title)).toBeVisible();
    await expect(page.locator('blockquote')).toHaveText(excerpt);
  }
});

function ids(key: string) {
  return {
    fragmentId: `demo-frag-${key}`,
    originalVersionId: `demo-ver-${key}`,
  };
}

/** A seeded fragment cited only by one person's events, so its visibility follows that person. */
async function fragmentOf(pool: Pool, personId: string) {
  const { rows } = await pool.query<{
    fragment_id: string;
    original_version_id: string;
    excerpt: string;
  }>(
    `select f.id as fragment_id, f.original_version_id, f.excerpt
       from records_fragments f
       join records_event_sources s
         on s.fragment_id = f.id and s.original_version_id = f.original_version_id
       join records_events e on e.id = s.event_id
      where e.person_id = $1
        and not exists (
          select 1 from records_event_sources s2
            join records_events e2 on e2.id = s2.event_id
           where s2.fragment_id = f.id and e2.person_id <> $1)
      order by f.id
      limit 1`,
    [personId],
  );
  const row = rows[0];
  if (!row) throw new Error(`No seeded fragment for ${personId}`);
  return {
    href: sourceHref({
      fragmentId: row.fragment_id,
      originalVersionId: row.original_version_id,
    }),
    excerpt: row.excerpt,
  };
}

// 与人员档案同一组样本：p-x07 是导师所带、三种视角都能看的演示学员；p-x01 在导师范围外。
test('the real viewer shows an authorized source and returns no content otherwise', async ({
  page,
  context,
  referenceApp,
}) => {
  const inside = await fragmentOf(referenceApp.pool, 'p-x07');
  const outside = await fragmentOf(referenceApp.pool, 'p-x01');

  await login(context, 'hrbp', referenceApp.baseURL);
  await page.goto(outside.href);
  await expect(
    page.getByText(outside.excerpt, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('原型基线 2e51b50，评语按原意压缩'),
  ).toBeVisible();
  await expect(page.locator('[aria-current="location"]')).toBeFocused();
  await expect(page.getByText('演示', { exact: true }).first()).toBeVisible();

  await context.clearCookies();
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto(inside.href);
  await expect(
    page.getByText(inside.excerpt, { exact: true }).first(),
  ).toBeVisible();
  const refused = await page.goto(outside.href);
  await expect(
    page.getByRole('heading', { name: '原件链接失效' }),
  ).toBeVisible();
  expect(await refused!.text()).not.toContain(outside.excerpt);
  expect(await page.content()).not.toContain(outside.excerpt);

  await context.clearCookies();
  await login(context, 'admin', referenceApp.baseURL);
  const admin = await page.goto(inside.href);
  await expect(
    page.getByRole('heading', { name: '这一页属于业务视角' }),
  ).toBeVisible();
  expect(await admin!.text()).not.toContain(inside.excerpt);

  await page.goto('/sources?fragment=only-one-identifier');
  await expect(
    page.getByRole('heading', { name: '原件链接失效' }),
  ).toBeVisible();
});
