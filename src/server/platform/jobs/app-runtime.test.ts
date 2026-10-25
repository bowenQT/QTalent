import { expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
vi.mock('server-only', () => ({}));
import { createAppJobProducer } from './app-runtime';

it('lazily shares startup and queue creation, then closes the isolated instance', async () => {
  const createQueue = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const boss = { createQueue, stop } as unknown as PgBoss;
  const factory = vi.fn(async () => boss);
  const runtime = createAppJobProducer(factory);
  expect(factory).not.toHaveBeenCalled();
  expect(await Promise.all([runtime.get('demand'), runtime.get('demand')])).toEqual([boss, boss]);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(createQueue).toHaveBeenCalledTimes(1);
  await runtime.close();
  expect(stop).toHaveBeenCalledTimes(1);
});
it('clears failed initialization and failed queue setup without caching a broken producer', async () => {
  const createQueue = vi.fn().mockRejectedValueOnce(new Error('queue failed')).mockResolvedValue(undefined);
  const boss = { createQueue, stop: vi.fn() } as unknown as PgBoss;
  const factory = vi.fn().mockRejectedValueOnce(new Error('startup failed')).mockResolvedValue(boss);
  const runtime = createAppJobProducer(factory);
  await expect(runtime.get('demand')).rejects.toThrow('startup failed');
  await expect(runtime.get('demand')).rejects.toThrow('queue failed');
  expect(await runtime.get('demand')).toBe(boss);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(createQueue).toHaveBeenCalledTimes(2);
  await runtime.close();
});
