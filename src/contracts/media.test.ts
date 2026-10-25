import { describe, expect, it } from 'vitest';
import {
  uploadRequestSchema,
  uploadBatchSchema,
  uploadGrantSchema,
  completeUploadSchema,
  mediaReadSchema,
  mediaJobSnapshotSchema,
  attachmentParseResultSchema,
  speakerItemSchema,
  speakerCommandSchema,
  bindingResultSchema,
  offlineTranscriptInputSchema,
  recordingClientMessageSchema,
  recordingServerMessageSchema,
  MAX_UPLOAD_BYTES,
  readOriginalSchema,
  uploadCompletedSchema,
  MEDIA_FORMATS,
  resumeRecordingProcessingSchema,
  requestUploadResultSchema,
} from './media';

const source = {
  fragmentId: 'demo-fragment',
  originalVersionId: 'demo-original-v1',
  location: { kind: 'recording', startMs: 0, endMs: 1200 },
};
const file = {
  purpose: 'audio',
  recordCollectionId: 'demo-collection',
  filename: 'demo.wav',
  declaredBytes: 128,
  declaredMediaType: 'audio/wav',
  target: { kind: 'people', personIds: ['demo-person'] },
  operationId: 'op-1',
};
const speaker = {
  kind: 'speaker',
  itemId: 'demo-item',
  recordingId: 'demo-recording',
  transcriptVersionId: 'demo-transcript-v1',
  source,
  quote: '演示：今天核对了三条测试记录。',
  speakerId: 'speaker-1',
  bindingRevision: 1,
  state: 'pending',
  candidates: [{ personId: 'demo-person', displayName: '演示学员' }],
};
const job = {
  schemaVersion: 1,
  jobId: 'job-1',
  kind: 'media',
  status: 'awaiting_manual',
  attempt: 1,
  revision: 1,
  updatedAt: '2026-10-25T00:00:00Z',
  progress: null,
  result: {
    stage: 'needs_review',
    mediaId: 'demo-recording',
    source: null,
    fragmentIds: [],
  },
  error: null,
  canRetry: false,
  canCancel: true,
  cancelRequestedAt: null,
};

