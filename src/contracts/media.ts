import { z } from 'zod';
import { createJobSnapshotSchema, jobCommandSchema } from './jobs';
import { sourceReadInputSchema, sourceReferenceSchema } from './sources';

export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
export const MAX_ATTACHMENTS = 10;
export const MEDIA_FORMATS = [
  {
    purpose: 'audio',
    extension: 'mp3',
    mediaTypes: ['audio/mpeg', 'audio/mp3'],
  },
  {
    purpose: 'audio',
    extension: 'm4a',
    mediaTypes: ['audio/mp4', 'audio/x-m4a'],
  },
  {
    purpose: 'audio',
    extension: 'wav',
    mediaTypes: ['audio/wav', 'audio/x-wav', 'audio/wave'],
  },
  {
    purpose: 'audio',
    extension: 'aac',
    mediaTypes: ['audio/aac', 'audio/x-aac'],
  },
  { purpose: 'attachment', extension: 'txt', mediaTypes: ['text/plain'] },
  {
    purpose: 'attachment',
    extension: 'docx',
    mediaTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
  },
  { purpose: 'attachment', extension: 'pdf', mediaTypes: ['application/pdf'] },
] as const;
const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).regex(/\S/);
const revision = z.number().int().positive();
const operation = { operationId: id, expectedRevision: revision };
const bytes = z.number().int().positive().max(MAX_UPLOAD_BYTES);
const uniqueIds = z.array(id).refine((ids) => new Set(ids).size === ids.length);
const uploadTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('people'), personIds: uniqueIds.min(1) }),
  z.strictObject({ kind: z.literal('event'), eventId: id }),
]);
/** Declaration validation only. BOW-873 must verify content, authorization and persisted count. */
export const uploadRequestSchema = z
  .strictObject({
    purpose: z.enum(['audio', 'attachment']),
    filename: text.refine((name) => !/[\\/\0]/.test(name)),
    declaredBytes: bytes,
    declaredMediaType: text,
    target: uploadTargetSchema,
    operationId: id,
  })
  .refine(
    (value) =>
      MEDIA_FORMATS.some(
        (format) =>
          value.purpose === format.purpose &&
          value.filename.toLowerCase().endsWith(`.${format.extension}`) &&
          (format.mediaTypes as readonly string[]).includes(
            value.declaredMediaType.toLowerCase(),
          ),
      ),
    '暂不支持，请上传 MP3、M4A、WAV、AAC、TXT、DOCX 或文字型 PDF',
  );
export const uploadBatchSchema = z
  .strictObject({
    existingAttachmentCount: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_ATTACHMENTS),
    files: z.array(uploadRequestSchema).min(1).max(MAX_ATTACHMENTS),
  })
  .refine(
    (value) =>
      value.existingAttachmentCount + value.files.length <= MAX_ATTACHMENTS,
  );
/** Scoped write token is intentional; never include the signing key or private read URL. */
export const uploadGrantSchema = z.strictObject({
  uploadId: id,
  revision,
  expiresAt: z.iso.datetime(),
  method: z.enum(['form', 'resumable_v2']),
  uploadEndpoint: z.url().startsWith('https://'),
  uploadToken: text,
  objectKey: id,
  maxBytes: bytes,
});
export const completeUploadSchema = z.strictObject({
  uploadId: id,
  receiptRef: id,
  ...operation,
});
export const uploadCompletedSchema = z
  .strictObject({
    uploadId: id,
    originalId: id,
    originalVersionId: id,
    source: sourceReadInputSchema,
    jobId: id,
    revision,
  })
  .refine((x) => x.originalVersionId === x.source.originalVersionId);
