import { describe, expect, it } from 'vitest';
import type { OfflineTranscript } from '../../../integrations/tingwu/offline';
import {
  contextFailure,
  createRecordingTranscript,
  initialRecordingRun,
  matchesWork,
  recordingKey,
  speakerReview,
  validateArchive,
} from './policy';
import type { ArchivedUpload, InspectedAudio, RecordingContext } from './types';

function facts() {
  const run = initialRecordingRun({
    recordingId: 'demo-recording',
    uploadId: 'demo-upload',
    originalId: 'demo-original',
    originalVersionId: 'demo-version',
    jobId: 'demo-job',
  });
  const media: InspectedAudio = {
    originalVersionId: run.originalVersionId,
    sha256: 'a'.repeat(64),
    byteLength: 256,
    durationMs: 10000,
    format: 'wav',
  };
  const upload: ArchivedUpload = {
    uploadId: run.uploadId,
    originalId: run.originalId,
    originalVersionId: run.originalVersionId,
    jobId: run.jobId,
    accountId: 'demo-account',
    quotaScope: 'opaque-quota-do-not-parse',
    purpose: 'audio',
    filename: '演示.wav',
    target: { kind: 'people', personIds: ['demo-person'] },
    object: {
      objectKey: 'demo/private/audio',
      byteLength: media.byteLength,
      sha256: media.sha256,
      mediaType: 'audio/wav',
      etag: 'demo-etag',
    },
  };
  const context: RecordingContext = {
    recordingId: run.recordingId,
    jobId: run.jobId,
    attempt: 1,
    originalVersionId: run.originalVersionId,
    recordCollectionId: 'demo-collection',
    bindingRevision: 1,
    canProcess: true,
    cancelRequested: false,
    resumeGrant: null,
  };
  const result: OfflineTranscript = {
    kind: 'offline',
    providerTaskId: 'demo-task',
    durationMs: 10000,
    text: '演示内容',
    segments: [
      {
        providerSentenceId: 'paragraph-a:1',
        speakerId: 'provider-local-speaker',
        startMs: 100,
        endMs: 600,
        text: '演示内容',
      },
    ],
  };
  let n = 0;
  run.media = media;
  run.providerTaskId = result.providerTaskId;
  return {
    run,
    media,
    upload,
    context,
    result,
    allocateId: () => `demo-${++n}`,
  };
}
describe('recording provenance policy', () => {
  it('keeps the archived version and exact provider sentence times without interpreting speaker identity', () => {
    const { run, result, allocateId } = facts();
    result.segments.push({
      ...result.segments[0],
      providerSentenceId: 'paragraph-b:1',
      startMs: 300,
      endMs: 900,
    });
    const t = createRecordingTranscript(run, result, allocateId);
    expect(t.fragments).toHaveLength(2);
    expect(t.fragments[0]).toMatchObject({
      source: {
        originalVersionId: run.originalVersionId,
        location: { kind: 'recording', startMs: 100, endMs: 600 },
      },
      providerSpeakerId: 'provider-local-speaker',
    });
    expect(t.fragments[0].source.fragmentId).not.toBe(
      t.fragments[1].source.fragmentId,
    );
  });
  it.each(['mp3', 'm4a', 'wav', 'aac'] as const)(
    'accepts inspected %s only with matching archived bytes/MIME',
    (format) => {
      const { run, upload, media } = facts();
      const mime = {
        mp3: 'audio/mpeg',
        m4a: 'audio/mp4',
        wav: 'audio/wav',
        aac: 'audio/aac',
      }[format];
      expect(
        validateArchive(
          run,
          { ...upload, object: { ...upload.object, mediaType: mime } },
          { ...media, format },
        ).format,
      ).toBe(format);
    },
  );
  it.each([
    { durationMs: 0 },
    { durationMs: -1 },
    { durationMs: 21600001 },
    { durationMs: 2.5 },
    { originalVersionId: 'other' },
    { sha256: 'b'.repeat(64) },
    { byteLength: 257 },
    { format: 'mp4' },
  ])(
    'rejects invalid inspection %j rather than inventing duration or dispatch',
    (patch) => {
      const { run, upload, media } = facts();
      expect(() =>
        validateArchive(run, upload, { ...media, ...patch } as InspectedAudio),
      ).toThrow('invalid_archive');
    },
  );
  it.each([
    'purpose',
    'jobId',
    'uploadId',
    'originalId',
    'originalVersionId',
    'mime',
  ] as const)('rejects archive %s mismatch', (field) => {
    const { run, upload, media } = facts();
    if (field === 'purpose') upload.purpose = 'attachment';
    else if (field === 'mime') upload.object.mediaType = 'application/pdf';
    else upload[field] = 'other';
    expect(() => validateArchive(run, upload, media)).toThrow(
      'invalid_archive',
    );
    expect(() => validateArchive(run, null, media)).toThrow('invalid_archive');
  });
  it.each([
    { startMs: -1 },
    { startMs: 600 },
    { startMs: 601 },
    { startMs: 0.1 },
    { endMs: 10001 },
    { text: '  ' },
    { providerSentenceId: '' },
    { speakerId: '' },
  ])('refuses invalid sentence %j without padding time points', (patch) => {
    const { run, result, allocateId } = facts();
    result.segments[0] = { ...result.segments[0], ...patch };
    expect(() => createRecordingTranscript(run, result, allocateId)).toThrow(
      'invalid_transcript',
    );
  });
  it('rejects live input, wrong task, empty transcript, duplicate sentences and missing inspected media', () => {
    for (const change of [
      (r: OfflineTranscript) => {
        Object.assign(r, { kind: 'live' });
      },
      (r: OfflineTranscript) => {
        r.providerTaskId = 'other';
      },
      (r: OfflineTranscript) => {
        r.segments = [];
      },
      (r: OfflineTranscript) => {
        r.durationMs = 10001;
      },
      (r: OfflineTranscript) => {
        r.durationMs = 0;
      },
      (r: OfflineTranscript) => {
        r.segments.push(r.segments[0]);
      },
    ]) {
      const { run, result, allocateId } = facts();
      change(result);
      expect(() => createRecordingTranscript(run, result, allocateId)).toThrow(
        'invalid_transcript',
      );
    }
    const { run, result, allocateId } = facts();
    run.media = null;
    expect(() => createRecordingTranscript(run, result, allocateId)).toThrow(
      'invalid_transcript',
    );
  });
  it('does not infer collection or binding facts from quota or upload IDs', () => {
    const { run, context } = facts();
    expect(contextFailure(run, context)).toBeNull();
    expect(contextFailure(run, null)).toBe('missing_context');
    for (const field of [
      'recordingId',
      'jobId',
      'originalVersionId',
      'recordCollectionId',
    ] as const)
      expect(contextFailure(run, { ...context, [field]: '' })).toBe(
        'missing_context',
      );
    expect(contextFailure(run, { ...context, attempt: 2 })).toBe(
      'missing_context',
    );
    expect(contextFailure(run, { ...context, bindingRevision: 0 })).toBe(
      'missing_context',
    );
    expect(contextFailure(run, { ...context, canProcess: false })).toBe(
      'forbidden',
    );
    run.bindingRevision = 1;
    expect(contextFailure(run, { ...context, bindingRevision: 2 })).toBe(
      'binding_changed',
    );
  });
  it('requires the exact current job and attempt; operation keys are stable and tuple-safe', () => {
    const { run } = facts();
    const work = {
      action: 'process' as const,
      recordingId: run.recordingId,
      jobId: run.jobId,
      attempt: 1,
      pollSequence: 0,
    };
    expect(matchesWork(run, work)).toBe(true);
    for (const patch of [
      { attempt: 2 },
      { jobId: 'other' },
      { recordingId: 'other' },
    ])
      expect(matchesWork(run, { ...work, ...patch })).toBe(false);
    expect(recordingKey('submit', 'a', 'b')).toBe(
      recordingKey('submit', 'a', 'b'),
    );
    expect(recordingKey('submit', 'a:b', 'c')).not.toBe(
      recordingKey('submit', 'a', 'b:c'),
    );
    expect(() =>
      initialRecordingRun({
        recordingId: '',
        uploadId: 'u',
        originalId: 'o',
        originalVersionId: 'v',
        jobId: 'j',
      }),
    ).toThrow();
  });
  it('queues only ambiguous fragments and preserves explicit irrelevant/bound resolutions', () => {
    const { run, result, allocateId } = facts();
    result.segments.push(
      { ...result.segments[0], providerSentenceId: 'b:1', speakerId: null },
      { ...result.segments[0], providerSentenceId: 'c:1' },
    );
    const t = createRecordingTranscript(run, result, allocateId);
    const pending = speakerReview(
      t,
      {
        revision: 2,
        resolutions: [
          {
            fragmentId: t.fragments[0].source.fragmentId,
            state: 'bound',
            personId: 'demo-person',
          },
          {
            fragmentId: t.fragments[1].source.fragmentId,
            state: 'deferred',
            candidates: [],
          },
          { fragmentId: t.fragments[2].source.fragmentId, state: 'irrelevant' },
        ],
      },
      2,
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      state: 'deferred',
      speakerId: t.fragments[1].source.fragmentId,
      bindingRevision: 2,
    });
  });
  it('rejects incomplete, duplicate, stale, wrong-fragment and invalid-person binding facts', () => {
    const { run, result, allocateId } = facts();
    const t = createRecordingTranscript(run, result, allocateId);
    const fragmentId = t.fragments[0].source.fragmentId;
    for (const bindings of [
      { revision: 2, resolutions: [] },
      {
        revision: 1,
        resolutions: [{ fragmentId, state: 'irrelevant' as const }],
      },
      {
        revision: 2,
        resolutions: [{ fragmentId: 'other', state: 'irrelevant' as const }],
      },
      {
        revision: 2,
        resolutions: [{ fragmentId, state: 'bound' as const, personId: '' }],
      },
      {
        revision: 2,
        resolutions: [
          {
            fragmentId,
            state: 'pending' as const,
            candidates: [{ personId: '', displayName: '演示' }],
          },
        ],
      },
    ])
      expect(() => speakerReview(t, bindings, 2)).toThrow('invalid_bindings');
    const two = {
      ...t,
      fragments: [
        ...t.fragments,
        {
          ...t.fragments[0],
          source: { ...t.fragments[0].source, fragmentId: 'second' },
        },
      ],
    };
    expect(() =>
      speakerReview(
        two,
        {
          revision: 2,
          resolutions: [
            { fragmentId, state: 'irrelevant' },
            { fragmentId, state: 'irrelevant' },
          ],
        },
        2,
      ),
    ).toThrow('invalid_bindings');
  });
});
