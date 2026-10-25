import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFakeJev,
  createJevBoundary,
  JevError,
  jevConfigSchema,
} from './index';

const input = {
  requirement: '演示：带领交付',
  evidence: [{ sourceRef: 'demo-1', text: '演示材料' }],
};
afterEach(() => vi.useRealTimers());
describe('Jev normalized decision boundary (offline)', () => {
  it.each(['supported', 'not_supported', 'insufficient', 'conflict'] as const)(
    'preserves %s without diagnostics',
    async (conclusion) => {
      const execute = vi.fn().mockResolvedValue({
        conclusion,
        confidence: 0.99,
        probabilities: [1],
        debug: 'private',
      });
      expect(await createJevBoundary(execute).decide(input)).toEqual({
        conclusion,
      });
      expect(await createFakeJev(conclusion).decide(input)).toEqual({
        conclusion,
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0][0]).toEqual(input);
    },
  );
  it('has no implicit transport or construction-time calls', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const client = createJevBoundary();
    await expect(client.decide(input)).rejects.toMatchObject({
      kind: 'configuration',
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it.each([
    { ...input, evidence: [] },
    { ...input, requirement: '  ' },
    { ...input, endpoint: 'https://untrusted.test' },
    { ...input, evidence: [{ ...input.evidence[0], confidence: 1 }] },
  ])('rejects invalid or expanded input before execution', async (bad) => {
    const execute = vi.fn();
    await expect(createJevBoundary(execute).decide(bad)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
    expect(execute).not.toHaveBeenCalled();
    await expect(createFakeJev('supported').decide(bad)).rejects.toMatchObject({
      kind: 'invalid_request',
    });
  });
  it.each([
    null,
    {},
    { conclusion: 'unknown' },
    { conclusion: 0 },
    [{ conclusion: 'supported' }],
  ])(
    'rejects malformed success without inventing insufficient',
    async (bad) => {
      await expect(
        createJevBoundary(async () => bad).decide(input),
      ).rejects.toMatchObject({ kind: 'invalid_response', retryable: false });
    },
  );
  it.each([
    'authentication',
    'permission',
    'rate_limited',
    'unavailable',
    'network',
    'outcome_unknown',
  ] as const)(
    'preserves safe %s classification, without retry or raw error',
    async (kind) => {
      const error = Object.assign(new JevError(kind), {
        confidence: 1,
        secret: 'private',
      });
      const execute = vi.fn().mockRejectedValue(error);
      const result = await createJevBoundary(execute)
        .decide(input)
        .catch((e: unknown) => e);
      expect(result).toBeInstanceOf(JevError);
      expect(result).toMatchObject({ kind, retryable: false });
      expect(JSON.stringify(result)).not.toMatch(
        /private|confidence|conclusion/,
      );
      expect(execute).toHaveBeenCalledTimes(1);
    },
  );
  it('unknown thrown failures are outcome unknown, never expose raw cause', async () => {
    const execute = vi.fn(() => {
      throw new Error('secret and evidence');
    });
    const result = await createJevBoundary(execute)
      .decide(input)
      .catch((e: unknown) => e);
    expect(result).toMatchObject({ kind: 'outcome_unknown', retryable: false });
    expect(JSON.stringify(result)).not.toMatch(/secret|evidence|conclusion/);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('cancels before execution', async () => {
    const execute = vi.fn();
    const controller = new AbortController();
    controller.abort('private');
    await expect(
      createJevBoundary(execute).decide(input, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: 'cancelled' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('cancels a pending operation, ignores late success, and removes listeners', async () => {
    let finish!: (value: unknown) => void;
    const execute = vi.fn((_input, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = createJevBoundary(execute).decide(input, {
      signal: controller.signal,
    });
    const checked = expect(pending).rejects.toMatchObject({
      kind: 'cancelled',
      retryable: false,
    });
    controller.abort('private');
    finish({ conclusion: 'supported' });
    await checked;
    expect(execute.mock.calls[0][1].aborted).toBe(true);
    expect(remove).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('times out even if execution ignores abort and rejects late, without retry', async () => {
    vi.useFakeTimers();
    let fail!: (reason: unknown) => void;
    const execute = vi.fn(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const pending = createJevBoundary(execute, { timeoutMs: 50 }).decide(input);
    const checked = expect(pending).rejects.toMatchObject({
      kind: 'timeout',
      retryable: false,
      outcomeUnknown: true,
    });
    await vi.advanceTimersByTimeAsync(50);
    await checked;
    fail(new Error('late private failure'));
    await Promise.resolve();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancellation inside execution wins over an immediate success or throw', async () => {
    for (const throws of [false, true]) {
      const controller = new AbortController();
      const execute = vi.fn(() => {
        controller.abort();
        if (throws) throw new Error('private');
        return Promise.resolve({ conclusion: 'supported' });
      });
      await expect(
        createJevBoundary(execute).decide(input, { signal: controller.signal }),
      ).rejects.toMatchObject({ kind: 'cancelled' });
    }
  });
  it('preserves exact evidence text and isolates execution mutations from caller input', async () => {
    const original = {
      requirement: ' demo ',
      evidence: [{ sourceRef: 'demo-1', text: ' evidence ' }],
    };
    const execute = vi.fn(async (received) => {
      expect(received).toEqual(original);
      received.evidence[0].text = 'changed';
      return { conclusion: 'supported' };
    });
    await createJevBoundary(execute).decide(original);
    expect(original.evidence[0].text).toBe(' evidence ');
  });
  it('clears the timer after success', async () => {
    vi.useFakeTimers();
    await createJevBoundary(async () => ({ conclusion: 'supported' })).decide(
      input,
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([0, -1, NaN, Infinity, 20001, 1.5])(
    'rejects invalid timeout %s',
    (timeoutMs) => {
      expect(() => createJevBoundary(undefined, { timeoutMs })).toThrow(
        JevError,
      );
    },
  );
  it('requires the exact model and explicit HTTPS configuration', () => {
    const config = {
      endpoint: 'https://example.test/decisions',
      apiKey: 'synthetic',
      model: 'typesafe/jev-1.14',
    };
    expect(jevConfigSchema.safeParse(config).success).toBe(true);
    expect(
      jevConfigSchema.safeParse({ ...config, model: 'jev-1.14.0' }).success,
    ).toBe(false);
    expect(jevConfigSchema.safeParse({ ...config, apiKey: ' ' }).success).toBe(
      false,
    );
  });
});
