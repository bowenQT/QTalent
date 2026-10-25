import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  systemClock,
  TingwuHttpError,
  type TingwuRequest,
  type TimerClock,
} from '../http';

export interface SocketHandlers {
  open(): void;
  message(value: string): void;
  close(code: number): void;
  error(): void;
}
export interface SocketPort {
  readonly bufferedAmount: number;
  send(value: string | Uint8Array, callback: (error?: Error) => void): void;
  close(): void;
  subscribe(handlers: SocketHandlers): () => void;
}
export type RealtimeFailure =
  | 'connect_timeout'
  | 'stop_timeout'
  | 'protocol_error'
  | 'provider_failed'
  | 'disconnected'
  | 'aborted';
export interface Preview {
  kind: 'preview';
  sessionId: string;
  task_id: string;
  sentenceId: number;
  revision: number;
  text: string;
  startMs?: number;
  endMs?: number;
  finalWithinPreview: boolean;
}
export interface CycleCallbacks {
  onPreview(value: Preview): void;
  onDisconnected(value: {
    sessionId: string;
    task_id: string;
    reason: RealtimeFailure;
    providerStatus?: number;
    closeCode?: number;
  }): void;
}
export type StopResult =
  { status: 'stopped' } | { status: 'unknown'; reason: RealtimeFailure };
export type FinalizeResult = { status: 'finalized' | 'failed' | 'unknown' };
export type CycleState =
  'connecting' | 'ready' | 'stopping' | 'completed' | 'failed' | 'aborted';
export interface RealtimeCycle {
  readonly sessionId: string;
  readonly task_id: string;
  readonly state: CycleState;
  readonly ready: Promise<
    { status: 'ready' } | { status: 'failed'; reason: RealtimeFailure }
  >;
  pushPcm(
    bytes: Uint8Array,
  ): 'accepted' | 'backpressure' | 'invalid_audio' | 'not_ready';
  stopGracefully(): Promise<StopResult>;
  abort(): void;
}
export interface RealtimeRecord {
  readonly TaskId: string;
  readonly sessionId: string;
  startCycle(callbacks: CycleCallbacks): RealtimeCycle;
  finalizeRecord(): Promise<FinalizeResult>;
}
const inputSchema = z
  .object({
    sessionId: z.string().min(1),
    sampleRate: z.union([z.literal(8000), z.literal(16000)]),
  })
  .strict();
const recordSchema = z.object({
  Data: z.object({
    TaskId: z.string().min(1),
    MeetingJoinUrl: z.url().refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === 'wss:' &&
        url.hostname === 'tingwu-realtime-cn-beijing.aliyuncs.com' &&
        !url.port &&
        !url.username &&
        !url.password &&
        url.pathname === '/api/ws/v1' &&
        !url.hash
      );
    }),
  }),
});
const eventSchema = z.object({
  header: z.object({
    namespace: z.literal('SpeechTranscriber'),
    name: z.string(),
    task_id: z.string(),
    status: z.number().int(),
  }),
  payload: z.unknown().optional(),
});
const sentenceSchema = z
  .object({
    index: z.number().int().nonnegative(),
    result: z.string(),
    begin_time: z.number().int().nonnegative().optional(),
    time: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) =>
      value.begin_time === undefined ||
      value.time === undefined ||
      value.time >= value.begin_time,
  );
const uuid = () => randomUUID().replaceAll('-', '');

