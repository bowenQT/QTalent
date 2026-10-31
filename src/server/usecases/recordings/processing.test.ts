import { describe, expect, it, vi } from 'vitest';
import type { SpeakerItem } from '../../../contracts/media';
import { createKodoClient } from '../../integrations/kodo';
import {
  OfflineError,
  type OfflineTranscript,
} from '../../integrations/tingwu/offline';
import { initialRecordingRun } from '../../modules/records/recordings/policy';
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
import type { RecordingPorts, RecordingTransaction } from './ports';
import { createRecordingProcessor } from './processing';

/** Deliberately in-memory: proves orchestration/port requirements, not PG isolation or live ASR. */
function harness() {
  const run = initialRecordingRun({
    recordingId: 'demo-recording',
    jobId: 'demo-job',
    uploadId: 'demo-upload',
    originalId: 'demo-original',
    originalVersionId: 'demo-version',
  });
  const state: {
    run: RecordingRun | null;
    context: RecordingContext | null;
    transcripts: RecordingTranscript[];
    review: SpeakerItem[];
    shaping: { input: OfflineDraftInput; key: string }[];
    polls: RecordingWork[];
  } = {
    run,
    context: {
      recordingId: run.recordingId,
      jobId: run.jobId,
      attempt: 1,
      originalVersionId: run.originalVersionId,
      recordCollectionId: 'demo-collection',
      bindingRevision: 1,
      canProcess: true,
      cancelRequested: false,
      resumeGrant: null,
    },
    transcripts: [],
    review: [],
    shaping: [],
    polls: [],
  };
  const media: InspectedAudio = {
    originalVersionId: run.originalVersionId,
    sha256: 'a'.repeat(64),
    byteLength: 256,
    durationMs: 3000,
    format: 'wav',
  };
  const upload: ArchivedUpload = {
    uploadId: run.uploadId,
    originalId: run.originalId,
    originalVersionId: run.originalVersionId,
    jobId: run.jobId,
    purpose: 'audio',
    filename: '演示录音.wav',
    accountId: 'demo-account',
    quotaScope: 'opaque-do-not-derive-collection',
    target: { kind: 'people', personIds: ['demo-person'] },
    object: {
      objectKey: 'synthetic/private/demo.wav',
      byteLength: 256,
      mediaType: 'audio/wav',
      sha256: media.sha256,
      etag: 'demo-etag',
    },
  };
  const transcript: OfflineTranscript = {
    kind: 'offline',
    providerTaskId: 'demo-task',
    durationMs: 3000,
    text: '演示：完成边界验证。',
    segments: [
      {
        providerSentenceId: 'paragraph-1:1',
        speakerId: 'speaker-local-1',
        startMs: 0,
        endMs: 1200,
        text: '演示：完成边界验证。',
      },
    ],
  };
  let counter = 0;
  let gate = Promise.resolve();
  const loadBindings = vi.fn(
    async (t: RecordingTranscript): Promise<RecordingBindings> => ({
      revision: state.context!.bindingRevision,
      resolutions: t.fragments.map((f) => ({
        fragmentId: f.source.fragmentId,
        state: 'bound',
        personId: 'demo-person',
      })),
    }),
  );
  const enqueueShaping = vi.fn<RecordingTransaction['enqueueShaping']>(
    async () => ({ jobId: 'demo-shaping-job' }),
  );
  const prepareSource = vi.fn(async () =>
    createKodoClient(
      {
        endpoint: 'https://objects.example.test',
        uploadEndpoint: 'https://up.example.test',
        managementEndpoint: 'https://rs.example.test',
        bucket: 'demo',
        accessKey: 'synthetic-ak',
        secretKey: 'synthetic-key',
      },
      { now: () => 1000, fetch: vi.fn() },
    ).createTranscriptionSource({
      objectKey: upload.object.objectKey,
      purpose: 'tingwu-offline',
      requiredRemainingTtlMs: 11100000,
    }),
  );
  const submitOffline = vi.fn<RecordingPorts['transcriber']['submitOffline']>(
    async (input) => ({
      providerTaskId: 'demo-task',
      requestId: undefined,
      operationId: input.operationId,
    }),
  );
  const queryOffline = vi.fn<RecordingPorts['transcriber']['queryOffline']>(
    async (providerTaskId) => ({
      providerTaskId,
      requestId: undefined,
      status: 'completed',
    }),
  );
  const getTranscript = vi.fn<RecordingPorts['transcriber']['getTranscript']>(
    async () => structuredClone(transcript),
  );
  const ports: RecordingPorts = {
    async transaction<T>(
      _id: string,
      fn: (tx: RecordingTransaction) => Promise<T>,
    ): Promise<T> {
      const previous = gate;
      let unlock!: () => void;
      gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      await previous;
      const draft = structuredClone(state);
      try {
        const result = await fn({
          run: draft.run,
          context: draft.context,
          async saveRun(next) {
            draft.run = structuredClone(next);
          },
          async insertTranscript(t) {
            draft.transcripts.push(structuredClone(t));
          },
          loadBindings,
          async replacePendingReview(items) {
            draft.review = structuredClone(items);
          },
          async enqueueShaping(input, key) {
            const receipt = await enqueueShaping(input, key);
            draft.shaping.push({ input: structuredClone(input), key });
            return receipt;
          },
          async enqueuePoll(work) {
            draft.polls.push(structuredClone(work));
          },
        });
        Object.assign(state, draft);
        return result;
      } finally {
        unlock();
      }
    },
    readValidatedUpload: vi.fn(async () => structuredClone(upload)),
    inspectAudio: vi.fn(async () => structuredClone(media)),
    prepareSource,
    transcriber: { submitOffline, queryOffline, getTranscript },
    allocateId: () => `demo-generated-${++counter}`,
  };
  const work: RecordingWork = {
    action: 'process',
    recordingId: run.recordingId,
    jobId: run.jobId,
    attempt: 1,
    pollSequence: 0,
  };
  const process = createRecordingProcessor(ports, { maxPolls: 2 });
  function resume(revision = 2) {
    const t = state.run!.transcript!;
    const grant = {
      recordingId: run.recordingId,
      transcriptVersionId: t.id,
      bindingRevision: revision,
      operationId: 'demo-bind-op',
    };
    state.context!.bindingRevision = revision;
    state.context!.resumeGrant = grant;
    state.run!.jobId = 'demo-resume-job';
    state.context!.jobId = 'demo-resume-job';
    return {
      ...grant,
      action: 'resume' as const,
      jobId: 'demo-resume-job',
      attempt: 1,
    };
  }
  function pending() {
    loadBindings.mockImplementation(async (t) => ({
      revision: state.context!.bindingRevision,
      resolutions: t.fragments.map((f) => ({
        fragmentId: f.source.fragmentId,
        state: 'pending',
        candidates: [],
      })),
    }));
  }
  return {
    state,
    media,
    upload,
    transcript,
    ports,
    process,
    work,
    resume,
    pending,
    loadBindings,
    enqueueShaping,
    submitOffline,
    queryOffline,
    getTranscript,
    prepareSource,
  };
}
describe('archived offline recording workflow', () => {
  it('produces immutable timed fragments and only the canonical offline input for 845', async () => {
    const h = harness();
    expect(await h.process(h.work)).toBe('handled');
    expect(h.state.run).toMatchObject({
      phase: 'shaping',
      providerTaskId: 'demo-task',
      shapingJobId: 'demo-shaping-job',
      claim: null,
    });
    expect(h.submitOffline.mock.calls[0][0]).toMatchObject({
      sourceRef: 'demo-version',
      media: { format: 'wav', durationMs: 3000, byteLength: 256 },
    });
    expect(h.state.transcripts[0].fragments[0]).toMatchObject({
      quote: '演示：完成边界验证。',
      source: {
        originalVersionId: 'demo-version',
        location: { kind: 'recording', startMs: 0, endMs: 1200 },
      },
    });
    expect(h.state.shaping[0].input).toEqual({
      kind: 'offline_transcript',
      recordingId: 'demo-recording',
      originalVersionId: 'demo-version',
      transcriptVersionId: h.state.transcripts[0].id,
      bindingRevision: 1,
    });
    expect(h.state.review).toEqual([]);
    expect(JSON.stringify(h.state)).not.toMatch(
      /synthetic\/private|FileUrl|https:|synthetic-key/,
    );
    expect(await h.process(h.work)).toBe('ignored');
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.state.shaping).toHaveLength(1);
  });
  it('claims one concurrent delivery and ignores duplicates while external submission is waiting', async () => {
    const h = harness();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((r) => {
      started = r;
    });
    h.submitOffline.mockImplementationOnce(async (input) => {
      started();
      await new Promise<void>((r) => {
        release = r;
      });
      return {
        providerTaskId: 'demo-task',
        requestId: undefined,
        operationId: input.operationId,
      };
    });
    const first = h.process(h.work);
    await waiting;
    expect(await h.process(h.work)).toBe('ignored');
    release();
    await first;
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.state.transcripts).toHaveLength(1);
  });
  it.each(['missing', 'collection', 'revision', 'forbidden'] as const)(
    'requires current %s context before any archive/provider access',
    async (kind) => {
      const h = harness();
      if (kind === 'missing') h.state.context = null;
      else if (kind === 'collection') h.state.context!.recordCollectionId = '';
      else if (kind === 'revision') h.state.context!.bindingRevision = 0;
      else h.state.context!.canProcess = false;
      await h.process(h.work);
      expect(h.state.run?.phase).toBe('failed');
      expect(h.ports.readValidatedUpload).not.toHaveBeenCalled();
      expect(h.submitOffline).not.toHaveBeenCalled();
    },
  );
  it.each(['lookup', 'inspect', 'sign'] as const)(
    'rechecks revocation after %s and makes no submission',
    async (boundary) => {
      const h = harness();
      if (boundary === 'lookup')
        vi.mocked(h.ports.readValidatedUpload).mockImplementationOnce(
          async () => {
            h.state.context!.canProcess = false;
            return h.upload;
          },
        );
      if (boundary === 'inspect')
        vi.mocked(h.ports.inspectAudio).mockImplementationOnce(async () => {
          h.state.context!.canProcess = false;
          return h.media;
        });
      if (boundary === 'sign') {
        const source = await h.prepareSource();
        h.prepareSource.mockClear();
        h.prepareSource.mockImplementationOnce(async () => {
          h.state.context!.canProcess = false;
          return source;
        });
      }
      await h.process(h.work);
      expect(h.state.run?.failure).toBe('forbidden');
      expect(h.submitOffline).not.toHaveBeenCalled();
      expect(h.state.transcripts).toEqual([]);
    },
  );
  it('does not fill a missing duration or consume a mismatched archive', async () => {
    for (const change of ['missing', 'hash', 'duration', 'purpose'] as const) {
      const h = harness();
      if (change === 'missing')
        vi.mocked(h.ports.readValidatedUpload).mockResolvedValueOnce(null);
      if (change === 'hash') h.media.sha256 = 'b'.repeat(64);
      if (change === 'duration') h.media.durationMs = 0;
      if (change === 'purpose') h.upload.purpose = 'attachment';
      await h.process(h.work);
      expect(h.state.run?.failure).toBe('invalid_archive');
      expect(h.submitOffline).not.toHaveBeenCalled();
    }
  });
  it.each(['before', 'submit', 'query', 'transcript'] as const)(
    'fences local cancellation at %s without claiming a cloud cancel',
    async (boundary) => {
      const h = harness();
      if (boundary === 'before') h.state.context!.cancelRequested = true;
      if (boundary === 'submit')
        h.submitOffline.mockImplementationOnce(async (input) => {
          h.state.context!.cancelRequested = true;
          return {
            providerTaskId: 'demo-task',
            requestId: undefined,
            operationId: input.operationId,
          };
        });
      if (boundary === 'query')
        h.queryOffline.mockImplementationOnce(async (providerTaskId) => {
          h.state.context!.cancelRequested = true;
          return { providerTaskId, requestId: undefined, status: 'completed' };
        });
      if (boundary === 'transcript')
        h.getTranscript.mockImplementationOnce(async () => {
          h.state.context!.cancelRequested = true;
          return h.transcript;
        });
      await h.process(h.work);
      expect(h.state.run?.phase).toBe('cancelled');
      expect(h.state.transcripts).toEqual([]);
      expect(h.state.shaping).toEqual([]);
      if (boundary === 'before') expect(h.submitOffline).not.toHaveBeenCalled();
      else expect(h.state.run?.providerTaskId).toBe('demo-task');
      if (boundary === 'submit') expect(h.queryOffline).not.toHaveBeenCalled();
    },
  );
  it('does not let a late old-attempt response overwrite a newer run or binding state', async () => {
    const h = harness();
    h.submitOffline.mockImplementationOnce(async (input) => {
      h.state.run = {
        ...h.state.run!,
        attempt: 2,
        jobId: 'demo-job-2',
        claim: null,
        phase: 'queued',
        submission: 'not_started',
        bindingRevision: null,
      };
      h.state.context = {
        ...h.state.context!,
        attempt: 2,
        jobId: 'demo-job-2',
        bindingRevision: 3,
      };
      return {
        providerTaskId: 'demo-task',
        requestId: undefined,
        operationId: input.operationId,
      };
    });
    await h.process(h.work);
    expect(h.state.run).toMatchObject({
      jobId: 'demo-job-2',
      attempt: 2,
      providerTaskId: null,
      phase: 'queued',
    });
    expect(h.queryOffline).not.toHaveBeenCalled();
    expect(h.state.transcripts).toEqual([]);
  });
  it('does not persist a transcript after current binding changed during download', async () => {
    const h = harness();
    h.getTranscript.mockImplementationOnce(async () => {
      h.state.context!.bindingRevision = 2;
      return h.transcript;
    });
    await h.process(h.work);
    expect(h.state.run?.failure).toBe('binding_changed');
    expect(h.state.transcripts).toEqual([]);
  });
  it('polls a known task with a bounded queue and rejects obsolete poll deliveries', async () => {
    const h = harness();
    h.queryOffline.mockResolvedValueOnce({
      providerTaskId: 'demo-task',
      requestId: undefined,
      status: 'running',
    });
    await h.process(h.work);
    expect(h.state.run).toMatchObject({
      phase: 'transcribing',
      pollSequence: 1,
      claim: null,
    });
    expect(await h.process(h.work)).toBe('ignored');
    await h.process(h.state.polls[0]);
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.queryOffline).toHaveBeenCalledTimes(2);
    expect(h.state.run?.phase).toBe('shaping');
  });
  it('stops bounded polling without losing the provider receipt', async () => {
    const h = harness();
    h.queryOffline.mockImplementation(async (providerTaskId) => ({
      providerTaskId,
      requestId: undefined,
      status: 'running',
    }));
    await h.process(h.work);
    await h.process(h.state.polls[0]);
    await h.process(h.state.polls[1]);
    expect(h.state.run).toMatchObject({
      phase: 'failed',
      failure: 'poll_limit',
      providerTaskId: 'demo-task',
    });
    expect(h.state.polls).toHaveLength(2);
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
  });
  it('does not resubmit after an unknown submit result or a crash reservation', async () => {
    const h = harness();
    h.submitOffline.mockRejectedValueOnce(
      new OfflineError('submission_unknown'),
    );
    await h.process(h.work);
    await h.process(h.work);
    expect(h.state.run?.failure).toBe('submission_unknown');
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    const crashed = harness();
    crashed.state.run!.submission = 'reserved';
    await crashed.process(crashed.work);
    expect(crashed.state.run?.failure).toBe('submission_unknown');
    expect(crashed.submitOffline).not.toHaveBeenCalled();
  });
  it('keeps a known receipt from an uncertain submission and queries it instead of resubmitting', async () => {
    const h = harness();
    h.submitOffline.mockRejectedValueOnce(
      new OfflineError('submission_unknown', false, 'demo-task'),
    );
    await h.process(h.work);
    await h.process(h.state.polls[0]);
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.queryOffline).toHaveBeenCalledWith('demo-task');
    expect(h.state.run?.phase).toBe('shaping');
  });
  it('retries only a known-task query after retryable errors', async () => {
    const h = harness();
    h.queryOffline.mockRejectedValueOnce(new OfflineError('timeout', true));
    await h.process(h.work);
    await h.process(h.state.polls[0]);
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.state.run?.phase).toBe('shaping');
    const preSubmit = harness();
    preSubmit.prepareSource.mockRejectedValueOnce(
      new OfflineError('timeout', true),
    );
    await preSubmit.process(preSubmit.work);
    expect(preSubmit.state.run?.failure).toBe('provider_unavailable');
    expect(preSubmit.state.polls).toEqual([]);
  });
  it('rejects a changed collection after parsing even when the new revision number matches', async () => {
    const h = harness();
    vi.mocked(h.ports.inspectAudio).mockImplementationOnce(async () => {
      h.state.context!.recordCollectionId = 'different-collection';
      return h.media;
    });
    await h.process(h.work);
    expect(h.state.run?.failure).toBe('missing_context');
    expect(h.submitOffline).not.toHaveBeenCalled();
  });
  it.each([
    'failed',
    'wrong-task',
    'zero-time',
    'unavailable',
    'wrong-receipt',
  ] as const)('does not shape invalid provider result %s', async (failure) => {
    const h = harness();
    if (failure === 'failed')
      h.queryOffline.mockResolvedValueOnce({
        providerTaskId: 'demo-task',
        requestId: undefined,
        status: 'failed',
      });
    if (failure === 'wrong-task')
      h.queryOffline.mockResolvedValueOnce({
        providerTaskId: 'other',
        requestId: undefined,
        status: 'completed',
      });
    if (failure === 'zero-time') h.transcript.segments[0].endMs = 0;
    if (failure === 'unavailable')
      h.getTranscript.mockRejectedValueOnce(
        new Error('unsafe upstream error with private content'),
      );
    if (failure === 'wrong-receipt')
      h.submitOffline.mockResolvedValueOnce({
        providerTaskId: 'demo-task',
        requestId: undefined,
        operationId: 'other-op',
      });
    await h.process(h.work);
    expect(h.state.run?.phase).toBe('failed');
    expect(h.state.shaping).toEqual([]);
    expect(JSON.stringify(h.state)).not.toContain('unsafe upstream');
  });
  it('queues ambiguous parts only and resumes from a committed binding revision without another ASR task', async () => {
    const h = harness();
    h.pending();
    await h.process(h.work);
    expect(h.state.run).toMatchObject({ phase: 'needs_review', claim: null });
    expect(h.state.review).toHaveLength(1);
    expect(h.state.shaping).toEqual([]);
    expect(await h.process(h.work)).toBe('ignored');
    h.loadBindings.mockImplementation(async (t) => ({
      revision: 2,
      resolutions: t.fragments.map((f) => ({
        fragmentId: f.source.fragmentId,
        state: 'bound',
        personId: 'demo-person',
      })),
    }));
    const resumed = h.resume();
    await h.process(resumed);
    await h.process(resumed);
    expect(h.state.run?.phase).toBe('shaping');
    expect(h.state.review).toEqual([]);
    expect(h.state.shaping).toHaveLength(1);
    expect(h.state.shaping[0].input.bindingRevision).toBe(2);
    expect(h.submitOffline).toHaveBeenCalledTimes(1);
    expect(h.getTranscript).toHaveBeenCalledTimes(1);
    expect(h.state.transcripts).toHaveLength(1);
  });
  it.each([
    'absent',
    'operation',
    'transcript',
    'revision',
    'recording',
    'still-pending',
  ] as const)(
    'does not trust a resume command when its server ledger is %s',
    async (failure) => {
      const h = harness();
      h.pending();
      await h.process(h.work);
      const resumed = h.resume();
      if (failure === 'absent') h.state.context!.resumeGrant = null;
      if (failure === 'operation')
        h.state.context!.resumeGrant!.operationId = 'other';
      if (failure === 'transcript')
        h.state.context!.resumeGrant!.transcriptVersionId = 'other';
      if (failure === 'revision') h.state.context!.bindingRevision = 3;
      if (failure === 'recording')
        h.state.context!.resumeGrant!.recordingId = 'other';
      await h.process(resumed);
      expect(h.state.run?.phase).toBe('needs_review');
      expect(h.state.shaping).toEqual([]);
      expect(h.submitOffline).toHaveBeenCalledTimes(1);
    },
  );
  it('fails closed on missing speaker facts and rolls queue output back on enqueue failure', async () => {
    const missing = harness();
    missing.loadBindings.mockResolvedValueOnce({
      revision: 1,
      resolutions: [],
    });
    await missing.process(missing.work);
    expect(missing.state.run?.failure).toBe('invalid_bindings');
    expect(missing.state.shaping).toEqual([]);
    const h = harness();
    h.enqueueShaping.mockRejectedValueOnce(new Error('queue unavailable'));
    await h.process(h.work);
    expect(h.state.run?.failure).toBe('provider_unavailable');
    expect(h.state.shaping).toEqual([]);
    expect(h.state.review).toEqual([]);
    // Valid immutable extraction can remain; no event, score or confirmed draft writer exists here.
    expect(h.state.transcripts).toHaveLength(1);
  });
  it('ignores absent/stale/terminal runs and rejects an unbounded poll policy', async () => {
    for (const change of [
      'missing',
      'job',
      'attempt',
      'cancelled',
      'failed',
    ] as const) {
      const h = harness();
      if (change === 'missing') h.state.run = null;
      else if (change === 'job') h.state.run!.jobId = 'other';
      else if (change === 'attempt') h.state.run!.attempt = 2;
      else h.state.run!.phase = change;
      expect(await h.process(h.work)).toBe('ignored');
      expect(h.submitOffline).not.toHaveBeenCalled();
    }
    const h = harness();
    for (const maxPolls of [0, -1, 1.5, NaN])
      expect(() => createRecordingProcessor(h.ports, { maxPolls })).toThrow(
        'invalid_poll_limit',
      );
  });
});
