import { describe, expect, it, vi } from 'vitest';
import { TranscriptionSource } from '../../kodo/source';
import { TingwuHttpError } from '../http';
import { createOfflineTingwu, parseTranscript } from './index';
const result = {
  TaskId: 'task1',
  Transcription: {
    AudioInfo: { Duration: 1000 },
    Paragraphs: [
      {
        ParagraphId: 'p1',
        SpeakerId: '1',
        Words: [
          { Id: 1, SentenceId: 1, Start: 0, End: 200, Text: '演示' },
          { Id: 2, SentenceId: 1, Start: 200, End: 400, Text: '甲。' },
        ],
      },
      {
        ParagraphId: 'p2',
        Words: [
          { Id: 3, SentenceId: 2, Start: 300, End: 800, Text: '演示乙。' },
        ],
      },
    ],
  },
};
const response = (status = 'COMPLETED') => ({
  RequestId: 'r1',
  Data: {
    TaskId: 'task1',
    TaskStatus: status,
    Result: {
      Transcription:
        'https://speech-swap.oss-cn-zhangjiakou.aliyuncs.com/result.json?secret=private',
    },
  },
});
const setup = (request = vi.fn().mockResolvedValue(response())) => ({
  request,
  appKey: 'synthetic',
  resultOrigins: ['https://speech-swap.oss-cn-zhangjiakou.aliyuncs.com'],
  maxDurationMs: 21600000,
  now: () => 0,
  fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify(result))),
});
const input = () => ({
  sourceRef: 'original1',
  operationId: 'op1',
  source: new TranscriptionSource(
    'object1',
    10800000,
    'https://private.test/audio?token=private',
  ),
  media: { format: 'wav' as const, byteLength: 100, durationMs: 1000 },
});
describe('offline transcript parsing', () => {
  it('groups exact words by sentence, preserves overlap and absent speaker', () => {
    expect(parseTranscript(result, 'task1')).toEqual({
      kind: 'offline',
      providerTaskId: 'task1',
      durationMs: 1000,
      text: '演示甲。\n演示乙。',
      segments: [
        {
          providerSentenceId: 'p1:1',
          speakerId: '1',
          startMs: 0,
          endMs: 400,
          text: '演示甲。',
        },
        {
          providerSentenceId: 'p2:2',
          speakerId: null,
          startMs: 300,
          endMs: 800,
          text: '演示乙。',
        },
      ],
    });
  });
  it('accepts explicitly empty speech', () => {
    expect(
      parseTranscript(
        {
          TaskId: 'task1',
          Transcription: { AudioInfo: { Duration: 0 }, Paragraphs: [] },
        },
        'task1',
      ).text,
    ).toBe('');
  });
  it.each([
    null,
    {},
    { ...result, TaskId: 'other' },
    {
      ...result,
      Transcription: {
        ...result.Transcription,
        Paragraphs: [
          result.Transcription.Paragraphs[0],
          result.Transcription.Paragraphs[0],
        ],
      },
    },
    {
      ...result,
      Transcription: { ...result.Transcription, AudioInfo: { Duration: 100 } },
    },
  ])('rejects incomplete or inconsistent result', (raw) => {
    expect(() => parseTranscript(raw, 'task1')).toThrow('malformed_result');
  });
});
describe('offline client', () => {
  it('submits once with diarization only and source TTL at submission', async () => {
    const d = setup();
    const client = createOfflineTingwu(d);
    expect(await client.submitOffline(input())).toEqual({
      providerTaskId: 'task1',
      requestId: 'r1',
      operationId: 'op1',
    });
    expect(d.request).toHaveBeenCalledOnce();
    expect(d.request.mock.calls[0][0]).toMatchObject({
      query: { type: 'offline' },
      body: {
        Input: { SourceLanguage: 'cn', TaskKey: 'op1' },
        Parameters: { Transcription: { DiarizationEnabled: true } },
      },
    });
    expect(JSON.stringify(input().source)).not.toContain('private');
  });
  it('refuses expired or arbitrary source before request', async () => {
    const d = setup();
    const client = createOfflineTingwu(d);
    const i = input();
    await expect(
      client.submitOffline({
        ...i,
        source: new TranscriptionSource('key', 10799999, 'https://x.test'),
      }),
    ).rejects.toMatchObject({ code: 'source_expired' });
    await expect(
      client.submitOffline({ ...i, source: {} as TranscriptionSource }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(d.request).not.toHaveBeenCalled();
  });
  it('submission timeout is unknown and never retried', async () => {
    const d = setup(vi.fn().mockRejectedValue(new TingwuHttpError('timeout')));
    await expect(
      createOfflineTingwu(d).submitOffline(input()),
    ).rejects.toMatchObject({ code: 'submission_unknown', retryable: false });
    expect(d.request).toHaveBeenCalledOnce();
  });
  it.each(['ONGOING', 'FAILED', 'INVALID'])(
    'returns safe %s state without URL',
    async (status) => {
      const d = setup(vi.fn().mockResolvedValue(response(status)));
      const r = await createOfflineTingwu(d).queryOffline('task1');
      expect(r.status).toBe(status === 'ONGOING' ? 'running' : 'failed');
      expect(JSON.stringify(r)).not.toContain('secret');
    },
  );
  it('downloads completed result without leaking URL or credentials', async () => {
    const d = setup();
    const r = await createOfflineTingwu(d).getTranscript('task1');
    expect(r.text).toBe('演示甲。\n演示乙。');
    expect(d.fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it.each([
    'http://speech-swap.oss-cn-zhangjiakou.aliyuncs.com/a',
    'https://evil.test/a',
    'https://speech-swap.oss-cn-zhangjiakou.aliyuncs.com@evil.test/a',
  ])('rejects untrusted result %s', async (url) => {
    const raw = response();
    raw.Data.Result.Transcription = url;
    const d = setup(vi.fn().mockResolvedValue(raw));
    await expect(
      createOfflineTingwu(d).getTranscript('task1'),
    ).rejects.toMatchObject({ code: 'malformed_result' });
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('rejects unknown status and missing completed URL', async () => {
    const d = setup(vi.fn().mockResolvedValue(response('NEW')));
    await expect(
      createOfflineTingwu(d).queryOffline('task1'),
    ).rejects.toMatchObject({ code: 'malformed_result' });
  });
  it('does not download before completion', async () => {
    const d = setup(vi.fn().mockResolvedValue(response('ONGOING')));
    await expect(
      createOfflineTingwu(d).getTranscript('task1'),
    ).rejects.toMatchObject({ code: 'not_completed' });
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('keeps an ongoing status usable when its optional result has no transcript', async () => {
    const r = response('ONGOING');
    const d = setup(
      vi.fn().mockResolvedValue({ ...r, Data: { ...r.Data, Result: {} } }),
    );
    await expect(createOfflineTingwu(d).queryOffline('task1')).resolves.toEqual(
      {
        providerTaskId: 'task1',
        requestId: 'r1',
        status: 'running',
      },
    );
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('requires a completed transcript URL only when downloading the result', async () => {
    const r = response();
    const d = setup(
      vi.fn().mockResolvedValue({ ...r, Data: { ...r.Data, Result: {} } }),
    );
    const client = createOfflineTingwu(d);
    await expect(client.queryOffline('task1')).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(client.getTranscript('task1')).rejects.toMatchObject({
      code: 'malformed_result',
    });
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it('rejects media contract violations before submit', async () => {
    const d = setup();
    const c = createOfflineTingwu(d);
    await expect(
      c.submitOffline({
        ...input(),
        media: { format: 'wav', byteLength: 2147483649, durationMs: 1000 },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_media' });
    expect(d.request).not.toHaveBeenCalled();
  });
  it('cancellation before submit is not an unknown submission', async () => {
    const d = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(
      createOfflineTingwu(d).submitOffline(input(), abort.signal),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(d.request).not.toHaveBeenCalled();
  });
});
describe('offline failures', () => {
  it.each([
    'provider_auth',
    'rate_limited',
    'provider_failed',
    'timeout',
    'aborted',
    'protocol_error',
    'transport_error',
  ] as const)('sanitizes query %s', async (code) => {
    const d = setup(vi.fn().mockRejectedValue(new TingwuHttpError(code, 503)));
    await expect(
      createOfflineTingwu(d).queryOffline('task1'),
    ).rejects.toBeInstanceOf(Error);
    expect(d.request).toHaveBeenCalledOnce();
  });
  it('query foreign task cannot supply a transcript', async () => {
    const r = response();
    r.Data.TaskId = 'other';
    await expect(
      createOfflineTingwu(setup(vi.fn().mockResolvedValue(r))).getTranscript(
        'task1',
      ),
    ).rejects.toMatchObject({ code: 'malformed_result' });
  });
  it.each([null, {}, { Data: { TaskId: '' } }])(
    'malformed submit reply remains unknown',
    async (raw) => {
      const d = setup(vi.fn().mockResolvedValue(raw));
      await expect(
        createOfflineTingwu(d).submitOffline(input()),
      ).rejects.toMatchObject({ code: 'submission_unknown' });
      expect(d.request).toHaveBeenCalledOnce();
    },
  );
  it.each([401, 403, 404, 429, 500])(
    'classifies result HTTP %i',
    async (status) => {
      const d = setup();
      d.fetch.mockResolvedValue(new Response(null, { status }));
      await expect(
        createOfflineTingwu(d).getTranscript('task1'),
      ).rejects.toMatchObject({
        code: 'result_unavailable',
        retryable: status === 429 || status === 500,
      });
    },
  );
  it('truncated JSON is not empty success', async () => {
    const d = setup();
    d.fetch.mockResolvedValue(new Response('{'));
    await expect(
      createOfflineTingwu(d).getTranscript('task1'),
    ).rejects.toMatchObject({ code: 'malformed_result' });
  });
  it('network failures hide signed URLs', async () => {
    const d = setup();
    d.fetch.mockRejectedValue(new Error('https://private.test/?secret=xyz'));
    const e = await createOfflineTingwu(d)
      .getTranscript('task1')
      .catch((e) => e);
    expect(e.code).toBe('transport_error');
    expect(JSON.stringify(e)).not.toMatch(/private|xyz/);
  });
  it('bounds result bytes rather than trusting Content-Length', async () => {
    const d = setup();
    d.fetch.mockResolvedValue(
      new Response(new Uint8Array(16 * 1024 * 1024 + 1)),
    );
    await expect(
      createOfflineTingwu(d).getTranscript('task1'),
    ).rejects.toMatchObject({ code: 'malformed_result' });
  });
  it.each([
    { maxDurationMs: 0 },
    { maxDurationMs: 21600001 },
    { submitSafetyMs: -1 },
    { resultOrigins: [] },
    { resultOrigins: ['bad'] },
    { resultOrigins: ['http://example.test'] },
    { appKey: '' },
  ])('rejects invalid config', (bad) => {
    expect(() => createOfflineTingwu({ ...setup(), ...bad })).toThrow(
      'configuration_error',
    );
  });
  it('query validates ID and pre-cancel without sending', async () => {
    const d = setup();
    const c = createOfflineTingwu(d);
    await expect(c.queryOffline('../x')).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const abort = new AbortController();
    abort.abort();
    await expect(c.queryOffline('task1', abort.signal)).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(d.request).not.toHaveBeenCalled();
  });
  it('requires configured safety margin at actual submit time', async () => {
    const d = setup();
    await expect(
      createOfflineTingwu({ ...d, submitSafetyMs: 1 }).submitOffline(input()),
    ).rejects.toMatchObject({ code: 'source_expired' });
    expect(d.request).not.toHaveBeenCalled();
  });
  it('rejects invalid word times and missing required fields', () => {
    for (const change of [
      { Start: -1 },
      { End: 0, Start: 1 },
      { SentenceId: undefined },
    ]) {
      const r = structuredClone(result);
      Object.assign(r.Transcription.Paragraphs[0].Words[0], change);
      expect(() => parseTranscript(r, 'task1')).toThrow('malformed_result');
    }
  });
  it('does not count duplicate words twice', () => {
    const r = structuredClone(result);
    r.Transcription.Paragraphs[0].Words.push(
      r.Transcription.Paragraphs[0].Words[0],
    );
    expect(() => parseTranscript(r, 'task1')).toThrow('malformed_result');
  });
});
describe('offline cancellation and timeout', () => {
  it('cancels result wait and ignores late fetch response', async () => {
    const d = setup();
    let finish!: (r: Response) => void;
    d.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const abort = new AbortController();
    const pending = createOfflineTingwu(d).getTranscript('task1', abort.signal);
    await vi.waitFor(() => expect(d.fetch).toHaveBeenCalledOnce());
    const checked = expect(pending).rejects.toMatchObject({
      code: 'cancelled',
    });
    abort.abort();
    await checked;
    finish(new Response(JSON.stringify(result)));
  });
  it('times out a fetch that ignores abort without retry', async () => {
    vi.useFakeTimers();
    try {
      const d = setup();
      d.fetch.mockImplementation(() => new Promise(() => {}));
      const pending = createOfflineTingwu(d).getTranscript('task1');
      const checked = expect(pending).rejects.toMatchObject({
        code: 'timeout',
      });
      await vi.advanceTimersByTimeAsync(10000);
      await checked;
      expect(d.fetch).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('cancellation after submit invocation is unknown even if response arrives', async () => {
    const abort = new AbortController();
    const d = setup(
      vi.fn().mockImplementation(async () => {
        abort.abort();
        return response();
      }),
    );
    await expect(
      createOfflineTingwu(d).submitOffline(input(), abort.signal),
    ).rejects.toMatchObject({ code: 'submission_unknown' });
  });
  it('retains a known task ID after submission cancellation for querying the original task', async () => {
    const abort = new AbortController();
    const request = vi.fn().mockImplementation(async () => {
      abort.abort();
      return response();
    });
    const d = setup(request);
    const client = createOfflineTingwu(d);
    const error = await client
      .submitOffline(input(), abort.signal)
      .catch((error) => error);
    expect(error).toMatchObject({
      code: 'submission_unknown',
      retryable: false,
      providerTaskId: 'task1',
    });
    await expect(
      client.getTranscript(error.providerTaskId),
    ).resolves.toMatchObject({
      providerTaskId: 'task1',
      text: '演示甲。\n演示乙。',
    });
    expect(request.mock.calls.map(([call]) => call.method)).toEqual([
      'PUT',
      'GET',
    ]);
  });
});