/** Creation and finalization are single-attempt writes. A timeout never means success. */
export async function createRealtimeRecord(
  input: { sessionId: string; sampleRate: 8000 | 16000 },
  dependencies: {
    request: TingwuRequest;
    connect: (url: string) => SocketPort;
    appKey: string;
    clock?: TimerClock;
  },
): Promise<RealtimeRecord> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error('invalid_audio');
  if (!dependencies.appKey) throw new Error('configuration_error');
  const { sessionId, sampleRate } = parsed.data;
  const response = await dependencies.request({
    method: 'PUT',
    action: 'CreateTask',
    path: '/openapi/tingwu/v2/tasks',
    query: { type: 'realtime' },
    body: {
      AppKey: dependencies.appKey,
      Input: { Format: 'pcm', SampleRate: sampleRate, SourceLanguage: 'cn' },
      Parameters: { Transcription: { OutputLevel: 2 } },
    },
  });
  const result = recordSchema.safeParse(response);
  if (!result.success) throw new Error('protocol_error');
  const { TaskId, MeetingJoinUrl } = result.data.Data;
  let current: RealtimeCycle | undefined;
  let finalization: Promise<FinalizeResult> | undefined;
  return {
    TaskId,
    sessionId,
    startCycle(callbacks) {
      if (finalization) throw new Error('record_finalized');
      if (
        current &&
        !['completed', 'failed', 'aborted'].includes(current.state)
      )
        throw new Error('cycle_active');
      current = createCycle(
        { sessionId, sampleRate, url: MeetingJoinUrl },
        dependencies,
        callbacks,
      );
      return current;
    },
    finalizeRecord() {
      if (finalization) return finalization;
      if (!current || current.state !== 'completed')
        return Promise.resolve({ status: 'failed' });
      finalization = (async (): Promise<FinalizeResult> => {
        try {
          const value = await dependencies.request({
            method: 'PUT',
            action: 'CreateTask',
            path: '/openapi/tingwu/v2/tasks',
            query: { type: 'realtime', operation: 'stop' },
            body: { Input: { TaskId } },
          });
          const finalized = z
            .object({
              Data: z.object({
                TaskId: z.literal(TaskId),
                TaskStatus: z.enum(['COMPLETED', 'ONGOING']),
              }),
            })
            .safeParse(value);
          // Accepted finalization can have asynchronous downstream processing; it is not an offline transcript.
          return { status: finalized.success ? 'finalized' : 'unknown' };
        } catch (error) {
          return {
            status:
              error instanceof TingwuHttpError &&
              ['provider_auth', 'rate_limited'].includes(error.code)
                ? 'failed'
                : 'unknown',
          };
        }
      })();
      return finalization;
    },
  };
}

