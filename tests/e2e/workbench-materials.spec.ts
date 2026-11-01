import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * BOW-861 materials on the development sample, whose upload backend is scripted
 * (BOW-873 and the batch use cases are not on main): ten progress steps per file,
 * `upload=fail` interrupts the first transfer half way, and a batch settles on its
 * first receipt read. /work itself shows 待接入 (see workbench-work.spec.ts).
 */
const file = (name: string, mimeType: string) => ({
  name,
  mimeType,
  buffer: Buffer.from('演示材料，人员均为化名'),
});
const docx = (name: string) =>
  file(
    name,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );

async function drop(page: Page, files: ReturnType<typeof file>[]) {
  await page.locator('#upload input[type=file]').setInputFiles(files);
}
const batch = (page: Page) => page.locator('#files .n-dropbatch');
const fileRow = (page: Page, name: string) =>
  batch(page).locator('.n-file', { hasText: name });

test('HR uploads a batch, retries an interrupted file and cancels another', async ({
  page,
}) => {
  await page.goto('/dev/workbench?role=hr&upload=fail');
  await expect(page.locator('#tasks')).toContainText('投递的材料会出现在这里');
  await drop(page, [
    docx('W8 对人复盘纪要.docx'),
    file('评审表.pdf', 'application/pdf'),
    file('路演现场.heic', 'image/heic'),
  ]);
  await expect(batch(page).locator('.n-dropbatch__head')).toContainText(
    '本次投递 · 3 个文件',
  );
  await expect(fileRow(page, '路演现场.heic')).toContainText(
    '待换文件 · 暂不支持 .heic 格式',
  );
  await expect(
    fileRow(page, '评审表.pdf').getByRole('progressbar'),
  ).toBeVisible();

  // The first transfer stops half way; the batch waits for it.
  const first = fileRow(page, 'W8 对人复盘纪要.docx');
  await expect(first).toContainText('上传中断 · 连接中断，可以重试');
  await expect(batch(page).locator('.n-rstate')).toHaveText('上传中断');
  const retry = first.getByRole('button', { name: '重试' });
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(first.getByRole('progressbar')).toBeVisible();

  // Both uploaded: one batch goes, processing, then the receipt settles.
  await expect(batch(page).locator('.n-rstate')).toHaveText('处理中', {
    timeout: 10_000,
  });
  const row = page.locator('#tasks .n-task');
  await expect(row).toContainText('统一投递');
  await expect(row).toContainText('处理中 · 2 个文件 · 2 个处理中 · 0 件事');
  await expect(batch(page).locator('.n-rstate')).toHaveText('待核对', {
    timeout: 10_000,
  });
  await expect(first).toContainText('已解析 · 可以定位到原文');
  await expect(fileRow(page, '评审表.pdf')).toContainText('待核对 · 1 处');
  await expect(row).toContainText('待核对 · 2 个文件 · 0 件事 · 1 处待核对');

  // A second drop: cancel while uploading, nothing goes.
  await drop(page, [docx('补充记录.docx')]);
  const extra = fileRow(page, '补充记录.docx');
  await extra.getByRole('button', { name: '取消' }).click();
  await expect(extra).toContainText('已取消 · 这份文件不上传');
  await expect(batch(page).locator('.n-rstate')).toHaveText('已结束');
  await expect(page.locator('#tasks .n-task')).toHaveCount(2);
});

test('mentor opens 材料与任务 from the clip or the keyboard and follows a batch', async ({
  page,
}) => {
  await page.goto('/dev/workbench?role=mentor');
  const fold = page.locator('details#fold');
  const summary = fold.locator('summary');
  await expect(fold).not.toHaveAttribute('open');
  await expect(summary).toHaveText('材料与任务');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(fold).toHaveAttribute('open');
  await page.keyboard.press('Enter');
  await expect(fold).not.toHaveAttribute('open');

  await page.getByRole('link', { name: '上传材料' }).click();
  await expect(page).toHaveURL(/#upload$/);
  await expect(fold).toHaveAttribute('open');

  await drop(page, [docx('W8 对人复盘纪要.docx')]);
  await expect(summary).toHaveText('材料与任务1 个在处理');
  await expect(batch(page).locator('.n-rstate')).toHaveText('已完成', {
    timeout: 10_000,
  });
  await expect(summary).toHaveText('材料与任务');
  await expect(page.locator('#tasks .n-task')).toContainText(
    '已完成 · 1 个文件 · 0 件事',
  );
});
