import { describe, expect, it, vi } from 'vitest';
import { createTingwuHttp } from './http';
const config = {
  endpoint: 'https://tingwu.cn-beijing.aliyuncs.com',
  accessKeyId: 'demo-id',
  accessKeySecret: 'demo-secret',
  appKey: 'demo-app',
};
describe('Tingwu HTTP boundary', () => {
  it('signs the exact JSON bytes, sorts encoded query, forbids redirect forwarding', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response('{"Code":"0","Data":{"TaskId":"demo"}}'));
    const request = createTingwuHttp(config, {
      fetch: fetcher,
      now: () => new Date('2026-10-25T10:00:00Z'),
      nonce: () => 'demo-nonce',
    });
    expect(
      await request({
        method: 'PUT',
        action: 'CreateTask',
        path: '/openapi/tingwu/v2/tasks',
        query: { type: 'realtime', operation: 'stop' },
        body: { Input: { TaskId: 'demo' } },
      }),
    ).toEqual({ Code: '0', Data: { TaskId: 'demo' } });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(
      'https://tingwu.cn-beijing.aliyuncs.com/openapi/tingwu/v2/tasks?operation=stop&type=realtime',
    );
    expect(init).toMatchObject({
      method: 'PUT',
      redirect: 'error',
      body: '{"Input":{"TaskId":"demo"}}',
      headers: {
        'x-acs-action': 'CreateTask',
        'x-acs-version': '2023-09-30',
        'x-acs-date': '2026-10-25T10:00:00Z',
      },
    });
    expect(init.headers.authorization).toContain(
      'Signature=36d9982c0fe41ac06cb9bf3dca60d923af1b618d55aca4e59e209f00259aafa0',
    );
    expect(init.headers.authorization).toMatch(
      /^ACS3-HMAC-SHA256 Credential=demo-id,SignedHeaders=.+,Signature=[a-f0-9]{64}$/,
    );
  });
  it('fails closed on configuration and never sends credentials to arbitrary endpoints', () => {
    expect(() =>
      createTingwuHttp({ ...config, endpoint: 'https://evil.example' }),
    ).toThrow('configuration_error');
    expect(() => createTingwuHttp({ ...config, accessKeySecret: '' })).toThrow(
      'configuration_error',
    );
  });
  it.each([
    [401, 'provider_auth'],
    [429, 'rate_limited'],
    [500, 'provider_failed'],
  ])(
    'maps HTTP %s without exposing bodies or retrying',
    async (status, code) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response('SECRET', { status }));
      const request = createTingwuHttp(config, { fetch: fetcher });
      await expect(
        request({
          method: 'PUT',
          action: 'CreateTask',
          path: '/openapi/tingwu/v2/tasks',
          body: {},
        }),
      ).rejects.toMatchObject({ code, httpStatus: status });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
});

describe('HTTP uncertain outcomes', () => {
  it.each(['not-json', '[]', '{"Code":"Invalid"}'])(
    'rejects invalid provider response %s',
    async (body) => {
      const request = createTingwuHttp(config, {
        fetch: vi.fn().mockResolvedValue(new Response(body)),
      });
      await expect(
        request({
          method: 'GET',
          action: 'GetTaskInfo',
          path: '/openapi/tingwu/v2/tasks/demo',
        }),
      ).rejects.toMatchObject({
        code: body.includes('Invalid') ? 'provider_failed' : 'protocol_error',
      });
    },
  );
  it('does not let arbitrary paths or already-aborted requests reach fetch', async () => {
    const fetcher = vi.fn();
    const request = createTingwuHttp(config, { fetch: fetcher });
    await expect(
      request({ method: 'GET', action: 'GetTaskInfo', path: '//evil.example' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      request({
        method: 'GET',
        action: 'GetTaskInfo',
        path: '/openapi/tingwu/v2/tasks/demo',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses an injected deadline even if the transport ignores cancellation; never retries', async () => {
    let timeout!: () => void;
    const cancel = vi.fn();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const request = createTingwuHttp(config, {
      fetch: fetcher,
      clock: {
        schedule(callback, milliseconds) {
          timeout = callback;
          expect(milliseconds).toBe(10000);
          return cancel;
        },
      },
    });
    const pending = request({
      method: 'PUT',
      action: 'CreateTask',
      path: '/openapi/tingwu/v2/tasks',
      body: {},
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
    });
    timeout();
    await assertion;
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels an in-flight request and sanitizes transport errors', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const request = createTingwuHttp(config, { fetch: fetcher });
    const pending = request({
      method: 'PUT',
      action: 'CreateTask',
      path: '/openapi/tingwu/v2/tasks',
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'aborted',
    });
    controller.abort();
    await assertion;
    const failure = createTingwuHttp(config, {
      fetch: vi.fn().mockRejectedValue(new Error('private query')),
    });
    await expect(
      failure({
        method: 'GET',
        action: 'GetTaskInfo',
        path: '/openapi/tingwu/v2/tasks/demo',
      }),
    ).rejects.toThrow('transport_error');
  });
});