function createCycle(
  input: { sessionId: string; sampleRate: number; url: string },
  dependencies: { connect: (url: string) => SocketPort; clock?: TimerClock },
  callbacks: CycleCallbacks,
): RealtimeCycle {
  const { sessionId, sampleRate } = input;
  const task_id = uuid();
  const clock = dependencies.clock ?? systemClock;
  let state: CycleState = 'connecting';
  let socket: SocketPort | undefined;
  let dispose = () => {};
  let cancelTimeout = () => {};
  let finishReady!: (value: Awaited<RealtimeCycle['ready']>) => void;
  const ready: RealtimeCycle['ready'] = new Promise((resolve) => {
    finishReady = resolve;
  });
  let finishStop!: (value: StopResult) => void;
  const stop = new Promise<StopResult>((resolve) => {
    finishStop = resolve;
  });
  let stopSent = false;
  const revisions = new Map<number, number>();
  const terminal = () =>
    state === 'completed' || state === 'failed' || state === 'aborted';
  function cleanup() {
    cancelTimeout();
    dispose();
    socket?.close();
  }
  function fail(
    reason: RealtimeFailure,
    metadata: { providerStatus?: number; closeCode?: number } = {},
  ) {
    if (terminal()) return;
    state = reason === 'aborted' ? 'aborted' : 'failed';
    finishReady({ status: 'failed', reason });
    finishStop({ status: 'unknown', reason });
    cleanup();
    callbacks.onDisconnected({ sessionId, task_id, reason, ...metadata });
  }
  function send(value: string | Uint8Array) {
    try {
      socket!.send(value, (error) => {
        if (error) fail('disconnected');
      });
    } catch {
      fail('disconnected');
    }
  }
  function command(name: 'StartTranscription' | 'StopTranscription') {
    send(
      JSON.stringify({
        header: {
          namespace: 'SpeechTranscriber',
          name,
          task_id,
          message_id: uuid(),
          appkey: 'default',
        },
        ...(name === 'StartTranscription'
          ? {
              payload: {
                format: 'pcm',
                sample_rate: sampleRate,
                enable_intermediate_result: true,
              },
            }
          : {}),
      }),
    );
  }
  const handlers: SocketHandlers = {
    open() {
      if (state === 'connecting') command('StartTranscription');
    },
    message(value) {
      if (terminal()) return;
      let raw: unknown;
      try {
        raw = JSON.parse(value);
      } catch {
        fail('protocol_error');
        return;
      }
      const event = eventSchema.safeParse(raw);
      if (!event.success) {
        fail('protocol_error');
        return;
      }
      const { header, payload } = event.data;
      if (header.task_id !== task_id) return;
      if (header.name === 'TaskFailed' || header.status !== 20000000) {
        fail('provider_failed', { providerStatus: header.status });
        return;
      }
      if (header.name === 'TranscriptionStarted') {
        if (state !== 'connecting') return;
        state = 'ready';
        cancelTimeout();
        finishReady({ status: 'ready' });
        return;
      }
      if (header.name === 'TranscriptionCompleted') {
        if (state !== 'stopping' || !stopSent) {
          fail('protocol_error');
          return;
        }
        state = 'completed';
        finishStop({ status: 'stopped' });
        cleanup();
        return;
      }
      if (header.name === 'SentenceBegin') return;
      if (
        !['SentenceEnd', 'TranscriptionResultChanged'].includes(header.name) ||
        state === 'connecting'
      ) {
        fail('protocol_error');
        return;
      }
      const sentence = sentenceSchema.safeParse(payload);
      if (!sentence.success) {
        fail('protocol_error');
        return;
      }
      const { index, result, begin_time, time } = sentence.data;
      const revision = (revisions.get(index) ?? 0) + 1;
      revisions.set(index, revision);
      callbacks.onPreview({
        kind: 'preview',
        sessionId,
        task_id,
        sentenceId: index,
        revision,
        text: result,
        ...(begin_time === undefined ? {} : { startMs: begin_time }),
        ...(time === undefined ? {} : { endMs: time }),
        finalWithinPreview: header.name === 'SentenceEnd',
      });
    },
    close(code) {
      fail('disconnected', { closeCode: code });
    },
    error() {
      fail('disconnected');
    },
  };
  cancelTimeout = clock.schedule(() => fail('connect_timeout'), 10000);
  try {
    socket = dependencies.connect(input.url);
    dispose = socket.subscribe(handlers);
  } catch {
    fail('disconnected');
  }
  return {
    sessionId,
    task_id,
    get state() {
      return state;
    },
    ready,
    pushPcm(bytes) {
      if (state !== 'ready') return 'not_ready';
      if (
        !(bytes instanceof Uint8Array) ||
        bytes.byteLength === 0 ||
        bytes.byteLength % 2 !== 0
      )
        return 'invalid_audio';
      // No application audio queue. The owner must pace live frames; rejected bytes are never replayed.
      if (bytes.byteLength + socket!.bufferedAmount > 64000)
        return 'backpressure';
      send(bytes.slice());
      return state === 'ready' ? 'accepted' : 'not_ready';
    },
    stopGracefully() {
      if (state === 'ready') {
        state = 'stopping';
        cancelTimeout = clock.schedule(() => fail('stop_timeout'), 10000);
        // WebSocket preserves order: Stop follows every already-accepted binary frame.
        stopSent = true;
        command('StopTranscription');
      } else if (state === 'connecting') fail('aborted');
      return stop;
    },
    abort() {
      fail('aborted');
    },
  };
}
