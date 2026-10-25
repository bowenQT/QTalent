import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRealtimeRecord,
  type SocketPort,
  type SocketHandlers,
} from './client';

class Socket implements SocketPort {
  bufferedAmount = 0;
  sent: (string | Uint8Array)[] = [];
  handlers!: SocketHandlers;
  close = vi.fn();
  dispose = vi.fn();
  send(value: string | Uint8Array, callback: (error?: Error) => void) {
    this.sent.push(value);
    callback();
  }
  subscribe(handlers: SocketHandlers) {
    this.handlers = handlers;
    return this.dispose;
  }
  event(name: string, taskId: string, payload?: object, status = 20000000) {
    this.handlers.message(
      JSON.stringify({
        header: {
          namespace: 'SpeechTranscriber',
          name,
          task_id: taskId,
          status,
        },
        payload,
      }),
    );
  }
}
function fixture() {
  const sockets: Socket[] = [];
  const request = vi.fn().mockResolvedValue({
    Data: {
      TaskId: 'record-1',
      MeetingJoinUrl:
        'wss://tingwu-realtime-cn-beijing.aliyuncs.com/api/ws/v1?mc=private',
    },
  });
  const connect = vi.fn(() => {
    const socket = new Socket();
    sockets.push(socket);
    return socket;
  });
  const onPreview = vi.fn();
  const onDisconnected = vi.fn();
  return {
    sockets,
    request,
    connect,
    onPreview,
    onDisconnected,
    async start() {
      const record = await createRealtimeRecord(
        { sessionId: 'app-session', sampleRate: 16000 },
        { request, connect, appKey: 'demo-app' },
      );
      const cycle = record.startCycle({ onPreview, onDisconnected });
      const socket = sockets.at(-1)!;
      socket.handlers.open();
      socket.event('TranscriptionStarted', cycle.task_id);
      await cycle.ready;
      return { record, cycle, socket };
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('Tingwu realtime preview lifecycle', () => {
  it('creates a record, starts a distinct cycle, sends PCM only after ready', async () => {
    const f = fixture();
    const { record, cycle, socket } = await f.start();
    expect(record.TaskId).toBe('record-1');
    expect(cycle.task_id).toMatch(/^[a-f0-9]{32}$/);
    expect(cycle.sessionId).toBe('app-session');
    expect(f.request).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CreateTask',
        query: { type: 'realtime' },
        body: expect.objectContaining({
          Input: { Format: 'pcm', SampleRate: 16000, SourceLanguage: 'cn' },
        }),
      }),
    );
    expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
      header: {
        name: 'StartTranscription',
        task_id: cycle.task_id,
        appkey: 'default',
      },
    });
    expect(cycle.pushPcm(new Uint8Array(3200))).toBe('accepted');
    expect(socket.sent[1]).toEqual(new Uint8Array(3200));
    cycle.abort();
  });
  it('waits for matching completion, preserves last preview and shares duplicate stop', async () => {
    const f = fixture();
    const { record, cycle, socket } = await f.start();
    socket.event('TranscriptionResultChanged', cycle.task_id, {
      index: 1,
      result: '演示',
    });
    const stop = cycle.stopGracefully();
    expect(cycle.stopGracefully()).toBe(stop);
    expect(cycle.pushPcm(new Uint8Array(2))).toBe('not_ready');
    socket.event('TranscriptionCompleted', 'old-task');
    expect(socket.close).not.toHaveBeenCalled();
    socket.event('SentenceEnd', cycle.task_id, {
      index: 1,
      result: '演示结束。',
      begin_time: 0,
      time: 1000,
    });
    expect(f.onPreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'preview',
        revision: 2,
        finalWithinPreview: true,
        text: '演示结束。',
      }),
    );
    socket.event('TranscriptionCompleted', cycle.task_id);
    expect(await stop).toEqual({ status: 'stopped' });
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.dispose).toHaveBeenCalledOnce();
    expect(f.request).toHaveBeenCalledTimes(1); // pause does not finalize
    const next = record.startCycle({
      onPreview: f.onPreview,
      onDisconnected: f.onDisconnected,
    });
    socket.event('TaskFailed', cycle.task_id, undefined, 40000000);
    expect(next.state).toBe('connecting');
    next.abort();
    await next.ready;
  });
  it('hard disconnect and provider failure never count as completion', async () => {
    const f = fixture();
    const { cycle, socket } = await f.start();
    const stop = cycle.stopGracefully();
    socket.handlers.close(1006);
    expect(await stop).toEqual({ status: 'unknown', reason: 'disconnected' });
    expect(f.onDisconnected).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'disconnected', closeCode: 1006 }),
    );
    expect(f.connect).toHaveBeenCalledTimes(1);
  });
  it('times out stop without converting late completion into success', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const { cycle, socket } = await f.start();
    const stop = cycle.stopGracefully();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await stop).toEqual({ status: 'unknown', reason: 'stop_timeout' });
    socket.event('TranscriptionCompleted', cycle.task_id);
    expect(cycle.state).toBe('failed');
  });
  it('finalizes exactly once and reports unknown independently of completed recognition', async () => {
    const f = fixture();
    const { record, cycle, socket } = await f.start();
    const stop = cycle.stopGracefully();
    socket.event('TranscriptionCompleted', cycle.task_id);
    await stop;
    f.request.mockRejectedValue(new Error('secret must not escape'));
    const finalized = record.finalizeRecord();
    expect(record.finalizeRecord()).toBe(finalized);
    expect(await finalized).toEqual({ status: 'unknown' });
    expect(cycle.state).toBe('completed');
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(() =>
      record.startCycle({ onPreview: vi.fn(), onDisconnected: vi.fn() }),
    ).toThrow('record_finalized');
  });
  it('bounds pending PCM, rejects empty/odd frames and never queues historical audio', async () => {
    const f = fixture();
    const { cycle, socket } = await f.start();
    expect(cycle.pushPcm(new Uint8Array(0))).toBe('invalid_audio');
    expect(cycle.pushPcm(new Uint8Array(3))).toBe('invalid_audio');
    socket.bufferedAmount = 64000;
    expect(cycle.pushPcm(new Uint8Array(2))).toBe('backpressure');
    expect(socket.sent).toHaveLength(1);
    cycle.abort();
  });
});

