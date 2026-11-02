/** The public action path now consumes final897 MaterialBatchInput/Receipt.
 * Node-less single-draft requests are rejected by the native factory, not guessed.
 * The retained legacy algorithm remains testable but is not a production writer. */
export {
  createRecordBatchArrangeRequests as createRecordArrangeRequests,
  ArrangeInputConflict,
  readArrangeJobRecord,
} from './record-batch-arrange-requests';
export type {
  RecordArrangeRequestDependencies,
  TrustedArrangeSources,
} from './record-batch-arrange-requests';
