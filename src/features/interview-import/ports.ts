import type { ImportRow } from './model';

export type RowResult =
  | { status: 'ok'; row: ImportRow }
  /** The row changed elsewhere, or the action is not available; the page keeps its rows. */
  | { status: 'conflict' | 'not_connected'; message: string };

/**
 * What the preview asks the server to do with one row. Each answer is the row as stored
 * afterwards, so leaving the page and coming back shows the same rows. Importing the
 * confirmed rows is not a port yet: BOW-906 has no persistence or profile projection.
 */
export type InterviewImportPorts = {
  confirm(batchId: string, rowId: string, ok: boolean): Promise<RowResult>;
  fill(
    batchId: string,
    rowId: string,
    item: string,
    value: string,
  ): Promise<RowResult>;
  sendToReview(batchId: string, rowId: string): Promise<RowResult>;
};
