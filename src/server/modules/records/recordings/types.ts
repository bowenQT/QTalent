import type { z } from 'zod';
import type { SourceReference } from '../../../../contracts/sources';
import type {
  offlineTranscriptInputSchema,
  resumeRecordingProcessingSchema,
} from '../../../../contracts/media';
import type { ValidatedUpload } from '../uploads/handoff';

export type ArchivedUpload = ValidatedUpload;
export type OfflineDraftInput = z.infer<typeof offlineTranscriptInputSchema>;
export type ResumeRecording = z.infer<typeof resumeRecordingProcessingSchema>;
export type RecordingWork = {
  recordingId: string;
  jobId: string;
  attempt: number;
} & (
  | { action: 'process'; pollSequence: number }
  | ({ action: 'resume' } & Omit<ResumeRecording, 'recordingId'>)
);

/** Facts produced by decoding the archived version, never upload declarations. */
export type InspectedAudio = {
  originalVersionId: string;
  sha256: string;
  byteLength: number;
  format: 'mp3' | 'm4a' | 'wav' | 'aac';
  durationMs: number;
};
export type TranscriptFragment = {
  source: SourceReference;
  quote: string;
  providerSentenceId: string;
  providerSpeakerId: string | null;
  reviewItemId: string;
};
export type RecordingTranscript = {
  id: string;
  recordingId: string;
  originalVersionId: string;
  providerTaskId: string;
  durationMs: number;
  fragments: TranscriptFragment[];
};
export type SpeakerResolution = { fragmentId: string } & (
  | { state: 'bound'; personId: string }
  | { state: 'irrelevant' }
  | {
      state: 'pending' | 'deferred';
      candidates: { personId: string; displayName: string }[];
    }
);
export type RecordingBindings = {
  revision: number;
  resolutions: SpeakerResolution[];
};

/** Loaded under the real job + collection locks in the same native transaction. */
export type RecordingContext = {
  recordingId: string;
  jobId: string;
  attempt: number;
  originalVersionId: string;
  recordCollectionId: string;
  bindingRevision: number;
  canProcess: boolean;
  cancelRequested: boolean;
  /** BOW-860's committed resume ledger, not the incoming command. */
  resumeGrant: ResumeRecording | null;
};
export type RecordingFailure =
  | 'missing_context'
  | 'forbidden'
  | 'binding_changed'
  | 'invalid_archive'
  | 'invalid_transcript'
  | 'invalid_bindings'
  | 'submission_unknown'
  | 'provider_failed'
  | 'provider_unavailable'
  | 'poll_limit';
export type RecordingRun = {
  recordingId: string;
  jobId: string;
  uploadJobId: string;
  uploadId: string;
  originalId: string;
  originalVersionId: string;
  attempt: number;
  pollSequence: number;
  phase:
    | 'queued'
    | 'transcribing'
    | 'needs_review'
    | 'shaping'
    | 'failed'
    | 'cancelled';
  /** Last execution's fencing identity; retained after release for task receipt checks. */
  claim: string | null;
  /** Non-null only while this owner has a lease. UTC execution time, not demo/business time. */
  claimExpiresAt: string | null;
  recordCollectionId: string | null;
  bindingRevision: number | null;
  submission: 'not_started' | 'reserved';
  providerTaskId: string | null;
  media: InspectedAudio | null;
  transcript: RecordingTranscript | null;
  shapingJobId: string | null;
  failure: RecordingFailure | null;
};
