import type { SpeakerItem } from '../../../contracts/media';
import type {
  createOfflineTingwu,
  OfflineInput,
} from '../../integrations/tingwu/offline';
import type {
  ArchivedUpload,
  InspectedAudio,
  OfflineDraftInput,
  RecordingBindings,
  RecordingContext,
  RecordingRun,
  RecordingTranscript,
  RecordingWork,
} from '../../modules/records/recordings/types';

export type OfflineTranscriber = ReturnType<typeof createOfflineTingwu>;
export type RecordingTransaction = {
  run: RecordingRun | null;
  context: RecordingContext | null;
  saveRun(run: RecordingRun): Promise<void>;
  /** Immutable transcript + all fragment/source rows, atomically with the run. */
  insertTranscript(transcript: RecordingTranscript): Promise<void>;
  loadBindings(transcript: RecordingTranscript): Promise<RecordingBindings>;
  replacePendingReview(items: SpeakerItem[]): Promise<void>;
  /** Both queue methods use this same native DB transaction and the single producer. */
  enqueueShaping(
    input: OfflineDraftInput,
    operationKey: string,
  ): Promise<{ jobId: string }>;
  enqueuePoll(work: RecordingWork): Promise<void>;
};
export type RecordingPorts = {
  /** Read Committed, same quota/member + job/attempt lock; callback failure rolls everything back.
   * Load current identity, node permission, collection and BOW-860 revision inside it.
   * Persist media job status alongside saveRun: needs_review=awaiting_manual, never partial.
   * No external calls inside the callback; do not substitute the upload getter for authorization.
   */
  transaction<T>(
    recordingId: string,
    callback: (tx: RecordingTransaction) => Promise<T>,
  ): Promise<T>;
  readValidatedUpload(reference: {
    uploadId: string;
    originalVersionId: string;
  }): Promise<ArchivedUpload | null>;
  /** Read authorized archived bytes, decode/probe actual media, recompute digest + byte length.
   * Do not derive duration from upload metadata, filename or a default value.
   */
  inspectAudio(upload: ArchivedUpload): Promise<InspectedAudio>;
  /** Existing Kodo signer only; capability is ephemeral, never persisted or logged. */
  prepareSource(
    upload: ArchivedUpload,
    media: InspectedAudio,
  ): Promise<OfflineInput['source']>;
  transcriber: OfflineTranscriber;
  allocateId(): string;
};