const failureSchema = z.strictObject({
  status: z.enum([
    'unauthenticated',
    'forbidden',
    'not_found',
    'conflict',
    'unavailable',
  ]),
  message: text,
});
export const requestUploadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('success'), upload: uploadGrantSchema }),
  z.strictObject({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  failureSchema,
]);
export const completeUploadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    result: uploadCompletedSchema,
  }),
  z.strictObject({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  failureSchema,
]);
export const readOriginalSchema = sourceReadInputSchema.extend({
  range: z
    .strictObject({
      start: z.number().int().nonnegative(),
      endInclusive: z.number().int().nonnegative().optional(),
    })
    .refine(
      (range) =>
        range.endInclusive === undefined || range.endInclusive >= range.start,
    )
    .optional(),
});
const fragmentSchema = sourceReferenceSchema.extend({ excerpt: text });
const documentFragmentSchema = fragmentSchema.refine(
  (x) => x.location.kind === 'document',
);
const recordingSourceSchema = sourceReferenceSchema.refine(
  (x) => x.location.kind === 'recording',
);
export const mediaStageSchema = z.enum([
  'queued',
  'transcribing',
  'parsing',
  'shaping',
  'needs_review',
  'completed',
  'parsed',
  'unsupported',
  'failed',
  'cancelled',
]);
const mediaJobResultSchema = z.strictObject({
  stage: mediaStageSchema,
  mediaId: id,
  source: sourceReadInputSchema.nullable(),
  fragmentIds: uniqueIds,
});
/** No browser upload byte progress or arbitrary provider JSON in a persisted job snapshot. */
export const mediaJobSnapshotSchema = createJobSnapshotSchema(
  'media',
  mediaJobResultSchema,
).refine((snapshot) => {
  if (snapshot.result === null) return true;
  const stage = snapshot.result.stage;
  switch (snapshot.status) {
    case 'queued':
      return stage === 'queued';
    case 'running':
    case 'partial':
      return (
        stage === 'transcribing' || stage === 'parsing' || stage === 'shaping'
      );
    case 'awaiting_manual':
      return stage === 'needs_review';
    case 'completed':
      return stage === 'completed' || stage === 'parsed';
    case 'cancelled':
      return stage === 'cancelled';
    case 'failed':
      return stage === 'failed' || stage === 'unsupported';
  }
}, '处理阶段须与后台任务状态一致');
export const mediaProcessingCommandSchema = jobCommandSchema;
export const mediaReadInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('recording'), recordingId: id }),
  z.strictObject({ kind: z.literal('attachment'), attachmentId: id }),
]);
export const mediaReadSchema = z
  .strictObject({
    mediaId: id,
    kind: z.enum(['recording', 'attachment']),
    filename: text,
    originalVersionId: id,
    revision,
    job: mediaJobSnapshotSchema.nullable(),
    parseVersionId: id.nullable(),
    fragments: z.array(fragmentSchema),
  })
  .refine((x) =>
    x.fragments.every(
      (fragment) => fragment.originalVersionId === x.originalVersionId,
    ),
  );
