import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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
  failListen: false,
  clientClose: vi.fn(),
  closeSockets: vi.fn(),
}));
vi.mock('../server/env', () => ({
  getEnv: () => ({
    APP_ENV: 'test',
    QINIU_MAAS_API_KEY: undefined,
    DATABASE_URL: 'test',
    BETTER_AUTH_URL: 'https://test.local',
    WORKER_PORT: 3001,
  }),
}));
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
describe('worker lifecycle with transport boundaries replaced', () => {
  it('reuses the worker boss and registers demand with optional MaaS key without fetch', async () => {
    const send = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('No live network'));
    try {
      const worker = await startWorker();
      expect(f.registerDemand).toHaveBeenCalledOnce();
      const input = f.demandRuntime.mock.calls[0][0];
      expect(input.boss).toBe(worker.boss);
      expect(input.businessDate()).toBe('2026-09-04');
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
      });
      expect(send).not.toHaveBeenCalled();
      await worker.stop();
    } finally {
      send.mockRestore();
    }
  });
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
