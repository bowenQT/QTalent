'use server';
import 'server-only';
import { readReceiptForCurrentUser } from '../queries/receipt-page';

/**
 * Thin read for the receipt page's polling and reloads (owner ruling #248 6559810703).
 * The batch read checks the current session itself; nothing is decided here. Save
 * and undo reuse the record page's actions.
 */
export async function readReceiptAction(batchId: string) {
  const result = await readReceiptForCurrentUser({ batchId });
  return result.status === 'success'
    ? { status: 'success' as const, view: result.view }
    : result;
}
