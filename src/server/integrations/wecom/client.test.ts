import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWecomClient, type WecomClientOptions } from './client';
import { WECOM_WS_URL, wecomLimits, type WecomMessage } from './protocol';
const servers: WebSocketServer[] = [];
const clients: ReturnType<typeof createWecomClient>[] = [];
const sockets: WebSocket[] = [];
const timers: ReturnType<typeof setTimeout>[] = [];
afterEach(async () => {
  timers.splice(0).forEach(clearTimeout);
  await Promise.all(clients.splice(0).map((c) => c.close()));
  sockets.splice(0).forEach((s) => s.terminate());
  for (const server of servers.splice(0)) {
    server.clients.forEach((s) => s.terminate());
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
async function until(condition: () => boolean) {
  const end = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > end)
      throw new Error('Local transport condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const receipt = {
  batchId: 'batch-demo',
  revision: 3,
  status: 'awaiting_confirmation' as const,
};
function callback(
  msgid = 'message-1',
  reqid = 'callback-1',
  extra: Record<string, unknown> = {},
) {
  return {
    cmd: 'aibot_msg_callback',
    headers: { req_id: reqid },
    body: {
      msgid,
      aibotid: 'demo-bot',
      from: { userid: 'demo-user' },
      chattype: 'group',
      chatid: 'demo-group',
      msgtype: 'text',
      text: { content: '演示原文，不得回群' },
      ...extra,
    },
  };
}
type Wire = {
  cmd: string;
  headers: { req_id: string };
  body?: Record<string, unknown>;
};
async function local(
  options: Partial<WecomClientOptions> = {},
  onSend?: (socket: WebSocket, frame: Wire) => void,
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected local address');
  const frames: Wire[] = [],
    messages: WecomMessage[] = [],
    errors: string[] = [];
  let peer: WebSocket | undefined;
  let connections = 0;
  server.on('connection', (socket) => {
    peer = socket;
    connections++;
    socket.on('error', () => socket.terminate());
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Wire;
      frames.push(frame);
      if (onSend) onSend(socket, frame);
      else ack(socket, frame);
    });
  });
  const client = createWecomClient(
    {
      scope: 'demo-tenant',
      botId: 'demo-bot',
      secret: 'synthetic-not-real-secret',
      heartbeatMs: 30000,
      ackTimeoutMs: 200,
      closeGraceMs: 30,
      authorize: async () => true,
      onMessage: (message) => {
        messages.push(message);
      },
      onError: (error) => {
        errors.push(error.kind);
      },
      ...options,
    },
    {
      openSocket: (url, config) => {
        expect(url).toBe(WECOM_WS_URL);
        expect(config).toMatchObject({
          rejectUnauthorized: true,
          followRedirects: false,
          maxPayload: wecomLimits.maxFrameBytes,
        });
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}`, config);
        sockets.push(socket);
        return socket;
      },
    },
  );
  clients.push(client);
  return {
    client,
    frames,
    messages,
    errors,
    get peer() {
      if (!peer) throw new Error('Peer not connected');
      return peer;
    },
    get connections() {
      return connections;
    },
  };
}
function ack(
  socket: WebSocket,
  frame: Wire,
  code = 0,
  id = frame.headers.req_id,
) {
  socket.send(
    JSON.stringify({
      headers: { req_id: id },
      errcode: code,
      errmsg: 'synthetic private diagnostics must not be exposed',
    }),
  );
}
describe('actual local WS state machine and exact ACKs', () => {
  it('distinguishes open/authenticated, ignores wrong ACK and accepts callbacks arriving immediately after auth ACK', async () => {
    const test = await local({}, (socket, frame) => {
      if (frame.cmd === 'aibot_subscribe') {
        socket.send(JSON.stringify(callback('too-early')));
        ack(socket, frame, 0, frame.headers.req_id + 'wrong');
        timers.push(
          setTimeout(() => {
            ack(socket, frame);
            socket.send(JSON.stringify(callback('valid-message')));
          }, 15),
        );
      } else ack(socket, frame);
    });
    const connecting = test.client.connect();
    expect(test.client.state).toBe('connecting');
    await connecting;
    expect(test.client.state).toBe('ready');
    await until(() => test.messages.length === 1);
    expect(test.messages[0].source.messageId).toBe('valid-message');
    expect(test.frames[0]).toMatchObject({
      cmd: 'aibot_subscribe',
      body: { bot_id: 'demo-bot', secret: 'synthetic-not-real-secret' },
    });
    await test.client.connect();
    expect(test.connections).toBe(1);
  });
  it.each([
    ['reject', 17, 'authentication_failed'],
    ['ignore', 0, 'timeout'],
  ] as const)(
    'fails closed for authentication %s without exposing secrets',
    async (mode, code, kind) => {
      const test = await local({ ackTimeoutMs: 50 }, (socket, frame) => {
        if (mode === 'reject') ack(socket, frame, code);
        else ack(socket, frame, 0, frame.headers.req_id + 'not-correlated');
      });
      const error = await test.client.connect().catch((e) => e);
      expect(error).toMatchObject({ kind });
      expect(error.message).not.toMatch(
        /synthetic-not-real-secret|private diagnostics/,
      );
      await until(() => test.client.state === 'closed');
      expect(test.messages).toHaveLength(0);
    },
  );
  it('bounds heartbeat requests and stops all heartbeats and the actual socket on close', async () => {
    const test = await local({ heartbeatMs: 20 });
    await test.client.connect();
    await until(() => test.frames.some((f) => f.cmd === 'ping'));
    await test.client.close();
    const count = test.frames.length;
    await new Promise((r) => setTimeout(r, 50));
    expect(test.frames).toHaveLength(count);
    expect(test.client.state).toBe('closed');
    expect(test.peer.readyState).toBe(WebSocket.CLOSED);
    await expect(test.client.connect()).rejects.toMatchObject({
      kind: 'closed',
    });
  });
  it('treats a takeover event as terminal and never fights the other connection with auto-reconnect', async () => {
    const test = await local();
    await test.client.connect();
    test.peer.send(
      JSON.stringify({
        cmd: 'aibot_event_callback',
        headers: { req_id: 'event-1' },
        body: { event: { eventtype: 'disconnected_event' } },
      }),
    );
    await until(() => test.client.state === 'closed');
    await new Promise((r) => setTimeout(r, 25));
    expect(test.connections).toBe(1);
  });
  it.each([true, false])(
    'closes on binary or malformed frames (binary=%s)',
    async (binary) => {
      const test = await local();
      await test.client.connect();
      if (binary) test.peer.send(Buffer.from([1, 2]));
      else test.peer.send('{');
      await until(() => test.client.state === 'closed');
      expect(test.errors).toContain('invalid_frame');
      expect(test.messages).toHaveLength(0);
    },
  );
  it('closes a real oversized WS message without delivering material', async () => {
    const test = await local();
    await test.client.connect();
    test.peer.send('x'.repeat(wecomLimits.maxFrameBytes + 1));
    await until(() => test.client.state === 'closed');
    expect(test.messages).toHaveLength(0);
    expect(test.errors).toContain('unavailable');
  });
  it('ignores unrelated frames and reports unsupported message types without invoking the material handler', async () => {
    const test = await local();
    await test.client.connect();
    test.peer.send(
      JSON.stringify({ cmd: 'future', headers: { req_id: 'future' } }),
    );
    test.peer.send(
      JSON.stringify(
        callback('voice', 'r-voice', {
          msgtype: 'voice',
          voice: { content: 'not an original audio' },
        }),
      ),
    );
    await until(() => test.errors.includes('unsupported_message'));
    expect(test.client.state).toBe('ready');
    expect(test.messages).toHaveLength(0);
  });
});
describe('current authorization, fixed group ack and private recipient binding', () => {
  it('rejects an unknown sender before any downstream callback', async () => {
    const onMessage = vi.fn();
    const test = await local({
      onMessage,
      authorize: async (source) => source.senderId === 'known-user',
    });
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.errors.includes('forbidden'));
    expect(onMessage).not.toHaveBeenCalled();
    expect(test.frames.every((f) => f.cmd === 'aibot_subscribe')).toBe(true);
  });
  it('rechecks authorization after its own async wait and never delivers after close', async () => {
    let release!: (value: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    let called = false;
    const test = await local({
      authorize: async () => {
        called = true;
        return waiting;
      },
    });
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => called);
    await test.client.close();
    release(true);
    await new Promise((r) => setTimeout(r, 10));
    expect(test.messages).toHaveLength(0);
  });
  it('uses exact fixed group text, and sends versioned details only to the original sender', async () => {
    const actions: string[] = [];
    const test = await local({
      webOrigin: 'https://demo.example.invalid',
      authorize: async (source, action) => {
        expect(Object.keys(source)).not.toContain('parts');
        actions.push(action.kind);
        return true;
      },
    });
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.messages.length === 1);
    const message = test.messages[0];
    await test.client.acknowledgeGroup(message);
    await test.client.sendPrivateReceipt(message, receipt);
    expect(test.frames[1]).toMatchObject({
      cmd: 'aibot_respond_msg',
      headers: { req_id: 'callback-1' },
      body: { msgtype: 'stream', stream: { finish: true, content: '收到了' } },
    });
    expect(JSON.stringify(test.frames[1].body)).not.toMatch(
      /batch-demo|entry\/open|演示原文|demo-user|demo-group/,
    );
    expect(test.frames[2]).toMatchObject({
      cmd: 'aibot_send_msg',
      body: { chatid: 'demo-user', msgtype: 'markdown' },
    });
    expect(JSON.stringify(test.frames[2])).not.toContain('demo-group');
    expect(JSON.stringify(test.frames[2])).toContain('expectedRevision=3');
    expect(actions).toEqual(['receive', 'group_ack', 'private_receipt']);
    await expect(
      test.client.sendPrivateReceipt(
        JSON.parse(JSON.stringify(message)),
        receipt,
      ),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
  it('rechecks at actual send time after waiting in the queue, rather than when enqueued', async () => {
    let allowed = true;
    let releaseFirst!: () => void;
    let sends = 0;
    const test = await local(
      {
        authorize: async () => allowed,
        webOrigin: 'https://demo.example.invalid',
      },
      (socket, frame) => {
        if (frame.cmd === 'aibot_send_msg' && ++sends === 1)
          releaseFirst = () => ack(socket, frame);
        else ack(socket, frame);
      },
    );
    await test.client.connect();
    test.peer.send(JSON.stringify(callback('m1', 'r1')));
    test.peer.send(JSON.stringify(callback('m2', 'r2')));
    await until(() => test.messages.length === 2);
    const first = test.client.sendPrivateReceipt(test.messages[0], receipt);
    await until(() => sends === 1);
    const second = test.client.sendPrivateReceipt(test.messages[1], {
      ...receipt,
      batchId: 'second-batch',
    });
    const rejected = expect(second).rejects.toMatchObject({
      kind: 'forbidden',
    });
    allowed = false;
    releaseFirst();
    await first;
    await rejected;
    expect(sends).toBe(1);
  });
  it('requires a configured origin and a genuine callback object, and forwards replays with the same operation key', async () => {
    const test = await local();
    await test.client.connect();
    test.peer.send(JSON.stringify(callback('same-message', 'delivery-1')));
    test.peer.send(JSON.stringify(callback('same-message', 'delivery-2')));
    await until(() => test.messages.length === 2);
    expect(test.messages[0].source.messageKey).toBe(
      test.messages[1].source.messageKey,
    ); // no in-memory dedupe pretends to be durable intake
    await expect(
      test.client.sendPrivateReceipt(test.messages[0], receipt),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('does not turn unavailable authorization or handler failures into success', async () => {
    let mode = 'authorize';
    const test = await local({
      authorize: async () => {
        if (mode === 'authorize') throw new Error('PRIVATE-source');
        return true;
      },
      onMessage: () => {
        throw new Error('PRIVATE-handler');
      },
    });
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.errors.length === 1);
    expect(test.errors).toEqual(['unavailable']);
    mode = 'handler';
    test.peer.send(JSON.stringify(callback('next', 'next-r')));
    await until(() => test.errors.length === 2);
    expect(test.errors).toEqual(['unavailable', 'unavailable']);
  });
});
describe('bounded queues, uncertain send and actual shutdown', () => {
  it('reports a nonzero message ACK without retry or fallback to a group', async () => {
    const test = await local(
      { webOrigin: 'https://demo.example.invalid' },
      (socket, frame) =>
        ack(socket, frame, frame.cmd === 'aibot_send_msg' ? 9 : 0),
    );
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.messages.length === 1);
    await expect(
      test.client.sendPrivateReceipt(test.messages[0], receipt),
    ).rejects.toMatchObject({ kind: 'ack_failed' });
    expect(test.frames.filter((f) => f.cmd === 'aibot_send_msg')).toHaveLength(
      1,
    );
    expect(test.frames.some((f) => f.cmd === 'aibot_respond_msg')).toBe(false);
  });
  it('closes on an unknown delivery outcome instead of blindly resending', async () => {
    const test = await local(
      { webOrigin: 'https://demo.example.invalid', ackTimeoutMs: 50 },
      (socket, frame) => {
        if (frame.cmd === 'aibot_subscribe') ack(socket, frame);
      },
    );
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.messages.length === 1);
    await expect(
      test.client.sendPrivateReceipt(test.messages[0], receipt),
    ).rejects.toMatchObject({ kind: 'timeout' });
    await until(() => test.client.state === 'closed');
    expect(test.frames.filter((f) => f.cmd === 'aibot_send_msg')).toHaveLength(
      1,
    );
  });
  it('bounds incoming work and aborts the lifecycle when the consumer is stalled', async () => {
    let release!: (allowed: boolean) => void;
    const waiting = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const test = await local({ authorize: () => waiting });
    await test.client.connect();
    for (let i = 0; i < wecomLimits.maxQueuedMessages + 1; i++)
      test.peer.send(JSON.stringify(callback(`m-${i}`, `r-${i}`)));
    await until(() => test.client.state === 'closed');
    release(true);
    expect(test.errors).toContain('queue_full');
    expect(test.messages).toHaveLength(0);
  });
  it('bounds queued outgoing requests and rejects them on close', async () => {
    const test = await local(
      { webOrigin: 'https://demo.example.invalid' },
      (socket, frame) => {
        if (frame.cmd === 'aibot_subscribe') ack(socket, frame);
      },
    );
    await test.client.connect();
    test.peer.send(JSON.stringify(callback()));
    await until(() => test.messages.length === 1);
    const results: Promise<unknown>[] = [];
    for (let i = 0; i < wecomLimits.maxQueuedSends + 1; i++)
      results.push(
        test.client
          .sendPrivateReceipt(test.messages[0], {
            ...receipt,
            batchId: `batch-${i}`,
          })
          .catch((e) => e),
      );
    await test.client.close();
    const errors = await Promise.all(results);
    expect(errors).toContainEqual(
      expect.objectContaining({ kind: 'queue_full' }),
    );
    expect(errors.every((e) => e instanceof Error)).toBe(true);
  });
  it('forces a real socket to terminate if a graceful close does not complete', async () => {
    const test = await local();
    await test.client.connect();
    const socket = sockets[sockets.length - 1];
    vi.spyOn(socket, 'close').mockImplementation(() => {});
    const terminate = vi.spyOn(socket, 'terminate');
    await test.client.close();
    expect(terminate).toHaveBeenCalled();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
  it('handles synchronous dial failure and validates configuration before dial', async () => {
    const base: WecomClientOptions = {
      scope: 'demo',
      botId: 'bot',
      secret: 'synthetic',
      authorize: async () => true,
      onMessage: () => {},
    };
    expect(() => createWecomClient({ ...base, secret: '' })).toThrow(
      'invalid_config',
    );
    expect(() =>
      createWecomClient({ ...base, authorize: undefined } as never),
    ).toThrow('invalid_config');
    const client = createWecomClient(base, {
      openSocket: () => {
        throw new Error('PRIVATE-dial');
      },
    });
    clients.push(client);
    const error = await client.connect().catch((e) => e);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(error.message).not.toContain('PRIVATE');
    await client.close();
    const idle = createWecomClient(base);
    await idle.close();
    await expect(idle.connect()).rejects.toMatchObject({ kind: 'closed' });
  });
});