describe('failure isolation and validation', () => {
  it('rejects invalid audio configuration and unsafe provider URLs before connection', async () => {
    const f = fixture();
    await expect(
      createRealtimeRecord(
        { sessionId: '', sampleRate: 16000 },
        { request: f.request, connect: f.connect, appKey: 'demo' },
      ),
    ).rejects.toThrow('invalid_audio');
    expect(f.request).not.toHaveBeenCalled();
    await expect(
      createRealtimeRecord(
        { sessionId: 's', sampleRate: 16000 },
        { request: f.request, connect: f.connect, appKey: '' },
      ),
    ).rejects.toThrow('configuration_error');
    for (const MeetingJoinUrl of [
      'ws://tingwu-realtime-cn-beijing.aliyuncs.com/api/ws/v1',
      'wss://evil.example/api/ws/v1',
      'wss://tingwu-realtime-cn-beijing.aliyuncs.com:444/api/ws/v1',
    ]) {
      f.request.mockResolvedValue({
        Data: { TaskId: 'record', MeetingJoinUrl },
      });
      await expect(
        createRealtimeRecord(
          { sessionId: 's', sampleRate: 16000 },
          { request: f.request, connect: f.connect, appKey: 'demo' },
        ),
      ).rejects.toThrow('protocol_error');
    }
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('times out connecting; cannot send before readiness or finalize an active record', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const record = await createRealtimeRecord(
      { sessionId: 's', sampleRate: 8000 },
      { request: f.request, connect: f.connect, appKey: 'demo' },
    );
    expect(await record.finalizeRecord()).toEqual({ status: 'failed' });
    const cycle = record.startCycle(f);
    expect(cycle.pushPcm(new Uint8Array(2))).toBe('not_ready');
    expect(() => record.startCycle(f)).toThrow('cycle_active');
    await vi.advanceTimersByTimeAsync(10000);
    expect(await cycle.ready).toEqual({
      status: 'failed',
      reason: 'connect_timeout',
    });
    expect(await cycle.stopGracefully()).toEqual({
      status: 'unknown',
      reason: 'connect_timeout',
    });
    expect(f.sockets[0].dispose).toHaveBeenCalledOnce();
  });
  it.each([
    'TaskFailed',
    'Surprise',
    'bad-json',
    'bad-header',
    'bad-payload',
    'premature-completion',
  ])('fails closed for %s without leaking raw messages', async (kind) => {
    const f = fixture();
    const { cycle, socket } = await f.start();
    if (kind === 'bad-json') socket.handlers.message('secret not json');
    else if (kind === 'bad-header') socket.handlers.message('{}');
    else if (kind === 'bad-payload')
      socket.event('SentenceEnd', cycle.task_id, {
        index: 1,
        result: 'secret',
        begin_time: 200,
        time: 100,
      });
    else if (kind === 'premature-completion')
      socket.event('TranscriptionCompleted', cycle.task_id);
    else
      socket.event(
        kind,
        cycle.task_id,
        undefined,
        kind === 'TaskFailed' ? 40000002 : 20000000,
      );
    expect(cycle.state).toBe('failed');
    expect(f.onPreview).not.toHaveBeenCalled();
    expect(JSON.stringify(f.onDisconnected.mock.calls)).not.toContain('secret');
    if (kind === 'TaskFailed')
      expect(f.onDisconnected).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'provider_failed',
          providerStatus: 40000002,
        }),
      );
    expect(await cycle.stopGracefully()).toMatchObject({ status: 'unknown' });
  });
  it('ignores lifecycle duplicates and reports optional times only when present', async () => {
    const f = fixture();
    const { cycle, socket } = await f.start();
    socket.event('TranscriptionStarted', cycle.task_id);
    socket.event('SentenceBegin', cycle.task_id, { index: 1, time: 0 });
    socket.event('TranscriptionResultChanged', cycle.task_id, {
      index: 1,
      result: '',
    });
    expect(f.onPreview.mock.calls[0][0]).not.toHaveProperty('startMs');
    expect(f.onPreview.mock.calls[0][0]).not.toHaveProperty('endMs');
    cycle.abort();
    cycle.abort();
    socket.handlers.error();
    expect(f.onDisconnected).toHaveBeenCalledOnce();
    expect(await cycle.stopGracefully()).toEqual({
      status: 'unknown',
      reason: 'aborted',
    });
  });
  it('handles synchronous connect/send and asynchronous send failures as disconnects', async () => {
    const f = fixture();
    const record = await createRealtimeRecord(
      { sessionId: 's', sampleRate: 16000 },
      {
        request: f.request,
        appKey: 'demo',
        connect: () => {
          throw new Error('secret');
        },
      },
    );
    const bad = record.startCycle(f);
    expect(await bad.ready).toEqual({
      status: 'failed',
      reason: 'disconnected',
    });
    const first = await f.start();
    first.socket.send = () => {
      throw new Error('secret');
    };
    expect(first.cycle.pushPcm(new Uint8Array(2))).toBe('not_ready');
    const second = await f.start();
    second.socket.send = (_value, callback) => callback(new Error('secret'));
    expect(second.cycle.pushPcm(new Uint8Array(2))).toBe('not_ready');
    const third = await f.start();
    third.socket.handlers.error();
    expect(third.cycle.state).toBe('failed');
  });
  it('stop while connecting aborts, and previews received before readiness are invalid', async () => {
    const f = fixture();
    const record = await createRealtimeRecord(
      { sessionId: 's', sampleRate: 16000 },
      { request: f.request, connect: f.connect, appKey: 'demo' },
    );
    const cycle = record.startCycle(f);
    expect(await cycle.stopGracefully()).toEqual({
      status: 'unknown',
      reason: 'aborted',
    });
    await cycle.ready;
    const next = record.startCycle(f);
    f.sockets
      .at(-1)!
      .event('SentenceEnd', next.task_id, { index: 1, result: 'demo' });
    expect(await next.ready).toEqual({
      status: 'failed',
      reason: 'protocol_error',
    });
  });
  it.each(['COMPLETED', 'ONGOING', 'INVALID'])(
    'finalization classifies %s once without conflating it with recognition',
    async (TaskStatus) => {
      const f = fixture();
      const { record, cycle, socket } = await f.start();
      const stopped = cycle.stopGracefully();
      socket.event('TranscriptionCompleted', cycle.task_id);
      await stopped;
      f.request.mockResolvedValue({ Data: { TaskId: 'record-1', TaskStatus } });
      expect(await record.finalizeRecord()).toEqual({
        status: TaskStatus === 'INVALID' ? 'unknown' : 'finalized',
      });
      expect(f.request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          query: { type: 'realtime', operation: 'stop' },
          body: { Input: { TaskId: 'record-1' } },
        }),
      );
      await record.finalizeRecord();
      expect(f.request).toHaveBeenCalledTimes(2);
    },
  );
});
