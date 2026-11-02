import { z } from 'zod';
import {
  confirmRow,
  fillItem,
  sendToReview,
  type ImportBatch,
  type ImportRow,
} from '@/features/interview-import/model';
import type {
  InterviewImportPorts,
  RowResult,
} from '@/features/interview-import/ports';

/**
 * Stands in for the server's stored preview: HR's changes to each row live in this
 * tab's sessionStorage, so the sample keeps confirmed rows when HR leaves the page and
 * comes back. Only the fields HR changes are stored; the rows themselves are the sample.
 */
const stored = z.record(
  z.string(),
  z.object({
    confirmed: z.boolean(),
    filled: z.record(z.string(), z.string()),
    reviewItemId: z.string().nullable(),
  }),
);
type Stored = z.infer<typeof stored>;

export const storageKey = (batchId: string) => `qtalent-dev-import:${batchId}`;

function parse(raw: string | null): Stored {
  if (!raw) return {};
  try {
    const result = stored.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

/** The sample batch with what this tab has stored applied, from a stored snapshot. */
export function restore(batch: ImportBatch, raw: string | null): ImportBatch {
  const saved = parse(raw);
  return {
    ...batch,
    rows: batch.rows.map((row) => {
      const entry = saved[row.rowId];
      return entry ? { ...row, ...entry } : row;
    }),
  };
}

export function samplePorts(
  batch: ImportBatch,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): InterviewImportPorts {
  const key = storageKey(batch.id);
  function change(
    batchId: string,
    rowId: string,
    apply: (row: ImportRow) => ImportRow,
  ): Promise<RowResult> {
    const raw = storage.getItem(key);
    const current = restore(batch, raw).rows.find((r) => r.rowId === rowId);
    if (batchId !== batch.id || !current)
      return Promise.resolve({
        status: 'conflict',
        message: '这一行已变化，请刷新后再看',
      });
    const row = apply(current);
    const { confirmed, filled, reviewItemId } = row;
    storage.setItem(
      key,
      JSON.stringify({
        ...parse(raw),
        [rowId]: { confirmed, filled, reviewItemId },
      }),
    );
    return Promise.resolve({ status: 'ok', row });
  }
  return {
    confirm: (batchId, rowId, ok) =>
      change(batchId, rowId, (row) => confirmRow(row, ok)),
    fill: (batchId, rowId, item, value) =>
      change(batchId, rowId, (row) => fillItem(row, item, value)),
    sendToReview: (batchId, rowId) =>
      change(batchId, rowId, (row) => sendToReview(row, `i-iv-${rowId}`)),
  };
}
