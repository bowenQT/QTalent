import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import {
  trackPoolShutdown,
  trackChildShutdown,
  cleanupReferenceResources,
} from './resource-cleanup';
class FakePool extends EventEmitter {
  end = vi.fn<() => Promise<void>>(async () => undefined);
  query = vi.fn<(sql: string) => Promise<void>>(async () => undefined);
}
class FakeChild extends EventEmitter {
  kill = vi.fn<(signal: NodeJS.Signals) => boolean>(() => true);
}
afterEach(() => vi.useRealTimers());
it('does not consider pool.end resolution a socket drain', async () => {
  const pool = new FakePool();
  const close = trackPoolShutdown(pool as unknown as Pool);
  const client = {};
  pool.emit('connect', client);
  let finished = false;
  const pending = close().then(() => {
    finished = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  pool.emit('remove', client);
  await pending;
  expect(finished).toBe(true);
});
it('awaits every tracked client and reports idle errors instead of hiding them', async () => {
  const pool = new FakePool();
  const close = trackPoolShutdown(pool as unknown as Pool);
  const a = {},
    b = {};
  pool.emit('connect', a);
  pool.emit('connect', b);
  const error = new Error('unexpected disconnect');
  pool.emit('error', error);
  const pending = close();
  const assertion = expect(pending).rejects.toThrow('unexpected disconnect');
  pool.emit('remove', a);
  pool.emit('remove', b);
  await assertion;
});
it('handles a client connecting while pool.end is pending', async () => {
  const pool = new FakePool();
  let ended!: () => void;
  pool.end.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        ended = resolve;
      }),
  );
  const close = trackPoolShutdown(pool as unknown as Pool);
  let finished = false;
  const pending = close().then(() => {
    finished = true;
  });
  const client = {};
  pool.emit('connect', client);
  ended();
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  pool.emit('remove', client);
  await pending;
});
it('SIGTERM exit is insufficient until close, then cancels escalation', async () => {
  vi.useFakeTimers();
  const child = new FakeChild();
  const stop = trackChildShutdown(child as unknown as ChildProcess, 10);
  let finished = false;
  const pending = stop().then(() => {
    finished = true;
  });
  child.emit('exit', 0, null);
  await Promise.resolve();
  expect(finished).toBe(false);
  child.emit('close', 0, null);
  await pending;
  await vi.advanceTimersByTimeAsync(100);
  expect(child.kill.mock.calls).toEqual([['SIGTERM']]);
});
it('hard-kill escalation waits for actual close rather than resolving immediately', async () => {
  vi.useFakeTimers();
  const child = new FakeChild();
  const stop = trackChildShutdown(child as unknown as ChildProcess, 10);
  let finished = false;
  const pending = stop().then(() => {
    finished = true;
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
  expect(finished).toBe(false);
  child.emit('close', null, 'SIGKILL');
  await pending;
});
it('already closed process is not signalled again', async () => {
  const child = new FakeChild();
  const stop = trackChildShutdown(child as unknown as ChildProcess);
  child.emit('close', 0, null);
  await stop();
  expect(child.kill).not.toHaveBeenCalled();
});
it('cleanup drains process and app pool before non-force drop and always closes admin', async () => {
  const calls: string[] = [];
  const admin = new FakePool();
  admin.query.mockImplementation(async (sql) => {
    calls.push(sql);
  });
  await cleanupReferenceResources({
    databaseName: 'qtalent_test_' + 'a'.repeat(32),
    stopApp: async () => {
      calls.push('app');
    },
    closeAppPool: async () => {
      calls.push('pool');
    },
    admin: admin as unknown as Pool,
    closeAdminPool: async () => {
      calls.push('admin');
    },
  });
  expect(calls).toEqual([
    'app',
    'pool',
    'DROP DATABASE "qtalent_test_' + 'a'.repeat(32) + '"',
    'admin',
  ]);
});
it('failed app shutdown prevents database drop but still closes both owned pools', async () => {
  const admin = new FakePool();
  const closeAppPool = vi.fn(async () => undefined),
    closeAdminPool = vi.fn(async () => undefined);
  await expect(
    cleanupReferenceResources({
      databaseName: 'qtalent_test_' + 'b'.repeat(32),
      stopApp: async () => {
        throw new Error('process stuck');
      },
      closeAppPool,
      admin: admin as unknown as Pool,
      closeAdminPool,
    }),
  ).rejects.toThrow('process stuck');
  expect(admin.query).not.toHaveBeenCalled();
  expect(closeAppPool).toHaveBeenCalledOnce();
  expect(closeAdminPool).toHaveBeenCalledOnce();
});
it('refuses cleanup targets not matching the private random database format', async () => {
  const admin = new FakePool();
  await expect(
    cleanupReferenceResources({
      databaseName: 'production',
      closeAppPool: async () => undefined,
      admin: admin as unknown as Pool,
      closeAdminPool: async () => undefined,
    }),
  ).rejects.toThrow('database');
  expect(admin.query).not.toHaveBeenCalled();
});
it('pool drain timeout is explicit, not a successful shutdown', async () => {
  vi.useFakeTimers();
  const pool = new FakePool();
  const close = trackPoolShutdown(pool as unknown as Pool, 10);
  pool.emit('connect', {});
  const assertion = expect(close()).rejects.toThrow(
    'pool sockets did not close',
  );
  await vi.advanceTimersByTimeAsync(10);
  await assertion;
});
it('child close timeout remains failure after escalation', async () => {
  vi.useFakeTimers();
  const child = new FakeChild();
  const stop = trackChildShutdown(child as unknown as ChildProcess, 10);
  const assertion = expect(stop()).rejects.toThrow(
    'did not close after SIGKILL',
  );
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
});
it('drop failure propagates but admin connection is still drained', async () => {
  const admin = new FakePool();
  admin.query.mockRejectedValue(new Error('database still in use'));
  const closeAdminPool = vi.fn(async () => undefined);
  await expect(
    cleanupReferenceResources({
      databaseName: 'qtalent_test_' + 'c'.repeat(32),
      closeAppPool: async () => undefined,
      admin: admin as unknown as Pool,
      closeAdminPool,
    }),
  ).rejects.toThrow('database still in use');
  expect(closeAdminPool).toHaveBeenCalledOnce();
});
