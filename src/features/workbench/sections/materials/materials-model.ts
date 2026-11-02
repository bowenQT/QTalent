import {
  MAX_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  MEDIA_FORMATS,
} from '@/contracts/media';
import type {
  MaterialBatchReceipt,
  MaterialFileReceipt,
} from '@/contracts/materials';
import type { IconName } from '@/components/ui/Icon';
import type { FileSelectionRules } from '@/components/ui/file-selection';

/** This round's formats, size and count limits (BOW-858); the server checks again. */
export const uploadRules: FileSelectionRules = {
  extensions: MEDIA_FORMATS.map((format) => format.extension),
  acceptedLabel: MEDIA_FORMATS.map((format) =>
    format.extension.toUpperCase(),
  ).join(' / '),
  maxBytes: MAX_UPLOAD_BYTES,
  maxFiles: MAX_ATTACHMENTS,
};
export const uploadHint = `${uploadRules.acceptedLabel}，可以一次拖入多个 · 解析结果写明能定位到段落、页、单元格还是时间点`;

/** A file as this page knows it until the batch is submitted. */
export type LocalFile = { clientFileId: string; name: string } & (
  | { state: 'uploading'; percent: number }
  | { state: 'uploaded'; uploadId: string }
  /** The upload stopped half way (network, service); the same file can go again. */
  | { state: 'interrupted'; message: string }
  /** Format or size: this file never goes, another one has to. */
  | { state: 'rejected'; message: string }
  | { state: 'canceled' }
);

export type Submission =
  | { state: 'waiting' }
  | { state: 'sending'; operationId: string }
  | { state: 'interrupted'; operationId: string; message: string }
  | { state: 'sent'; receipt: MaterialBatchReceipt };

export type Batch = {
  id: string;
  title: string;
  files: LocalFile[];
  submission: Submission;
};

/** Keys of `.n-rstate[data-s]` in the prototype, plus the two this page adds. */
export type BatchKey = 'processing' | 'verify' | 'confirm' | 'done' | 'failed';

/**
 * The batch label. After submission it is the receipt's own status, in the order the
 * contract gives (still processing → to review → to confirm → completed); this page
 * never derives it from the arrays, and completed never means every file succeeded.
 */
export function batchState(batch: Batch): [BatchKey, string] {
  const { submission } = batch;
  if (submission.state === 'sent')
    switch (submission.receipt.status) {
      case 'processing':
        return ['processing', '处理中'];
      case 'needs_review':
        return ['verify', '待核对'];
      case 'awaiting_confirmation':
        return ['confirm', '待确认'];
      case 'completed':
        return ['done', '已完成'];
      case 'failed':
        return ['failed', '整理失败'];
    }
  if (batch.files.some((file) => file.state === 'uploading'))
    return ['processing', '上传中'];
  if (batch.files.some((file) => file.state === 'interrupted'))
    return ['failed', '上传中断'];
  switch (submission.state) {
    case 'waiting':
      // Every file was rejected or canceled: nothing goes, the batch just ends.
      return batch.files.some((file) => file.state === 'uploaded')
        ? ['processing', '提交中']
        : ['done', '已结束'];
    case 'sending':
      return ['processing', '提交中'];
    case 'interrupted':
      return ['failed', '提交中断'];
  }
}

/** Every file has an outcome: none is uploading or waiting for a retry. */
export function settled(files: readonly LocalFile[]) {
  return files.every(
    (file) => file.state !== 'uploading' && file.state !== 'interrupted',
  );
}

export type FileLine = {
  icon: IconName;
  label: string;
  tone: 'ok' | 'err' | null;
  meta: string;
  /** `undefined` draws no bar, a number a determinate one, `null` an indeterminate one. */
  progress?: number | null;
};

export function localLine(file: LocalFile): FileLine {
  switch (file.state) {
    case 'uploading':
      return {
        icon: 'upload',
        label: '上传中',
        tone: null,
        meta: `${file.percent}%`,
        progress: file.percent,
      };
    case 'uploaded':
      return {
        icon: 'clock',
        label: '排队中',
        tone: null,
        meta: '已上传',
        progress: null,
      };
    case 'interrupted':
      return { icon: 'x', label: '上传中断', tone: 'err', meta: file.message };
    case 'rejected':
      return { icon: 'x', label: '待换文件', tone: 'err', meta: file.message };
    case 'canceled':
      return {
        icon: 'dash',
        label: '已取消',
        tone: null,
        meta: '已移出本次投递',
      };
  }
}

