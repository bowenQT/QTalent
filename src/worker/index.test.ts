import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MODELINK_ENDPOINT, MODELINK_MODEL } from '../server/integrations/maas';
const f = vi.hoisted(() => ({
  serverEvents: new Map<string, (...args: unknown[]) => unknown>(),
  socketEvents: new Map<string, (...args: unknown[]) => unknown>(),
  start: vi.fn(),
  stop: vi.fn(),
  register: vi.fn(),
  registerProgress: vi.fn(),
  registerDemand: vi.fn(),
  demandRuntime: vi.fn(),
  access: vi.fn(),
  session: vi.fn(),
  env: {
    APP_ENV: 'test',
    MODELINK_API_KEY: undefined as string | undefined,
    MODELINK_BASE_URL: undefined as string | undefined,
    MODELINK_MODEL: undefined as string | undefined,
    QINIU_MAAS_API_KEY: 'synthetic-legacy-key',
    DATABASE_URL: 'test',
    BETTER_AUTH_URL: 'https://test.local',
    WORKER_PORT: 3001,
  },
  failListen: false,
  clientClose: vi.fn(),
  closeSockets: vi.fn(),
}));
vi.mock('../server/env', () => ({ getEnv: () => f.env }));
vi.mock('../server/auth', () => ({ getSession: f.session }));
vi.mock('../server/access', () => ({ verifyAccessRequest: f.access }));
vi.mock('../server/jobs/example', () => ({ registerExampleJob: f.register }));
vi.mock('../server/jobs/progress-worker', () => ({
  registerProgressExample: f.registerProgress,
}));
vi.mock('../server/usecases/staffing-demand-runtime', () => ({
  createStaffingDemandRuntime: f.demandRuntime,
}));
vi.mock('../server/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    on() {
      return this;
    }
    start = f.start;
    stop = f.stop;
  },
}));
vi.mock('node:http', () => ({
  createServer: () => ({
    on: (event: string, handler: (...args: unknown[]) => unknown) =>
      f.serverEvents.set(event, handler),
    once: (event: string, handler: (...args: unknown[]) => unknown) =>
      f.serverEvents.set(event, handler),
    listen: (_port: number, _host: string, callback: () => void) =>
      f.failListen
        ? f.serverEvents.get('error')!(new Error('listen failed'))
        : callback(),
    close: (callback: (error?: Error) => void) => callback(),
  }),
}));
vi.mock('ws', () => ({
  WebSocketServer: class {
    clients = [{ close: f.clientClose }];
    on(event: string, handler: (...args: unknown[]) => unknown) {
      f.socketEvents.set(event, handler);
    }
    close = f.closeSockets;
    handleUpgrade(
      _req: unknown,
      _socket: unknown,
      _head: unknown,
      callback: (client: unknown) => void,
    ) {
      callback({ on: vi.fn() });
    }
    emit(event: string, ...args: unknown[]) {
      f.socketEvents.get(event)?.(...args);
    }
  },
}));
import { startWorker } from './index';
beforeEach(() => {
  vi.clearAllMocks();
  f.serverEvents.clear();
  f.socketEvents.clear();
  f.failListen = false;
  f.env.MODELINK_API_KEY = undefined;
  f.env.MODELINK_BASE_URL = undefined;
  f.env.MODELINK_MODEL = undefined;
  f.start.mockResolvedValue(undefined);
  f.stop.mockResolvedValue(undefined);
  f.register.mockResolvedValue(undefined);
  f.registerProgress.mockResolvedValue(undefined);
  f.registerDemand.mockResolvedValue(undefined);
  f.demandRuntime.mockReturnValue({ register: f.registerDemand });
  f.access.mockResolvedValue(undefined);
  f.session.mockResolvedValue({
    user: { id: 'synthetic' },
    session: { expiresAt: new Date(Date.now() + 60000) },
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('worker lifecycle with transport boundaries replaced', () => {
  it('uses the explicit trusted Modelink settings without ambient or legacy fallback', async () => {
    vi.stubEnv('MODELINK_API_KEY', 'synthetic-ambient-key');
    vi.stubEnv('MODELINK_BASE_URL', 'https://api.modelink.ai/v1');
    vi.stubEnv('MODELINK_MODEL', MODELINK_MODEL);
    const send = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No live network'));
    try {
      const worker = await startWorker();
      expect(f.registerDemand).toHaveBeenCalledOnce();
      const input = f.demandRuntime.mock.calls[0][0];
      expect(input.boss).toBe(worker.boss);
      expect(input).not.toHaveProperty('businessDate');
      expect(input).not.toHaveProperty('now');
      expect(f.register).toHaveBeenCalledOnce();
      expect(f.registerProgress).toHaveBeenCalledOnce();
      const result = await input.maas.generateStructured({
        messages: [{ role: 'user', content: 'Return JSON for synthetic test' }],
        promptVersion: 'test',
        schema: z.object({ value: z.string() }),
      });
      expect(result).toMatchObject({
        ok: false,
        kind: 'configuration',
        retryable: false,
        metadata: { model: MODELINK_MODEL },
      });
      expect(send).not.toHaveBeenCalled();
      await worker.stop();
    } finally {
      send.mockRestore();
    }
  });
  it('passes trusted Modelink configuration into the actual Gemini protocol client', async () => {
    f.env.MODELINK_API_KEY = 'synthetic-trusted-modelink-key';
    f.env.MODELINK_BASE_URL = 'https://api.modelink.ai/v1';
    f.env.MODELINK_MODEL = MODELINK_MODEL;
    vi.stubEnv('MODELINK_API_KEY', 'synthetic-ambient-key');
    vi.stubEnv('MODELINK_BASE_URL', 'https://attacker.invalid/v1');
    vi.stubEnv('MODELINK_MODEL', 'deepseek/deepseek-v4.1-flash');
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'synthetic-worker-request',
          model: MODELINK_MODEL,
          choices: [
            {
              message: { role: 'assistant', content: '{"value":"synthetic"}' },
              finish_reason: 'stop',
            },
          ],
        }),
      ),
    );
    const worker = await startWorker();
    try {
      expect(send).not.toHaveBeenCalled();
      const input = f.demandRuntime.mock.calls[0][0];
      const result = await input.maas.generateStructured({
        messages: [{ role: 'user', content: 'Return JSON for synthetic test' }],
        promptVersion: 'test',
        schema: z.object({ value: z.string() }),
      });
      expect(result).toMatchObject({
        ok: true,
        value: { value: 'synthetic' },
        metadata: { model: MODELINK_MODEL },
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBe(MODELINK_ENDPOINT);
      expect(send.mock.calls[0][1]).toMatchObject({
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: 'Bearer synthetic-trusted-modelink-key' },
      });
      expect(JSON.parse(String(send.mock.calls[0][1]?.body)).model).toBe(
        MODELINK_MODEL,
      );
    } finally {
      await worker.stop();
      send.mockRestore();
    }
  });
  it.each([
    { MODELINK_BASE_URL: 'https://attacker.invalid/v1' },
    { MODELINK_MODEL: 'deepseek/deepseek-v4.1-flash' },
  ])(
    'rejects invalid Modelink configuration %j without a legacy request',
    async (wrong) => {
      f.env.MODELINK_API_KEY = 'synthetic-modelink-key';
      Object.assign(f.env, wrong);
      const send = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('No live network'));
      const worker = await startWorker();
      try {
        const result =
          await f.demandRuntime.mock.calls[0][0].maas.generateStructured({
            messages: [
              { role: 'user', content: 'Return JSON for synthetic test' },
            ],
            promptVersion: 'test',
            schema: z.object({ value: z.string() }),
          });
        expect(result).toMatchObject({
          ok: false,
          kind: 'configuration',
          metadata: { model: MODELINK_MODEL },
        });
        expect(send).not.toHaveBeenCalled();
      } finally {
        await worker.stop();
        send.mockRestore();
      }
    },
  );
  it('stops the shared boss when demand registration fails', async () => {
    f.registerDemand.mockRejectedValueOnce(new Error('demand register failed'));
    await expect(startWorker()).rejects.toThrow('demand register failed');
    expect(f.stop).toHaveBeenCalledOnce();
  });
  it('starts durable queue before listener and shuts down cleanly', async () => {
    const worker = await startWorker();
    expect(f.start).toHaveBeenCalledOnce();
    expect(f.register).toHaveBeenCalledOnce();
    expect(f.registerProgress).toHaveBeenCalledOnce();
    await worker.stop();
    expect(f.clientClose).toHaveBeenCalledWith(1001, 'Service stopping');
    expect(f.stop).toHaveBeenCalledOnce();
  });
  it('stops queue when registration fails', async () => {
    f.register.mockRejectedValueOnce(new Error('register failed'));
    await expect(startWorker()).rejects.toThrow('register failed');
    expect(f.stop).toHaveBeenCalledOnce();
  });
  it('stops queue if listener cannot bind', async () => {
    f.failListen = true;
    await expect(startWorker()).rejects.toThrow('listen failed');
    expect(f.stop).toHaveBeenCalledOnce();
  });
  it('rejects unknown paths, cross-origin upgrades, absent sessions and bad Access', async () => {
    const worker = await startWorker();
    const upgrade = f.serverEvents.get('upgrade')!;
    for (const [url, origin, status] of [
      ['/other', 'https://test.local', '404'],
      ['/stream', 'https://attacker.test', '403'],
    ]) {
      const socket = { end: vi.fn(), on: vi.fn(), destroy: vi.fn() };
      await upgrade({ url, headers: { origin } }, socket, Buffer.alloc(0));
      expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(socket.end).toHaveBeenCalledWith(expect.stringContaining(status));
    }
    for (const missing of ['session', 'access']) {
      if (missing === 'session') f.session.mockResolvedValueOnce(null);
      else f.access.mockRejectedValueOnce(new Error('bad access'));
      const socket = { end: vi.fn(), on: vi.fn(), destroy: vi.fn() };
      await upgrade(
        {
          url: '/stream',
          headers: {
            origin: 'https://test.local',
            cookie: ['synthetic'],
            ignored: undefined,
          },
        },
        socket,
        Buffer.alloc(0),
      );
      expect(socket.end).toHaveBeenCalledWith(expect.stringContaining('401'));
    }
    const socket = {
      end: vi.fn(),
      on: vi.fn(),
      destroy: vi.fn(),
      destroyed: false,
    };
    await upgrade(
      { url: '/stream', headers: { origin: 'https://test.local' } },
      socket,
      Buffer.alloc(0),
    );
    expect(socket.end).not.toHaveBeenCalled();
    await upgrade(
      { url: '/stream', headers: { origin: 'https://test.local' } },
      { ...socket, destroyed: true },
      Buffer.alloc(0),
    );
    await worker.stop();
  });
  it('handles heartbeats and closes binary streams without accepting recording data', async () => {
    const worker = await startWorker();
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const socket = {
      on: (event: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(event, handler),
      close: vi.fn(),
      send: vi.fn(),
      terminate: vi.fn(),
    };
    f.socketEvents.get('connection')!(socket);
    handlers.get('message')!(Buffer.from('{"type":"ping"}'), false);
    expect(socket.send).toHaveBeenCalledWith('{"type":"pong"}');
    handlers.get('message')!(Buffer.from([1]), true);
    expect(socket.close).toHaveBeenCalledWith(1003, 'Heartbeat only');
    handlers.get('error')!();
    expect(socket.terminate).toHaveBeenCalledOnce();
    await worker.stop();
  });
});
