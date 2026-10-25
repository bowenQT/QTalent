import { describe, expect, it } from 'vitest';
import { runExample } from './example';
describe('example durable job', () => {
  it('validates and returns deterministic metadata without an external side effect', async () =>
    expect(await runExample({ message: 'isolated-test' })).toEqual({
      received: 'isolated-test',
    }));
  it('rejects invalid jobs instead of reporting success', async () => {
    await expect(runExample({ message: '' })).rejects.toThrow();
  });
});