/** One line per receipt file status; every status of the contract has its own words. */
export function receiptLine(file: MaterialFileReceipt): FileLine {
  switch (file.status) {
    case 'processing':
      return {
        icon: 'spark',
        label: '解析中',
        tone: null,
        meta: '读取文字和位置',
        progress: null,
      };
    case 'parsed':
      return {
        icon: 'check',
        label: '已解析',
        tone: 'ok',
        meta: '可以定位到原文',
      };
    case 'needs_review':
      return {
        icon: 'split',
        label: '待核对',
        tone: null,
        meta: `${file.reviewItemIds.length} 处`,
      };
    case 'unsupported':
      return { icon: 'x', label: '待换文件', tone: 'err', meta: file.message };
    case 'failed':
      return { icon: 'x', label: '处理中断', tone: 'err', meta: file.message };
    case 'original_only':
      return {
        icon: 'check',
        label: '只保留原件',
        tone: null,
        meta: '原件已保存',
      };
    case 'attachment_only':
      return {
        icon: 'check',
        label: '只作附件',
        tone: null,
        meta: '只给对整份材料有权限的人看',
      };
  }
}

/** The summary after the state, from the receipt's counts only. */
export function receiptParts(receipt: MaterialBatchReceipt): string[] {
  const { files, events, reviewItems } = receipt.counts;
  return [
    `${files.total} 个文件`,
    files.processing ? `${files.processing} 个处理中` : '',
    files.failed ? `${files.failed} 个处理中断` : '',
    files.unsupported ? `${files.unsupported} 个待换文件` : '',
    receipt.personIds.length ? `${receipt.personIds.length} 人` : '',
    // While files are still being read the count only grows; a 0 then would read as nothing found.
    receipt.status === 'processing' && !events.total
      ? ''
      : `${events.total} 件事`,
    reviewItems ? `${reviewItems} 处待核对` : '',
    events.awaiting_confirmation
      ? `${events.awaiting_confirmation} 件待确认`
      : '',
    receipt.hasHiddenContent ? '部分内容已按权限隐藏' : '',
  ].filter(Boolean);
}

/** The summary before the receipt exists: what this page itself knows. */
export function localParts(batch: Batch): string[] {
  const count = (state: LocalFile['state']) =>
    batch.files.filter((file) => file.state === state).length;
  return [
    `${batch.files.length} 个文件`,
    count('uploading') ? `${count('uploading')} 个上传中` : '',
    count('interrupted') ? `${count('interrupted')} 个上传中断` : '',
    count('rejected') ? `${count('rejected')} 个待换文件` : '',
    count('canceled') ? `${count('canceled')} 个已取消` : '',
  ].filter(Boolean);
}

export function batchParts(batch: Batch) {
  return batch.submission.state === 'sent'
    ? receiptParts(batch.submission.receipt)
    : localParts(batch);
}

/**
 * Files to draw: the receipt's for submitted ones, this page's for the rest. A file
 * that went with the batch but is missing from the current receipt (hidden by
 * permission) is left out: the server never said it is queued, so the old local
 * state is not drawn as if it were.
 */
export function fileLines(
  batch: Batch,
): { key: string; name: string; line: FileLine; local?: LocalFile }[] {
  const { submission } = batch;
  return batch.files.flatMap((file) => {
    if (submission.state !== 'sent')
      return [
        {
          key: file.clientFileId,
          name: file.name,
          line: localLine(file),
          local: file,
        },
      ];
    const receipt = submission.receipt.files.find(
      (entry) => entry.clientFileId === file.clientFileId,
    );
    if (receipt)
      return [
        {
          key: file.clientFileId,
          name: receipt.filename,
          line: receiptLine(receipt),
        },
      ];
    // Only uploaded files went; rejected and canceled ones stay as this page knows them.
    return file.state === 'uploaded'
      ? []
      : [
          {
            key: file.clientFileId,
            name: file.name,
            line: localLine(file),
            local: file,
          },
        ];
  });
}

/**
 * Batches the upload area shows: the latest, and every older one that still waits on
 * this page (uploading, interrupted, submitting), so a new drop never strands the
 * cancel, retry or resubmit of an earlier batch.
 */
export function openBatches(batches: readonly Batch[]) {
  return batches.filter(
    (batch, index) =>
      index === 0 ||
      (batch.submission.state !== 'sent' && batchState(batch)[0] !== 'done'),
  );
}

/** Batches still moving: uploading, submitting, or processing on the server. */
export function inProgress(batches: readonly Batch[]) {
  return batches.filter((batch) => batchState(batch)[0] === 'processing')
    .length;
}
