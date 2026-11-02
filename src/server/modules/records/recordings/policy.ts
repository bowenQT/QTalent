import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MEDIA_FORMATS, speakerItemSchema } from '../../../../contracts/media';
import type { SpeakerItem } from '../../../../contracts/media';
import { sourceReferenceSchema } from '../../../../contracts/sources';
import type { OfflineTranscript } from '../../../integrations/tingwu/offline';
import type {
  ArchivedUpload,
  InspectedAudio,
  RecordingBindings,
  RecordingContext,
  RecordingFailure,
  RecordingRun,
  RecordingTranscript,
  RecordingWork,
} from './types';

const id = z.string().min(1).max(200).regex(/\S/);
const positive = z.number().int().positive();
const inspection = z.strictObject({
  originalVersionId: id,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteLength: positive.max(2 * 1024 ** 3),
  format: z.enum(['mp3', 'm4a', 'wav', 'aac']),
  durationMs: positive.max(21600000),
});
export class RecordingError extends Error {
  constructor(readonly code: RecordingFailure) {
    super(code);
    this.name = 'RecordingError';
  }
}
export function recordingKey(kind: string, ...ids: (string | number)[]) {
  return `${kind}:${createHash('sha256').update(JSON.stringify(ids)).digest('hex')}`;
}
export function initialRecordingRun(input: {
  recordingId: string;
  uploadId: string;
  originalId: string;
  originalVersionId: string;
  jobId: string;
}): RecordingRun {
  const parsed = z
    .strictObject({
      recordingId: id,
      uploadId: id,
      originalId: id,
      originalVersionId: id,
      jobId: id,
    })
    .parse(input);
  return {
    ...parsed,
    uploadJobId: parsed.jobId,
    attempt: 1,
    pollSequence: 0,
    phase: 'queued',
    claim: null,
    claimExpiresAt: null,
    recordCollectionId: null,
    bindingRevision: null,
    submission: 'not_started',
    providerTaskId: null,
    media: null,
    transcript: null,
    shapingJobId: null,
    failure: null,
  };
}
export function matchesWork(run: RecordingRun, work: RecordingWork) {
  return (
    run.recordingId === work.recordingId &&
    run.jobId === work.jobId &&
    run.attempt === work.attempt
  );
}
export function contextFailure(
  run: RecordingRun,
  context: RecordingContext | null,
): RecordingFailure | null {
  if (
    !context ||
    context.recordingId !== run.recordingId ||
    context.jobId !== run.jobId ||
    context.attempt !== run.attempt ||
    context.originalVersionId !== run.originalVersionId ||
    !id.safeParse(context.recordCollectionId).success ||
    !positive.safeParse(context.bindingRevision).success ||
    (run.recordCollectionId !== null &&
      run.recordCollectionId !== context.recordCollectionId)
  )
    return 'missing_context';
  if (!context.canProcess) return 'forbidden';
  if (
    run.bindingRevision !== null &&
    run.bindingRevision !== context.bindingRevision
  )
    return 'binding_changed';
  return null;
}
export function validateArchive(
  run: RecordingRun,
  upload: ArchivedUpload | null,
  media: InspectedAudio,
): InspectedAudio {
  const p = inspection.safeParse(media);
  if (
    !upload ||
    !p.success ||
    upload.purpose !== 'audio' ||
    upload.uploadId !== run.uploadId ||
    upload.jobId !== run.uploadJobId ||
    upload.originalId !== run.originalId ||
    upload.originalVersionId !== run.originalVersionId ||
    p.data.originalVersionId !== run.originalVersionId ||
    upload.object.sha256 !== p.data.sha256 ||
    upload.object.byteLength !== p.data.byteLength ||
    !MEDIA_FORMATS.some(
      (f) =>
        f.purpose === 'audio' &&
        f.extension === p.data.format &&
        f.mediaTypes.some((m) => m === upload.object.mediaType),
    )
  )
    throw new RecordingError('invalid_archive');
  return p.data;
}
export function createRecordingTranscript(
  run: RecordingRun,
  result: OfflineTranscript,
  allocateId: () => string,
): RecordingTranscript {
  if (
    result.kind !== 'offline' ||
    !run.media ||
    result.providerTaskId !== run.providerTaskId ||
    !Number.isSafeInteger(result.durationMs) ||
    result.durationMs <= 0 ||
    result.durationMs > run.media.durationMs ||
    !result.segments.length
  )
    throw new RecordingError('invalid_transcript');
  const sentenceIds = new Set<string>();
  const fragments = result.segments.map((s) => {
    const source = sourceReferenceSchema.safeParse({
      fragmentId: allocateId(),
      originalVersionId: run.originalVersionId,
      location: { kind: 'recording', startMs: s.startMs, endMs: s.endMs },
    });
    if (
      !source.success ||
      !id.safeParse(s.providerSentenceId).success ||
      sentenceIds.has(s.providerSentenceId) ||
      !s.text.trim() ||
      s.endMs > result.durationMs ||
      (s.speakerId !== null && !id.safeParse(s.speakerId).success)
    )
      throw new RecordingError('invalid_transcript');
    sentenceIds.add(s.providerSentenceId);
    return {
      source: source.data,
      quote: s.text,
      providerSentenceId: s.providerSentenceId,
      providerSpeakerId: s.speakerId,
      reviewItemId: id.parse(allocateId()),
    };
  });
  return {
    id: id.parse(allocateId()),
    recordingId: run.recordingId,
    originalVersionId: run.originalVersionId,
    providerTaskId: result.providerTaskId,
    durationMs: run.media.durationMs,
    fragments,
  };
}

/** Only unresolved fragments go to review. Provider speaker IDs never bind people. */
export function speakerReview(
  transcript: RecordingTranscript,
  bindings: RecordingBindings,
  revision: number,
): SpeakerItem[] {
  if (
    bindings.revision !== revision ||
    bindings.resolutions.length !== transcript.fragments.length
  )
    throw new RecordingError('invalid_bindings');
  const resolutions = new Map(
    bindings.resolutions.map((r) => [r.fragmentId, r]),
  );
  if (resolutions.size !== bindings.resolutions.length)
    throw new RecordingError('invalid_bindings');
  return transcript.fragments.flatMap((fragment) => {
    const r = resolutions.get(fragment.source.fragmentId);
    if (!r || (r.state === 'bound' && !id.safeParse(r.personId).success))
      throw new RecordingError('invalid_bindings');
    if (r.state === 'bound' || r.state === 'irrelevant') return [];
    const parsed = speakerItemSchema.safeParse({
      kind: 'speaker',
      itemId: fragment.reviewItemId,
      recordingId: transcript.recordingId,
      transcriptVersionId: transcript.id,
      source: fragment.source,
      quote: fragment.quote,
      speakerId: fragment.providerSpeakerId ?? fragment.source.fragmentId,
      bindingRevision: revision,
      candidates: r.candidates,
      state: r.state,
    });
    if (!parsed.success) throw new RecordingError('invalid_bindings');
    return [parsed.data];
  });
}
