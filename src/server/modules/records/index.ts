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

export {
  recordDraftBatches,
  recordDrafts,
  recordDraftEvents,
  recordSaves,
  recordOperations,
} from './save-state/schema';

export {
  storeTrustedRecordDraftBatch,
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
