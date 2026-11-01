import type { Page } from '@playwright/test';
import { test, expect, login, type DemoRole } from './fixtures';

/**
 * BOW-847 记一件事. The page runs on the development sample /dev/record (the page read
 * and arranging actions of BOW-845 and the save and undo of BOW-846 are not on main);
 * the real /record route is checked for who may open it and for showing recording as
 * not connected.
 */
const SENTENCE =
  '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了，分工比之前清楚多了。';

async function arrange(page: Page, text = SENTENCE) {
  await page.getByRole('textbox', { name: '说说这次发生了什么' }).fill(text);
  await page.getByRole('button', { name: '整理成关键事件' }).click();
}

const motivation = (page: Page) =>
  page.locator('.n-score').filter({ hasText: '内生动力' });

for (const role of ['hr', 'mentor'] as const)
  test(`${role}: write, arrange, change a score, save and undo within five seconds`, async ({
    page,
    referenceApp,
  }) => {
    await page.goto(`${referenceApp.baseURL}/dev/record?role=${role}`);
    await expect(page.locator('#anchor')).toContainText(
      '内生动力 · 1–5 分锚点',
    );
    await arrange(page);
    // The job id goes into the URL; the text never does.
    await expect(page).toHaveURL(/[?&]job=sample-job-\d+/);
    expect(decodeURIComponent(page.url())).not.toContain('任务池');
    await expect(page.getByText('整理这条记录 · 3 步')).toBeVisible();

    // Reloading while arranging picks the same job up again.
    await page.reload();
    await expect(page.locator('#ev-save')).toBeVisible();
    await expect(motivation(page)).toHaveAttribute('data-state', 'ai');
    await expect(motivation(page).locator('.n-score__note')).toHaveText(
      '锚点 4 · 引用「孟逸尘今天主动把任务池同步给了全组」',
    );
    const grit = page.locator('.n-score').filter({ hasText: '坚毅力' });
    await expect(grit).toHaveAttribute('data-state', 'unknown');
    await expect(grit.getByRole('radio')).toHaveCount(0);
    // Nothing is filed before the receipt arrives.
    await expect(page.getByText(/已入档|刚刚保存到/)).toHaveCount(0);

    await motivation(page).getByRole('radio', { name: '2 分' }).click();
    await motivation(page)
      .getByRole('textbox', { name: '内生动力改分理由' })
      .fill('只同步了一次');
    await page.locator('#ev-save').click();
    await expect(page.getByText('刚刚保存到孟逸尘的档案')).toBeVisible();
    await expect(motivation(page).locator('.n-score__note')).toContainText(
      'AI 原为 4',
    );

    await page.getByRole('button', { name: '撤销' }).click();
    await expect(page.getByText('已撤销这条记录')).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: '说说这次发生了什么' }),
    ).toHaveValue(SENTENCE);
    await expect(page).not.toHaveURL(/job=/);
  });

test('the undo offer ends with the five-second window', async ({
  page,
  referenceApp,
}) => {
  await page.clock.install();
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr`);
  await arrange(page);
  await page.clock.runFor(3000);
  await page.locator('#ev-save').click();
  await expect(page.getByText('刚刚保存到孟逸尘的档案')).toBeVisible();
  await expect(page.getByRole('button', { name: '撤销' })).toBeVisible();
  await page.clock.runFor(5100);
  await expect(page.getByRole('button', { name: '撤销' })).toHaveCount(0);
  await expect(page.getByText('刚刚保存到孟逸尘的档案')).toBeVisible();
});

test('a failed arrangement keeps the text and retries', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr&scene=fail`);
  await arrange(page);
  await expect(page.getByText('整理中断了，原话还在')).toBeVisible();
  await page.getByRole('button', { name: '重新整理' }).click();
  await expect(page.locator('#ev-save')).toBeVisible();
  await expect(motivation(page)).toHaveAttribute('data-state', 'ai');
});

test('an offline start keeps the text and sends it again', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr&scene=offline`);
  await arrange(page);
  await expect(page.getByText('网络中断了，内容还在这里')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '说说这次发生了什么' }),
  ).toHaveValue(SENTENCE);
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('#ev-save')).toBeVisible();
});

test('a save conflict keeps the edits until the latest version is loaded', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr&scene=conflict`);
  await arrange(page);
  await motivation(page).getByRole('radio', { name: '3 分' }).click();
  await page.locator('#ev-save').click();
  await expect(
    page.getByText('这条记录刚刚有了更新，你改的内容还在这里'),
  ).toBeVisible();
  await expect(
    motivation(page).getByRole('radio', { name: '3 分' }),
  ).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('刚刚保存到孟逸尘的档案')).toHaveCount(0);
  await page.getByRole('button', { name: '载入最新版本' }).click();
  await page.getByRole('button', { name: '载入', exact: true }).click();
  await page.locator('#ev-save').click();
  await expect(page.getByText('刚刚保存到孟逸尘的档案')).toBeVisible();
});

test('a sentence without a name asks who it is first', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr&scene=selection`);
  await arrange(page);
  await expect(page.getByText('先选一下是谁').first()).toBeVisible();
  await expect(page.locator('.n-score')).toHaveCount(0);
});

for (const [role, heading] of [
  ['hrbp', '记一件事待接通'],
  ['mentor', '记一件事待接通'],
  ['ceo', '记一件事待接通'],
  ['admin', '这一页属于业务视角'],
] as [DemoRole, string][])
  test(`${role}: /record shows「${heading}」`, async ({
    page,
    context,
    referenceApp,
  }) => {
    await login(context, role, referenceApp.baseURL);
    await page.goto(`${referenceApp.baseURL}/record`);
    await expect(page.locator('.n-state__title')).toHaveText(heading);
    await expect(page.locator('#ev-text')).toHaveCount(0);
  });