describe('BOW-858 media contracts', () => {
  it('accepts only the requested seven formats, preserving declared metadata', () => {
    for (const entry of MEDIA_FORMATS) {
      expect(
        uploadRequestSchema.parse({
          ...file,
          purpose: entry.purpose,
          filename: `demo.${entry.extension}`,
          declaredMediaType: entry.mediaTypes[0],
        }).filename,
      ).toBe(`demo.${entry.extension}`);
    }
    for (const patch of [
      { filename: 'demo.xlsx' },
      { filename: 'demo.wav.exe' },
      { declaredMediaType: 'application/pdf' },
      { purpose: 'attachment' },
      { filename: '../../demo.wav' },
      { target: { kind: 'people', personIds: [] } },
      { target: { kind: 'people', personIds: ['p', 'p'] } },
      { bucket: 'other' },
    ])
      expect(uploadRequestSchema.safeParse({ ...file, ...patch }).success).toBe(
        false,
      );
  });
  it('enforces positive integer bytes and cumulative attachment count', () => {
    for (const bytes of [0, -1, 1.5, MAX_UPLOAD_BYTES + 1])
      expect(
        uploadRequestSchema.safeParse({ ...file, declaredBytes: bytes })
          .success,
      ).toBe(false);
    expect(
      uploadRequestSchema.safeParse({
        ...file,
        declaredBytes: MAX_UPLOAD_BYTES,
      }).success,
    ).toBe(true);
    expect(
      uploadBatchSchema.safeParse({ existingAttachmentCount: 9, files: [file] })
        .success,
    ).toBe(true);
    expect(
      uploadBatchSchema.safeParse({
        existingAttachmentCount: 10,
        files: [file],
      }).success,
    ).toBe(false);
    expect(
      uploadBatchSchema.safeParse({ existingAttachmentCount: 0, files: [] })
        .success,
    ).toBe(false);
  });
  it('requires revisions for writes and never accepts client success as completion', () => {
    const complete = {
      uploadId: 'upload-1',
      receiptRef: 'opaque-receipt',
      operationId: 'op',
      expectedRevision: 1,
    };
    expect(completeUploadSchema.safeParse(complete).success).toBe(true);
    expect(
      completeUploadSchema.safeParse({
        ...complete,
        expectedRevision: undefined,
      }).success,
    ).toBe(false);
    expect(
      completeUploadSchema.safeParse({ ...complete, success: true }).success,
    ).toBe(false);
  });
  it('preserves the stable collection lookup independently of the target', () => {
    for (const recordCollectionId of [
      'demo-collection-a',
      'demo-collection-b',
    ]) {
      expect(
        uploadRequestSchema.parse({ ...file, recordCollectionId }),
      ).toMatchObject({ recordCollectionId, target: file.target });
    }
  });
  it('requires the collection lookup and rejects empty or caller-supplied quota authority', () => {
    const input = { ...file, recordCollectionId: 'demo-collection' };
    const missing = { ...input };
    Reflect.deleteProperty(missing, 'recordCollectionId');
    for (const value of [
      missing,
      { ...input, recordCollectionId: '' },
      { ...input, recordCollectionId: '   ' },
      { ...input, quotaScope: 'client-selected-quota' },
    ]) {
      expect(uploadRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it('echoes a required collection lookup in grants and completed uploads', () => {
    const recordCollectionId = 'demo-collection';
    const grant = {
      uploadId: 'demo-upload',
      recordCollectionId,
      revision: 1,
      expiresAt: '2026-10-25T01:00:00Z',
      method: 'form',
      uploadEndpoint: 'https://upload.example.test',
      uploadToken: 'scoped-token',
      objectKey: 'assigned-key',
      maxBytes: 128,
    };
    const completed = {
      uploadId: 'demo-upload',
      recordCollectionId,
      originalId: 'demo-original',
      originalVersionId: 'demo-original-v1',
      source: null,
      jobId: 'demo-job',
      revision: 1,
    };
    expect(uploadGrantSchema.parse(grant)).toMatchObject({
      recordCollectionId,
    });
    expect(uploadCompletedSchema.parse(completed)).toMatchObject({
      recordCollectionId,
    });
    for (const [schema, value] of [
      [uploadGrantSchema, grant],
      [uploadCompletedSchema, completed],
    ] as const) {
      const missing = { ...value };
      Reflect.deleteProperty(missing, 'recordCollectionId');
      expect(schema.safeParse(missing).success).toBe(false);
      expect(
        schema.safeParse({ ...value, recordCollectionId: '' }).success,
      ).toBe(false);
    }
  });
  it('keeps the 2 GiB product boundary separate from adapter availability', () => {
    expect(
      uploadRequestSchema.safeParse({ ...file, declaredBytes: 1024 ** 3 + 1 })
        .success,
    ).toBe(true);
    expect(
      requestUploadResultSchema.safeParse({
        status: 'unavailable',
        message: '上传能力待接通',
      }).success,
    ).toBe(true);
    expect(
      requestUploadResultSchema.safeParse({
        status: 'unsupported',
        message: '暂不支持',
      }).success,
    ).toBe(false);
  });
  it('confines direct upload grant to scoped token; no server keys or read signature', () => {
    const grant = {
      uploadId: 'u',
      recordCollectionId: 'demo-collection',
      revision: 1,
      expiresAt: '2026-10-25T01:00:00Z',
      method: 'form',
      uploadEndpoint: 'https://upload.example.test',
      uploadToken: 'scoped-token',
      objectKey: 'assigned-key',
      maxBytes: 128,
    };
    expect(uploadGrantSchema.safeParse(grant).success).toBe(true);
    for (const patch of [
      { secretKey: 'secret' },
      { readUrl: 'https://private.test?sign=x' },
      { uploadEndpoint: 'http://upload.test' },
      { maxBytes: MAX_UPLOAD_BYTES + 1 },
    ])
      expect(uploadGrantSchema.safeParse({ ...grant, ...patch }).success).toBe(
        false,
      );
  });
  it('reuses strict jobs snapshot, keeping manual wait distinct from machine work', () => {
    expect(mediaJobSnapshotSchema.safeParse(job).success).toBe(true);
    for (const patch of [
      { status: 'partial' },
      { result: { ...job.result, stage: 'completed' } },
      { result: { ...job.result, providerTaskId: 'private' } },
      { cancelRequestedAt: undefined },
    ])
      expect(
        mediaJobSnapshotSchema.safeParse({ ...job, ...patch }).success,
      ).toBe(false);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'running',
        result: { ...job.result, stage: 'transcribing' },
      }).success,
    ).toBe(true);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'partial',
        result: { ...job.result, stage: 'shaping' },
      }).success,
    ).toBe(true);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'completed',
        result: { ...job.result, stage: 'completed' },
      }).success,
    ).toBe(true);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'cancelled',
        result: { ...job.result, stage: 'cancelled' },
      }).success,
    ).toBe(true);
  });
  it('checks complete version identity and safe byte ranges', () => {
    const completed = {
      uploadId: 'u',
      recordCollectionId: 'demo-collection',
      originalId: 'o',
      originalVersionId: 'v',
      source: { fragmentId: 'f', originalVersionId: 'v' },
      jobId: 'j',
      revision: 1,
    };
    expect(uploadCompletedSchema.safeParse(completed).success).toBe(true);
    expect(
      uploadCompletedSchema.safeParse({
        ...completed,
        source: { fragmentId: 'f', originalVersionId: 'other' },
      }).success,
    ).toBe(false);
    for (const read of [
      { fragmentId: 'f', originalVersionId: 'v' },
      { originalId: 'o', originalVersionId: 'v' },
    ]) {
      for (const range of [
        undefined,
        { start: 0 },
        { start: 5, endInclusive: 5 },
        { start: 5, endInclusive: 9 },
      ])
        expect(readOriginalSchema.safeParse({ ...read, range }).success).toBe(
          true,
        );
      for (const range of [
        { start: 5, endInclusive: 4 },
        { start: -1 },
        { start: 0, unexpected: true },
      ])
        expect(readOriginalSchema.safeParse({ ...read, range }).success).toBe(
          false,
        );
    }
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'ready',
        sessionId: 's',
        nextExpectedSequence: 2,
        archivedThrough: 1,
      }).success,
    ).toBe(true);
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'ready',
        sessionId: 's',
        nextExpectedSequence: 3,
        archivedThrough: 1,
      }).success,
    ).toBe(false);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'queued',
        result: { ...job.result, stage: 'queued' },
      }).success,
    ).toBe(true);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'failed',
        result: { ...job.result, stage: 'failed' },
      }).success,
    ).toBe(true);
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status: 'queued',
        result: null,
      }).success,
    ).toBe(true);
  });
  it('requires original identity and keeps provider IDs out of authorized read DTO', () => {
    const value = {
      mediaId: 'm',
      kind: 'recording',
      filename: 'demo.wav',
      originalVersionId: 'demo-original-v1',
      revision: 1,
      job: null,
      fragments: [{ ...source, excerpt: '演示引文' }],
      parseVersionId: null,
    };
    expect(mediaReadSchema.safeParse(value).success).toBe(true);
    expect(
      mediaReadSchema.safeParse({ ...value, providerTaskId: 'secret' }).success,
    ).toBe(false);
    expect(
      mediaReadSchema.safeParse({
        ...value,
        fragments: [
          {
            ...source,
            originalVersionId: 'other-version',
            excerpt: '演示引文',
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('allows an archived original to complete before any real source fragment exists', () => {
    const completed = {
      uploadId: 'demo-upload',
      recordCollectionId: 'demo-collection',
      originalId: 'demo-original',
      originalVersionId: 'demo-original-v1',
      source: null,
      jobId: 'demo-job',
      revision: 1,
    };
    expect(uploadCompletedSchema.safeParse(completed).success).toBe(true);
    expect(
      uploadCompletedSchema.safeParse({ ...completed, source: undefined })
        .success,
    ).toBe(false);
  });
  it('constructs an original read from a completed upload with no source fragment', () => {
    const completed = uploadCompletedSchema.parse({
      uploadId: 'demo-upload',
      recordCollectionId: 'demo-collection',
      originalId: 'demo-original',
      originalVersionId: 'demo-original-v1',
      source: null,
      jobId: 'demo-job',
      revision: 1,
    });
    expect(
      readOriginalSchema.safeParse({
        originalId: completed.originalId,
        originalVersionId: completed.originalVersionId,
      }).success,
    ).toBe(true);
  });
  it('rejects mixed, missing and unknown original read identities', () => {
    for (const input of [
      { originalVersionId: 'v' },
      { originalId: 'o' },
      { fragmentId: 'f' },
      { originalId: 'o', fragmentId: 'f', originalVersionId: 'v' },
      { originalId: '', originalVersionId: 'v' },
      { fragmentId: '', originalVersionId: 'v' },
      { originalId: 'o', originalVersionId: '   ' },
      { originalId: 'o', originalVersionId: 'v', ownerId: 'caller' },
      { fragmentId: 'f', originalVersionId: 'v', ownerId: 'caller' },
    ])
      expect(readOriginalSchema.safeParse(input).success).toBe(false);
  });
  it('does not accept scanned or failed parsing as empty success', () => {
    expect(
      attachmentParseResultSchema.safeParse({
        status: 'unsupported',
        reason: 'scanned',
        message: '暂不支持',
      }).success,
    ).toBe(true);
    expect(
      attachmentParseResultSchema.safeParse({
        status: 'parsed',
        parseVersionId: 'v',
        fragments: [],
      }).success,
    ).toBe(false);
    expect(
      attachmentParseResultSchema.safeParse({
        status: 'parsed',
        parseVersionId: 'v',
        fragments: [
          {
            fragmentId: 'f',
            originalVersionId: 'v',
            location: { kind: 'document', paragraph: '3' },
            excerpt: '演示文字',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      attachmentParseResultSchema.safeParse({
        status: 'parsed',
        parseVersionId: 'v',
        fragments: [{ ...source, excerpt: 'wrong type' }],
      }).success,
    ).toBe(false);
  });
  it('models only speaker review and explicit bind/defer/irrelevant/unbind actions', () => {
    expect(speakerItemSchema.safeParse(speaker).success).toBe(true);
    expect(
      speakerItemSchema.safeParse({ ...speaker, kind: 'person_name' }).success,
    ).toBe(false);
    expect(
      speakerItemSchema.safeParse({
        ...speaker,
        source: { ...source, location: { kind: 'document', paragraph: '1' } },
      }).success,
    ).toBe(false);
    for (const action of ['defer', 'mark_irrelevant', 'unbind'])
      expect(
        speakerCommandSchema.safeParse({
          action,
          itemId: 'i',
          operationId: 'op',
          expectedRevision: 1,
        }).success,
      ).toBe(true);
    expect(
      speakerCommandSchema.safeParse({
        action: 'bind',
        itemId: 'i',
        personId: 'p',
        operationId: 'op',
        expectedRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      speakerCommandSchema.safeParse({
        action: 'bind',
        itemId: 'i',
        operationId: 'op',
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      speakerCommandSchema.safeParse({
        action: 'defer',
        itemId: 'i',
        personId: 'p',
        operationId: 'op',
        expectedRevision: 1,
      }).success,
    ).toBe(false);
    expect(
      bindingResultSchema.safeParse({
        status: 'success',
        item: { ...speaker, state: 'bound', personId: 'demo-person' },
        invalidatedDraftIds: ['draft-1'],
        confirmedResultsRequireRevision: true,
        resumeJobId: null,
      }).success,
    ).toBe(true);
  });
  it('separates preview captions from offline extraction input', () => {
    expect(
      offlineTranscriptInputSchema.safeParse({
        kind: 'offline_transcript',
        recordingId: 'r',
        originalVersionId: 'v',
        transcriptVersionId: 't',
        bindingRevision: 1,
      }).success,
    ).toBe(true);
    expect(
      offlineTranscriptInputSchema.safeParse({
        kind: 'preview',
        sessionId: 's',
        text: 'preview',
      }).success,
    ).toBe(false);
  });
  it('requires the binding revision instead of a client claim that every speaker is resolved', () => {
    const resume = {
      recordingId: 'demo-recording',
      transcriptVersionId: 'demo-transcript-v1',
      bindingRevision: 1,
      operationId: 'resume-1',
    };
    expect(resumeRecordingProcessingSchema.safeParse(resume).success).toBe(
      true,
    );
    expect(
      resumeRecordingProcessingSchema.safeParse({
        ...resume,
        bindingRevision: undefined,
        allSpeakersResolved: true,
      }).success,
    ).toBe(false);
    expect(
      resumeRecordingProcessingSchema.safeParse({
        ...resume,
        allSpeakersResolved: true,
      }).success,
    ).toBe(false);
  });
  it('validates browser protocol and archival acknowledgements independently of provider final', () => {
    expect(
      recordingClientMessageSchema.safeParse({
        type: 'hello',
        protocolVersion: 1,
        recordingId: 'r',
        lastAckedSequence: 0,
      }).success,
    ).toBe(true);
    const chunk = {
      type: 'chunk',
      sessionId: 's',
      sequence: 1,
      sha256: 'a'.repeat(64),
      byteLength: 3200,
      format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    };
    expect(recordingClientMessageSchema.safeParse(chunk).success).toBe(true);
    expect(
      recordingClientMessageSchema.safeParse({ ...chunk, sequence: 0 }).success,
    ).toBe(false);
    expect(
      recordingClientMessageSchema.safeParse({
        ...chunk,
        format: { ...chunk.format, channels: 2 },
      }).success,
    ).toBe(false);
    expect(
      recordingClientMessageSchema.safeParse({ ...chunk, byteLength: 3 })
        .success,
    ).toBe(false);
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'ack',
        sessionId: 's',
        sequence: 1,
        archivedThrough: 1,
        sha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'preview',
        sessionId: 's',
        utteranceId: 'u',
        revision: 1,
        text: '演示预览',
        finalWithinPreview: true,
      }).success,
    ).toBe(true);
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'archived',
        sessionId: 's',
        originalVersionId: 'v',
        jobId: 'j',
        lastSequence: 1,
      }).success,
    ).toBe(true);
  });
  it('acknowledges an older retransmitted sequence with the cumulative archive watermark', () => {
    expect(
      recordingServerMessageSchema.safeParse({
        type: 'ack',
        sessionId: 's',
        sequence: 2,
        archivedThrough: 3,
        sha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
  });
  it.each([
    ['running', 'parsing'],
    ['partial', 'parsing'],
    ['completed', 'parsed'],
    ['failed', 'unsupported'],
  ])('maps attachment execution %s to media stage %s', (status, stage) => {
    expect(
      mediaJobSnapshotSchema.safeParse({
        ...job,
        status,
        result: { ...job.result, stage },
      }).success,
    ).toBe(true);
  });
  it.each([
    ['completed', 'parsing'],
    ['running', 'parsed'],
    ['completed', 'unsupported'],
    ['awaiting_manual', 'parsing'],
  ])(
    'rejects inconsistent attachment execution %s and stage %s',
    (status, stage) => {
      expect(
        mediaJobSnapshotSchema.safeParse({
          ...job,
          status,
          result: { ...job.result, stage },
        }).success,
      ).toBe(false);
    },
  );
});
