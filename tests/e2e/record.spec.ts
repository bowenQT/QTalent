import type { Page } from '@playwright/test';
import { test, expect, login, type DemoRole } from './fixtures';

/**
 * BOW-847 记一件事. The full flow (arrange, confirm, save, undo) runs on the
 * development sample /dev/record, whose stand-in answers with BOW-897 receipts:
 * next dev has no arranging worker or model. The real /record route is checked for
 * the BOW-845 page read and for the server-side node derivation (#327).
 */
const SENTENCE =
  '孟逸尘今天主动把任务池同步给了全组，下午组员就接上了，分工比之前清楚多了。';

async function arrange(page: Page, text = SENTENCE, personId = 'p-x11') {
  if (personId)
    await page
      .getByRole('combobox', { name: '记录给谁' })
      .selectOption(personId);
  await page.getByRole('textbox', { name: '说说这次发生了什么' }).fill(text);
  await page.getByRole('button', { name: '整理成关键事件' }).click();
}

const motivation = (page: Page) =>
  page.locator('.n-score').filter({ hasText: '内生动力' });

for (const role of ['hr', 'mentor'] as const)
  test(`${role}: write, arrange, change a score, save, undo within five seconds and save again`, async ({
    page,
    referenceApp,
  }) => {
    await page.goto(`${referenceApp.baseURL}/dev/record?role=${role}`);
    await expect(page.locator('#anchor')).toContainText(
      '内生动力 · 1–5 分锚点',
    );
    await arrange(page);
    // The batch id goes into the URL; the text never does.
    await expect(page).toHaveURL(/[?&]batch=sample-batch-\d+/);
    expect(decodeURIComponent(page.url())).not.toContain('任务池');
    await expect(page.getByText('整理这条记录 · 3 步')).toBeVisible();

    // Reloading while arranging picks the same batch up again, text included.
    await page.reload();
    await expect(page.locator('#ev-save')).toBeVisible();
    await expect(page.locator('.n-event__raw p')).toHaveText(SENTENCE);
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
    // As in the prototype, undo goes back to confirming with every change still there.
    await expect(page.locator('#ev-save')).toBeVisible();
    await expect(page.getByText('刚刚保存到孟逸尘的档案')).toHaveCount(0);
    await expect(
      motivation(page).getByRole('radio', { name: '2 分' }),
    ).toHaveAttribute('aria-checked', 'true');
    await expect(
      motivation(page).getByRole('textbox', { name: '内生动力改分理由' }),
    ).toHaveValue('只同步了一次');
    await page.locator('#ev-save').click();
    await expect(page.getByText('刚刚保存到孟逸尘的档案')).toBeVisible();
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

test('the node is derived by the server: no person or several nodes stop before submitting', async ({
  page,
  referenceApp,
}) => {
  await page.goto(`${referenceApp.baseURL}/dev/record?role=hr`);
  await arrange(page, SENTENCE, '');
  await expect(page.getByText('在「谁」里选一位同事，再整理')).toBeVisible();
  await expect(page.getByRole('combobox', { name: '记录给谁' })).toBeFocused();
  await expect(page).not.toHaveURL(/batch=/);
  await page.goto(
    `${referenceApp.baseURL}/dev/record?role=hr&scene=node-multiple`,
  );
  await arrange(page);
  await expect(
    page.getByText('这次记在哪个评价节点，待 HRBP 确认'),
  ).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: '说说这次发生了什么' }),
  ).toHaveValue(SENTENCE);
  await expect(page).not.toHaveURL(/batch=/);
});

for (const [scene, title] of [
  ['many', '整理出几件事，到回执里逐件确认'],
  ['review', '有几处待核对，到回执里处理'],
] as const)
  test(`${scene}: links to this batch's receipt instead of confirming here`, async ({
    page,
    context,
    referenceApp,
  }) => {
    // Signed in so the receipt route itself can be opened from the link.
    await login(context, 'hrbp', referenceApp.baseURL);
    await page.goto(
      `${referenceApp.baseURL}/dev/record?role=hr&scene=${scene}`,
    );
    await arrange(page);
    await expect(page.getByText(title)).toBeVisible();
    const batch = new URL(page.url()).searchParams.get('batch');
    expect(batch).toMatch(/^sample-batch-\d+$/);
    await expect(page.getByRole('link', { name: '打开回执' })).toHaveAttribute(
      'href',
      `/receipt?id=${batch}`,
    );
    await expect(page.locator('.n-score')).toHaveCount(0);
    await expect(page.locator('#ev-save')).toHaveCount(0);
    // The receipt page cannot confirm yet: it says so, and this page keeps a way back.
    await expect(
      page.getByText('回执页的逐件确认待接通', { exact: false }),
    ).toBeVisible();
    await page.getByRole('link', { name: '打开回执' }).click();
    await expect(
      page.getByRole('heading', { name: '回执待接通' }),
    ).toBeVisible();
    await page.goBack();
    await page.getByRole('button', { name: '改原话' }).click();
    await expect(
      page.getByRole('textbox', { name: '说说这次发生了什么' }),
    ).toHaveValue(SENTENCE);
  });

test(`mentor: /record reads whom to record and derives the node on the server`, async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'mentor', referenceApp.baseURL);
  await page.goto(`${referenceApp.baseURL}/record`);
  await expect(
    page.getByRole('heading', { level: 1, name: '记一件事' }),
  ).toBeVisible();
  const who = page.getByRole('combobox', { name: '记录给谁' });
  // 「从原话里识别」 plus the people the 845 page read allows this account.
  expect(await who.locator('option').count()).toBeGreaterThan(1);
  await who.selectOption({ index: 1 });
  await page
    .getByRole('textbox', { name: '说说这次发生了什么' })
    .fill('演示：今天主动同步了进度。');
  await page.getByRole('button', { name: '整理成关键事件' }).click();
  // The seeded mentor writes exactly one node for this person: a real batch is
  // submitted and stays processing, since next dev runs no arranging worker.
  await expect(page.getByText('已提交，整理中')).toBeVisible();
  await expect(page).toHaveURL(/batch=/);
  await expect(page.getByText(/评价节点|待 HRBP 确认/)).toHaveCount(0);
  await expect(page.locator('.n-score')).toHaveCount(0);
});

for (const role of ['hrbp', 'ceo'] as DemoRole[])
  test(`${role}: /record says recording starts from an evaluation node`, async ({
    page,
    context,
    referenceApp,
  }) => {
    // In the seeded data these accounts write no evaluation node, so page() refuses.
    await login(context, role, referenceApp.baseURL);
    await page.goto(`${referenceApp.baseURL}/record`);
    await expect(
      page.getByRole('heading', { name: '加入评价节点后，就能在这里记一件事' }),
    ).toBeVisible();
    await expect(page.getByRole('textbox')).toHaveCount(0);
  });

test('admin: /record belongs to the business view', async ({
  page,
  context,
  referenceApp,
}) => {
  await login(context, 'admin', referenceApp.baseURL);
  await page.goto(`${referenceApp.baseURL}/record`);
  await expect(page.locator('.n-state__title')).toHaveText(
    '这一页属于业务视角',
  );
  await expect(page.locator('#ev-text')).toHaveCount(0);
});
