import { describe, expect, it } from 'vitest';
import type { MaterialFileReceipt } from '@/contracts/materials';
import { sampleReceipt } from '@/app/dev/workbench/SampleMaterials';
import {
  batchParts,
  batchState,
  fileLines,
  inProgress,
  openBatches,
  localLine,
  receiptLine,
  settled,
  uploadHint,
  uploadRules,
  type Batch,
  type LocalFile,
} from './materials-model';

const file = (state: LocalFile['state'], id: string = state): LocalFile => {
  const base = { clientFileId: id, name: `${id}.docx` };
  switch (state) {
    case 'uploading':
      return { ...base, state, percent: 40 };
    case 'uploaded':
      return { ...base, state, uploadId: `u-${id}` };
    case 'interrupted':
    case 'rejected':
      return { ...base, state, message: '原因' };
    case 'canceled':
      return { ...base, state };
  }
};
const batch = (files: LocalFile[], submission: Batch['submission']): Batch => ({
  id: 'b',
  title: `本次投递 · ${files.length} 个文件`,
  files,
  submission,
});
const sent = (names: string[], settledRun: boolean) =>
  batch(
    names.map((name) => file('uploaded', name)),
    {
      state: 'sent',
      receipt: sampleReceipt(
        'batch',
        names.map((name) => ({ clientFileId: name, filename: `${name}.docx` })),
        settledRun,
      ),
    },
  );

describe('upload rules', () => {
  it('take this round’s seven formats and limits from the contract', () => {
    expect(uploadRules.extensions).toEqual([
      'mp3',
      'm4a',
      'wav',
      'aac',
      'txt',
      'docx',
      'pdf',
    ]);
    expect(uploadRules.maxFiles).toBe(10);
    expect(uploadRules.maxBytes).toBe(2 * 1024 ** 3);
    expect(uploadHint).toMatch(/^MP3 \/ M4A .* PDF，可以一次拖入多个/);
  });
});

describe('batch state', () => {
  it('follows the receipt status after submission', () => {
    expect(batchState(sent(['a'], false))).toEqual(['processing', '处理中']);
    expect(batchState(sent(['a', 'b'], true))).toEqual(['verify', '待核对']);
    expect(batchState(sent(['a'], true))).toEqual(['done', '已完成']);
    const base = sent(['a'], true);
    if (base.submission.state !== 'sent') throw new Error('sent');
    for (const [status, expected] of [
      ['awaiting_confirmation', ['confirm', '待确认']],
      ['failed', ['failed', '整理失败']],
    ] as const)
      expect(
        batchState({
          ...base,
          submission: {
            state: 'sent',
            receipt: { ...base.submission.receipt, status },
          },
        }),
      ).toEqual(expected);
  });

  it('reads this page’s own steps before the receipt exists', () => {
    const waiting = { state: 'waiting' } as const;
    expect(
      batchState(batch([file('uploading'), file('uploaded')], waiting)),
    ).toEqual(['processing', '上传中']);
    expect(
      batchState(batch([file('interrupted'), file('uploaded')], waiting)),
    ).toEqual(['failed', '上传中断']);
    expect(batchState(batch([file('uploaded')], waiting))).toEqual([
      'processing',
      '提交中',
    ]);
    expect(
      batchState(
        batch([file('uploaded')], { state: 'sending', operationId: 'o' }),
      ),
    ).toEqual(['processing', '提交中']);
    expect(
      batchState(
        batch([file('uploaded')], {
          state: 'interrupted',
          operationId: 'o',
          message: '连接中断',
        }),
      ),
    ).toEqual(['failed', '提交中断']);
    // Nothing uploaded: nothing goes, and it never says completed.
    expect(
      batchState(batch([file('rejected'), file('canceled')], waiting)),
    ).toEqual(['done', '已结束']);
  });

  it('counts a batch as in progress only while it is moving', () => {
    expect(
      inProgress([
        sent(['a'], false),
        sent(['a'], true),
        batch([file('uploading')], { state: 'waiting' }),
        batch([file('interrupted')], { state: 'waiting' }),
      ]),
    ).toBe(2);
  });

  it('is settled when nothing uploads or waits for a retry', () => {
    expect(
      settled([file('uploaded'), file('rejected'), file('canceled')]),
    ).toBe(true);
    expect(settled([file('uploaded'), file('uploading')])).toBe(false);
    expect(settled([file('interrupted')])).toBe(false);
  });
});

