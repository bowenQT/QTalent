import { randomUUID } from 'node:crypto';
import WebSocket, { type ClientOptions } from 'ws';
import { z } from 'zod';
import {
  parseWecomFrame,
  WECOM_WS_URL,
  WecomError,
  wecomIdSchema,
  wecomLimits,
  type WecomMessage,
  type WecomSource,
} from './protocol';
import {
  groupAcknowledgement,
  privateBatchReceipt,
  validateWebOrigin,
  type WecomAction,
  type WecomBatchReceipt,
} from './receipts';
const settingsSchema = z.strictObject({
  scope: wecomIdSchema,
  botId: wecomIdSchema,
  secret: z.string().min(1).max(2048),
  openTimeoutMs: z.number().int().min(1).max(8000).default(8000),
  ackTimeoutMs: z.number().int().min(1).max(8000).default(5000),
  heartbeatMs: z.number().int().min(10).max(30000).default(30000),
  closeGraceMs: z.number().int().min(1).max(1000).default(1000),
  webOrigin: z.string().optional(),
});
export type WecomClientOptions = z.input<typeof settingsSchema> & {
  /** Supplied by 903/server composition: no role or identity rules live in this adapter. */
  authorize: (source: WecomSource, action: WecomAction) => Promise<boolean>;
  onMessage: (
    message: WecomMessage,
    signal: AbortSignal,
  ) => void | Promise<void>;
  onError?: (error: WecomError) => void;
};
export function createWecomClient(
  options: WecomClientOptions,
  io: { openSocket?: (url: string, options: ClientOptions) => WebSocket } = {},
) {
  const parsed = settingsSchema.safeParse({
    scope: options.scope,
    botId: options.botId,
    secret: options.secret,
    openTimeoutMs: options.openTimeoutMs,
    ackTimeoutMs: options.ackTimeoutMs,
    heartbeatMs: options.heartbeatMs,
    closeGraceMs: options.closeGraceMs,
    webOrigin: options.webOrigin,
  });
  if (
    !parsed.success ||
    typeof options.authorize !== 'function' ||
    typeof options.onMessage !== 'function'
  )
    throw new WecomError('invalid_config');
  const config = parsed.data;
  if (config.webOrigin) validateWebOrigin(config.webOrigin);
  const authorize = options.authorize,
    onMessage = options.onMessage,
    onError = options.onError;
  let state:
    'idle' | 'connecting' | 'authenticating' | 'ready' | 'closing' | 'closed' =
    'idle';
  let socket: WebSocket | undefined;
  let connection: Promise<void> | undefined;
  let resolveConnection: (() => void) | undefined,
    rejectConnection: ((e: WecomError) => void) | undefined;
  let closing: Promise<void> | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined,
    heartbeat: ReturnType<typeof setInterval> | undefined;
  let pending:
    | {
        id: string;
        timer: ReturnType<typeof setTimeout>;
        resolve: () => void;
        reject: (e: WecomError) => void;
        authenticate: boolean;
      }
    | undefined;
  const lifecycle = new AbortController(),
    proof = new WeakSet<WecomMessage>();
  let sendTail = Promise.resolve(),
    receiveTail = Promise.resolve(),
    queuedSends = 0,
    queuedMessages = 0;
  function report(error: WecomError) {
    try {
      onError?.(error);
    } catch {
      void close();
    }
  }
  function clearPending(error: WecomError) {
    if (pending) {
      clearTimeout(pending.timer);
      const old = pending;
      pending = undefined;
      old.reject(error);
    }
  }
  function fail(error: WecomError) {
    if (state === 'closing' || state === 'closed') return;
    rejectConnection?.(error);
    clearPending(error);
    report(error);
    void close();
  }
  async function close(): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      state = 'closing';
      lifecycle.abort();
      clearTimeout(openTimer);
      clearInterval(heartbeat);
      const error = new WecomError('closed');
      rejectConnection?.(error);
      clearPending(error);
      const active = socket;
      if (active && active.readyState !== WebSocket.CLOSED) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(
            () => active.terminate(),
            config.closeGraceMs,
          );
          active.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
          if (active.readyState === WebSocket.CONNECTING) active.terminate();
          else active.close(1000);
        });
      }
      state = 'closed';
    })();
    return closing;
  }
  async function permitted(message: WecomMessage, action: WecomAction) {
    let allowed: boolean;
    try {
      allowed = await authorize(message.source, action);
    } catch {
      throw new WecomError('unavailable');
    }
    if (allowed !== true) throw new WecomError('forbidden');
  }
  function request(
    cmd: string,
    body: unknown,
    id: string,
    authenticate = false,
    before?: () => Promise<void>,
  ): Promise<void> {
    if (queuedSends >= wecomLimits.maxQueuedSends)
      return Promise.reject(new WecomError('queue_full'));
    queuedSends++;
    const job = sendTail.then(async () => {
      if (authenticate ? state !== 'authenticating' : state !== 'ready')
        throw new WecomError('closed');
      await before?.();
      if (
        !socket ||
        socket.readyState !== WebSocket.OPEN ||
        (authenticate ? state !== 'authenticating' : state !== 'ready')
      )
        throw new WecomError('closed');
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => fail(new WecomError('timeout')),
          config.ackTimeoutMs,
        );
        pending = { id, timer, resolve, reject, authenticate };
        try {
          socket!.send(
            JSON.stringify({
              cmd,
              headers: { req_id: id },
              ...(body === undefined ? {} : { body }),
            }),
            (error) => {
              if (error) fail(new WecomError('unavailable'));
            },
          );
        } catch {
          fail(new WecomError('unavailable'));
        }
      });
    });
    // This tail schedules the next send; the caller still receives the original rejection.
    sendTail = job.then(
      () => undefined,
      () => undefined,
    );
    return job.finally(() => {
      queuedSends--;
    });
  }
  function accept(message: WecomMessage) {
    if (queuedMessages >= wecomLimits.maxQueuedMessages) {
      fail(new WecomError('queue_full'));
      return;
    }
    proof.add(message);
    queuedMessages++;
    receiveTail = receiveTail
      .then(async () => {
        if (state !== 'ready') return;
        await permitted(message, Object.freeze({ kind: 'receive' }));
        if (state === 'ready') await onMessage(message, lifecycle.signal);
      })
      .catch((error) => {
        report(
          error instanceof WecomError ? error : new WecomError('unavailable'),
        );
      })
      .finally(() => {
        queuedMessages--;
      });
  }
  function connect(): Promise<void> {
    if (state === 'closing' || state === 'closed')
      return Promise.reject(new WecomError('closed'));
    if (connection) return connection;
    if (state !== 'idle') return Promise.reject(new WecomError('closed'));
    state = 'connecting';
    connection = new Promise<void>((resolve, reject) => {
      resolveConnection = resolve;
      rejectConnection = reject;
      try {
        socket = (
          io.openSocket ?? ((url, options) => new WebSocket(url, options))
        )(WECOM_WS_URL, {
          maxPayload: wecomLimits.maxFrameBytes,
          followRedirects: false,
          rejectUnauthorized: true,
        });
      } catch {
        fail(new WecomError('unavailable'));
        return;
      }
      openTimer = setTimeout(
        () => fail(new WecomError('timeout')),
        config.openTimeoutMs,
      );
      socket.on('open', () => {
        clearTimeout(openTimer);
        if (state !== 'connecting') return;
        state = 'authenticating';
        void request(
          'aibot_subscribe',
          { bot_id: config.botId, secret: config.secret },
          `aibot_subscribe_${randomUUID()}`,
          true,
        ).catch((error) => fail(error));
      });
      socket.on('error', () => fail(new WecomError('unavailable')));
      socket.on('close', () => {
        if (state !== 'closing' && state !== 'closed')
          fail(new WecomError('closed'));
      });
      socket.on('message', (raw, binary) => {
        if (state === 'closing' || state === 'closed') return;
        try {
          if (binary) throw new WecomError('invalid_frame');
          const frame = parseWecomFrame(
            raw instanceof ArrayBuffer
              ? new Uint8Array(raw)
              : Array.isArray(raw)
                ? Buffer.concat(raw)
                : raw,
            config,
          );
          if (frame.kind === 'ack') {
            if (!pending || frame.requestId !== pending.id) return;
            const current = pending;
            pending = undefined;
            clearTimeout(current.timer);
            if (frame.code !== 0) {
              const error = new WecomError(
                current.authenticate ? 'authentication_failed' : 'ack_failed',
              );
              current.reject(error);
              if (current.authenticate) fail(error);
              return;
            }
            if (current.authenticate) {
              state = 'ready';
              heartbeat = setInterval(() => {
                void request('ping', undefined, `ping_${randomUUID()}`).catch(
                  (error) => fail(error),
                );
              }, config.heartbeatMs);
              resolveConnection?.();
            }
            current.resolve();
          } else if (frame.kind === 'disconnected')
            fail(new WecomError('closed'));
          else if (frame.kind === 'message' && state === 'ready')
            accept(frame.message);
        } catch (error) {
          const safe =
            error instanceof WecomError
              ? error
              : new WecomError('invalid_frame');
          if (safe.kind === 'unsupported_message') report(safe);
          else fail(safe);
        }
      });
    });
    return connection;
  }
  function usable(message: WecomMessage) {
    if (state !== 'ready') throw new WecomError('closed');
    if (!proof.has(message)) throw new WecomError('forbidden');
  }
  return {
    connect,
    close,
    get state() {
      return state;
    },
    async acknowledgeGroup(message: WecomMessage) {
      usable(message);
      const plan = groupAcknowledgement(message);
      await request(plan.cmd, plan.body, plan.requestId, false, () =>
        permitted(message, plan.action),
      );
    },
    async sendPrivateReceipt(
      message: WecomMessage,
      receipt: WecomBatchReceipt,
    ) {
      usable(message);
      if (!config.webOrigin) throw new WecomError('unavailable');
      const plan = privateBatchReceipt(message, receipt, config.webOrigin);
      await request(
        plan.cmd,
        plan.body,
        `aibot_send_msg_${randomUUID()}`,
        false,
        () => permitted(message, plan.action),
      );
    },
  };
}
