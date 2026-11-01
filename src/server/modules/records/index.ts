/** Events have one evaluated person. Participants and shared source fragments never imply a score. */
export {
  historicalEvaluations,
  historicalParticipants,
  originals,
  originalVersions,
  fragments,
  events,
  eventParticipants,
  eventSources,
  statements,
  importSnapshots,
} from './schema';
export type { SourceLocation } from './schema';
export { readEvidenceForTalent } from './read';

// Batch preparation and persisted input facts; the native usecase owns authorization.
export { arrangeInputs } from './arrange/input-state/schema';
export type {
  ArrangeSourceContext,
  StoredArrangeInput,
} from './arrange/input-state/schema';
export {
  prepareBatch,
  prepareBatchSources,
  batchDigest,
} from './arrange/batch';
export type {
  BatchSource,
  BatchRuleBundle,
  BatchSnapshot,
  PreparedBatch,
  BatchPreparation,
  BatchSourcePreparation,
  BatchQuote,
  BatchIdentityLedger,
} from './arrange/batch';
export { readBatchArrangeRules } from './arrange/batch-rules';
export {
  materializeBatch,
  validateBatchModel,
  BatchValidationError,
} from './arrange/batch-validate';
export type { ValidatedBatch } from './arrange/batch-validate';
export {
  batchMessages,
  modelBatchSchema,
  BATCH_PROMPT_VERSION,
} from './arrange/batch-prompt';
export type { ModelBatch } from './arrange/batch-prompt';
export {
  projectBatchReceipt,
  BatchReceiptProjectionError,
} from './arrange/batch-receipt';
export type { BatchReceiptFacts } from './arrange/batch-receipt';