describe('file lines', () => {
  it('give every local state its own words', () => {
    expect(localLine(file('uploading'))).toMatchObject({
      label: '上传中',
      meta: '40%',
      progress: 40,
    });
    expect(localLine(file('uploaded'))).toMatchObject({
      label: '排队中',
      progress: null,
    });
    expect(localLine(file('interrupted'))).toMatchObject({
      label: '上传中断',
      tone: 'err',
    });
    expect(localLine(file('rejected'))).toMatchObject({
      label: '待换文件',
      tone: 'err',
    });
    expect(localLine(file('canceled')).label).toBe('已取消');
  });

  it('give every receipt status its own words', () => {
    const base = {
      materialId: 'm',
      clientFileId: 'c',
      filename: 'a.docx',
      originalVersionId: 'v',
    };
    const statuses: MaterialFileReceipt[] = [
      { ...base, status: 'processing', jobId: 'j' },
      { ...base, status: 'parsed', parseVersionId: 'p' },
      { ...base, status: 'needs_review', reviewItemIds: ['r1', 'r2'] },
      { ...base, status: 'unsupported', reason: 'scanned', message: '扫描件' },
      {
        ...base,
        status: 'failed',
        code: 'processing_failed',
        message: '整理中断',
        retryable: true,
      },
      { ...base, status: 'original_only' },
      { ...base, status: 'attachment_only' },
    ];
    expect(
      statuses.map((entry) => {
        const line = receiptLine(entry);
        return `${line.label} · ${line.meta}`;
      }),
    ).toEqual([
      '解析中 · 读取文字和位置',
      '已解析 · 可以定位到原文',
      '待核对 · 2 处',
      '待换文件 · 扫描件',
      '处理中断 · 整理中断',
      '只保留原件 · 原件已保存',
      '只作附件 · 只给对整份材料有权限的人看',
    ]);
  });

  it('draw the receipt’s file when there is one, the local file otherwise', () => {
    const done = sent(['a', 'b'], true);
    const lines = fileLines({
      ...done,
      files: [...done.files, file('rejected', 'c')],
    });
    expect(
      lines.map((line) => [line.name, line.line.label, !!line.local]),
    ).toEqual([
      ['a.docx', '已解析', false],
      ['b.docx', '待核对', false],
      ['c.docx', '待换文件', true],
    ]);
  });

  it('leave out a submitted file the current receipt does not show, with no progress', () => {
    const partial = sent(['a', 'b'], true);
    if (partial.submission.state !== 'sent') throw new Error('sent');
    const only = (names: string[]): Batch => {
      if (partial.submission.state !== 'sent') throw new Error('sent');
      const receipt = partial.submission.receipt;
      return {
        ...partial,
        files: [...partial.files, file('canceled', 'c')],
        submission: {
          state: 'sent',
          receipt: {
            ...receipt,
            hasHiddenContent: true,
            files: receipt.files.filter((entry) =>
              names.includes(entry.clientFileId),
            ),
          },
        },
      };
    };
    const shown = (lines: ReturnType<typeof fileLines>) =>
      lines.map((line) => [line.name, line.line.label, line.line.progress]);
    expect(shown(fileLines(only(['b'])))).toEqual([
      ['b.docx', '待核对', undefined],
      ['c.docx', '已取消', undefined],
    ]);
    expect(shown(fileLines(only([])))).toEqual([
      ['c.docx', '已取消', undefined],
    ]);
  });
});

describe('open batches', () => {
  const stamp = (entry: Batch, id: string): Batch => ({ ...entry, id });
  it('keep every older batch that still waits here, after the latest', () => {
    const latest = stamp(
      batch([file('uploading')], { state: 'waiting' }),
      'new',
    );
    const interrupted = stamp(
      batch([file('interrupted'), file('uploaded')], { state: 'waiting' }),
      'cut',
    );
    const resubmit = stamp(
      batch([file('uploaded')], {
        state: 'interrupted',
        operationId: 'op',
        message: '原因',
      }),
      'again',
    );
    const ended = stamp(batch([file('rejected')], { state: 'waiting' }), 'end');
    const submitted = stamp(sent(['a'], false), 'sent');
    expect(
      openBatches([latest, interrupted, ended, submitted, resubmit]).map(
        (entry) => entry.id,
      ),
    ).toEqual(['new', 'cut', 'again']);
    expect(openBatches([submitted, latest]).map((entry) => entry.id)).toEqual([
      'sent',
      'new',
    ]);
    expect(openBatches([])).toEqual([]);
  });
});

describe('summary parts', () => {
  it('come from the receipt counts after submission', () => {
    // Still processing: no 0 for events that may yet come.
    const processing = sent(['a'], false);
    expect(batchParts(processing)).toEqual(['1 个文件', '1 个处理中']);
    if (processing.submission.state !== 'sent') throw new Error('sent');
    const early = processing.submission.receipt;
    expect(
      batchParts({
        ...processing,
        submission: {
          state: 'sent',
          receipt: {
            ...early,
            counts: {
              ...early.counts,
              events: { total: 2, awaiting_confirmation: 2, confirmed: 0 },
            },
          },
        },
      }),
    ).toEqual(['1 个文件', '1 个处理中', '2 件事', '2 件待确认']);
    expect(batchParts(sent(['a', 'b', 'c'], true))).toEqual([
      '3 个文件',
      '1 个处理中断',
      '0 件事',
      '1 处待核对',
    ]);
    const done = sent(['a'], true);
    if (done.submission.state !== 'sent') throw new Error('sent');
    const receipt = done.submission.receipt;
    expect(
      batchParts({
        ...done,
        submission: {
          state: 'sent',
          receipt: {
            ...receipt,
            personIds: ['p-1', 'p-2'],
            hasHiddenContent: true,
            counts: {
              ...receipt.counts,
              files: { ...receipt.counts.files, unsupported: 1 },
              events: { total: 3, awaiting_confirmation: 2, confirmed: 1 },
            },
          },
        },
      }),
    ).toEqual([
      '1 个文件',
      '1 个待换文件',
      '2 人',
      '3 件事',
      '2 件待确认',
      '部分内容已按权限隐藏',
    ]);
  });

  it('come from this page before submission', () => {
    expect(
      batchParts(
        batch(
          [
            file('uploading', 'a'),
            file('interrupted', 'b'),
            file('rejected', 'c'),
            file('canceled', 'd'),
          ],
          { state: 'waiting' },
        ),
      ),
    ).toEqual([
      '4 个文件',
      '1 个上传中',
      '1 个上传中断',
      '1 个待换文件',
      '1 个已取消',
    ]);
  });
});
