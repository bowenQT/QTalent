'use client';
import { useMemo, type ReactNode } from 'react';
import {
  materialBatchReceiptSchema,
  type MaterialBatchReceipt,
  type MaterialFileReceipt,
} from '@/contracts/materials';
import { materialReviewItemsFixture } from '@/contracts/materials.fixtures';
import type { MaterialReviewItem } from '@/contracts/material-review';
import {
  MaterialsPortProvider,
  type MaterialsPort,
} from '@/features/workbench/sections/materials/materials-port';

const STEP_MS = 200;
const NODE = 'demo-node';

type Sent = { clientFileId: string; filename: string };

const material = (file: Sent) => ({
  materialId: `m-${file.clientFileId}`,
  clientFileId: file.clientFileId,
  filename: file.filename,
});

/**
 * The receipt the sample reads back. While processing every file is in work; after
 * that the first file is parsed, the second has one person to review, and any further
 * file stopped. Parsed with the BOW-897 schema, so the sample stays within the contract.
 */
export function sampleReceipt(
  batchId: string,
  files: readonly Sent[],
  settledRun: boolean,
): MaterialBatchReceipt {
  const items: MaterialReviewItem[] = [];
  const receipts = files.map((file, index): MaterialFileReceipt => {
    const base = material(file);
    const version = `v-${file.clientFileId}`;
    if (!settledRun)
      return {
        ...base,
        originalVersionId: version,
        status: 'processing',
        jobId: `job-${file.clientFileId}`,
      };
    if (index === 0)
      return {
        ...base,
        status: 'parsed',
        originalVersionId: version,
        parseVersionId: `p-${file.clientFileId}`,
      };
    if (index === 1) {
      const itemId = `r-${file.clientFileId}`;
      items.push({
        ...materialReviewItemsFixture[1],
        kind: 'unknown_person',
        batchId,
        evaluationNodeId: NODE,
        materialId: base.materialId,
        originalVersionId: version,
        itemId,
        observedName: '演示人员丙',
      } as MaterialReviewItem);
      return {
        ...base,
        originalVersionId: version,
        status: 'needs_review',
        reviewItemIds: [itemId],
      };
    }
    return {
      ...base,
      originalVersionId: version,
      status: 'failed',
      code: 'processing_failed',
      message: '整理中断，原件已保存',
      retryable: false,
    };
  });
  const count = (status: MaterialFileReceipt['status']) =>
    receipts.filter((file) => file.status === status).length;
  return materialBatchReceiptSchema.parse({
    batchId,
    revision: settledRun ? 2 : 1,
    evaluationNodeId: NODE,
    personIds: [],
    projectId: null,
    hasHiddenContent: false,
    status: !settledRun
      ? 'processing'
      : items.length
        ? 'needs_review'
        : 'completed',
    jobId: null,
    files: receipts,
    textMaterial: null,
    items,
    resolvedItems: [],
    draftSet: null,
    confirmedDrafts: [],
    counts: {
      files: {
        total: receipts.length,
        processing: count('processing'),
        parsed: count('parsed'),
        needs_review: count('needs_review'),
        unsupported: count('unsupported'),
        failed: count('failed'),
        original_only: count('original_only'),
        attachment_only: count('attachment_only'),
      },
      events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
      reviewItems: items.length,
    },
    error: null,
  });
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

/**
 * Scripted upload backend for the development sample (BOW-873 and the batch use
 * cases are not on main): ten progress steps per file, `?upload=fail` interrupts
 * the first transfer half way, a batch is processing when submitted and settled
 * on the first read. Never used by /work.
 */
export function SampleMaterials({
  failFirst,
  children,
}: {
  failFirst: boolean;
  children: ReactNode;
}) {
  const port = useMemo<MaterialsPort>(() => {
    let transfers = 0;
    const batches = new Map<string, { files: Sent[]; reads: number }>();
    const names = new Map<string, string>();
    return {
      async upload(file, onProgress, signal) {
        const fail = failFirst && transfers++ === 0;
        for (let percent = 10; percent <= 100; percent += 10) {
          await wait(STEP_MS, signal);
          if (fail && percent === 60)
            return { status: 'interrupted', message: '连接中断，可以重试' };
          onProgress(percent);
        }
        const uploadId = `u-${crypto.randomUUID()}`;
        names.set(uploadId, file.name);
        return { status: 'uploaded', uploadId };
      },
      async submit({ operationId, files }) {
        await wait(STEP_MS);
        const batchId = `b-${operationId}`;
        const sent = files.map((file) => ({
          clientFileId: file.clientFileId,
          filename: names.get(file.uploadId) ?? file.clientFileId,
        }));
        if (!batches.has(batchId))
          batches.set(batchId, { files: sent, reads: 0 });
        return {
          status: 'accepted',
          receipt: sampleReceipt(batchId, batches.get(batchId)!.files, false),
        };
      },
      async read(batchId) {
        const batch = batches.get(batchId);
        if (!batch) return null;
        batch.reads += 1;
        return sampleReceipt(batchId, batch.files, batch.reads >= 1);
      },
    };
  }, [failFirst]);
  return <MaterialsPortProvider port={port}>{children}</MaterialsPortProvider>;
}
