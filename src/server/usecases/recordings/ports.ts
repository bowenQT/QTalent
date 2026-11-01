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
  /** Complete immutable inventory, including providerSpeakerId:null fragments; never filter them.
   * Only a real manual binding/irrelevant ledger resolves unknown identity. A UI review key is not a person ID.
   * The 859 persistence adapter creates initial pending rows/candidates when storing the transcript.
   * The 860 adapter resolves them only from its committed, version/revision-matched manual ledger.
   */
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
   * Persist claim/claimExpiresAt with the run; compare/take over under this same lock.
   * claim is the last owner's fence, not an active flag: claimExpiresAt:null releases it.
   * No external calls inside the callback; do not substitute the upload getter for authorization.
   */
  transaction<T>(
    recordingId: string,
    callback: (tx: RecordingTransaction) => Promise<T>,
  ): Promise<T>;
  /** Trusted UTC execution clock, read under the transaction lock. Use one consistent
   * server/DB time domain across workers; never createClock('demo'|'test') or client time.
   * This clock does not replace the existing current-permission/business clock.
   */
  now(): string;
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
