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
export { parseOfficeBytes } from './office/parse';
export { OfficeParseError } from './office/types';
export type {
  ParsedOffice,
  OfficeFragment,
  OfficeLocation,
  OfficeCellContent,
  OfficeScalar,
  OfficeParseFailure,
} from './office/types';

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
export {
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
} from './save-state/schema';

export {
  storeTrustedRecordDraftBatch,
  reviseTrustedRecordDraftBatch,
  lockRecordCommand,
  readRecordConfirmationState,
  commitRecordSave,
  commitRecordUndo,
  requireRecordUndoCommit,
  RecordWriteError,
} from './write';
export type {
  RecordCommand,
  RecordSaveLock,
  RecordUndoCommit,
  RecordConfirmationWorkFact,
} from './write';
export { wecomMessages, wecomReceiptAttempts } from './wecom/schema';
export {
  wecomArchivedMediaSchema,
  wecomArchivedMediaListSchema,
} from './wecom/facts';
export type { WecomArchivedMedia } from './wecom/facts';

// Internal upload facts require current authorization in the consuming usecase.
export {
  createPostgresUploadStore,
  lockUploadCollection,
  readUploadCollectionMembers,
} from './uploads/store';
export type { UploadDispatch, PostgresUploadStore } from './uploads/store';
export { readValidatedUpload } from './uploads/handoff';
export type { ValidatedUpload } from './uploads/handoff';
export type { UploadCollectionMembers } from './uploads/types';