export const attachmentParseResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('parsed'),
    parseVersionId: id,
    fragments: z.array(documentFragmentSchema).min(1),
  }),
  z.strictObject({
    status: z.literal('unsupported'),
    reason: z.enum(['format', 'scanned']),
    message: text,
  }),
  z.strictObject({
    status: z.literal('failed'),
    code: z.enum(['invalid_content', 'processing_failed']),
    message: text,
  }),
]);
const speakerBase = {
  kind: z.literal('speaker'),
  itemId: id,
  recordingId: id,
  transcriptVersionId: id,
  source: recordingSourceSchema,
  quote: text,
  speakerId: id,
  bindingRevision: revision,
  candidates: z.array(z.strictObject({ personId: id, displayName: text })),
};
export const speakerItemSchema = z.discriminatedUnion('state', [
  z.strictObject({
    ...speakerBase,
    state: z.enum(['pending', 'deferred', 'irrelevant']),
  }),
  z.strictObject({ ...speakerBase, state: z.literal('bound'), personId: id }),
]);
export const speakerCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('bind'),
    itemId: id,
    personId: id,
    ...operation,
  }),
  z.strictObject({
    action: z.enum(['defer', 'mark_irrelevant', 'unbind']),
    itemId: id,
    ...operation,
  }),
]);
export const bindingResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    item: speakerItemSchema,
    invalidatedDraftIds: uniqueIds,
    confirmedResultsRequireRevision: z.boolean(),
    resumeJobId: id.nullable(),
  }),
  z.strictObject({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  failureSchema,
]);
/** All speakers resolved is checked transactionally by BOW-860, never inferred from a client boolean. */
export const resumeRecordingProcessingSchema = z.strictObject({
  recordingId: id,
  transcriptVersionId: id,
  bindingRevision: revision,
  operationId: id,
});
export const offlineTranscriptInputSchema = z.strictObject({
  kind: z.literal('offline_transcript'),
  recordingId: id,
  originalVersionId: id,
  transcriptVersionId: id,
  bindingRevision: revision,
});
export const reviewEntryAvailabilitySchema = z.strictObject({
  speaker: z.literal('connected'),
  personName: z.literal('not_connected'),
  project: z.literal('not_connected'),
});
const sequence = z.number().int().positive();
const watermark = z.number().int().nonnegative();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const pcmFormat = z.strictObject({
  encoding: z.literal('pcm_s16le'),
  sampleRate: z.literal(16000),
  channels: z.literal(1),
});
/** A JSON chunk header precedes one binary PCM frame. BOW-868 checks actual byte length/hash and configured frame cap. */
export const recordingClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.enum(['hello', 'resume']),
    protocolVersion: z.literal(1),
    recordingId: id,
    lastAckedSequence: watermark,
  }),
  z.strictObject({
    type: z.literal('chunk'),
    sessionId: id,
    sequence,
    sha256,
    byteLength: z
      .number()
      .int()
      .positive()
      .refine((n) => n % 2 === 0),
    format: pcmFormat,
  }),
  z.strictObject({
    type: z.enum(['pause', 'continue']),
    sessionId: id,
    operationId: id,
  }),
  z.strictObject({
    type: z.literal('finish'),
    sessionId: id,
    lastSequence: sequence,
    operationId: id,
  }),
]);
export const recordingServerMessageSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      type: z.literal('ready'),
      sessionId: id,
      nextExpectedSequence: sequence,
      archivedThrough: watermark,
    })
    .refine((x) => x.nextExpectedSequence === x.archivedThrough + 1),
  z.strictObject({
    type: z.literal('ack'),
    sessionId: id,
    sequence,
    archivedThrough: watermark,
    sha256,
  }),
  z.strictObject({
    type: z.literal('preview'),
    sessionId: id,
    utteranceId: id,
    revision,
    text,
    finalWithinPreview: z.boolean(),
  }),
  z.strictObject({
    type: z.enum(['paused', 'resumed', 'finishing']),
    sessionId: id,
    operationId: id,
  }),
  z.strictObject({
    type: z.literal('archived'),
    sessionId: id,
    originalVersionId: id,
    jobId: id,
    lastSequence: sequence,
  }),
  z.strictObject({
    type: z.literal('error'),
    sessionId: id,
    code: z.enum([
      'forbidden',
      'conflict',
      'missing_chunks',
      'invalid_audio',
      'unavailable',
    ]),
    message: text,
    retryable: z.boolean(),
    missingSequences: z.array(sequence),
  }),
]);
export type UploadRequest = z.infer<typeof uploadRequestSchema>;
export type UploadGrant = z.infer<typeof uploadGrantSchema>;
export type MediaRead = z.infer<typeof mediaReadSchema>;
export type MediaJobSnapshot = z.infer<typeof mediaJobSnapshotSchema>;
export type SpeakerItem = z.infer<typeof speakerItemSchema>;
export type SpeakerCommand = z.infer<typeof speakerCommandSchema>;
export type RecordingClientMessage = z.infer<
  typeof recordingClientMessageSchema
>;
export type RecordingServerMessage = z.infer<
  typeof recordingServerMessageSchema
>;
