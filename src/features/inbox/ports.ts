import type {
  MaterialReviewCommand,
  MaterialReviewCommandResult,
  MaterialReviewItem,
  MaterialReviewResolvedItem,
  MaterialReviewUndoCommand,
  MaterialReviewUndoResult,
} from '@/contracts/material-review';
import type { People } from './view';

/**
 * What the page shows: the current viewer's open and resolved review items across
 * batches. Not in the contract yet: BOW-897 reads review items per batch only
 * (`materialBatchReceiptSchema`), and 860 / 905 / 906 add no cross-batch read. This
 * shape is the page's assumption; items keep their contract schemas.
 */
export type InboxData = {
  items: readonly MaterialReviewItem[];
  resolvedItems: readonly MaterialReviewResolvedItem[];
  /** Display names for candidates and resolved people (assumed with the read). */
  people: People;
};

/**
 * Everything the page does on the server. The route passes Server Actions down; the
 * client never imports server code. Commands and results are the 897 contract's.
 */
export type InboxPorts = {
  read(): Promise<InboxData>;
  resolve(command: MaterialReviewCommand): Promise<MaterialReviewCommandResult>;
  undo(command: MaterialReviewUndoCommand): Promise<MaterialReviewUndoResult>;
};
