import { describe, expect, it, vi } from 'vitest';
import { warmReferenceRoutes } from './app-readiness';

describe('reference app readiness', () => {
  it('fully reads anonymous auth and protected route responses before browser work', async () => {
    const events: string[] = [];
    const transport = vi.fn(async (input: string, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      expect(init?.redirect).toBe('manual');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      events.push(input);
      if (input.endsWith('/api/auth/get-session')) {
        return {
          status: 200,
          headers: new Headers(),
          text: async () => {
            events.push('session body');
            return 'null';
          },
        };
      }
      return {
        status: 307,
        headers: new Headers({ location: '/login' }),
        text: async () => {
          events.push('redirect body');
          return '';
        },
      };
    });
    await warmReferenceRoutes(
      'http://127.0.0.1:3000',
      Date.now() + 1000,
      transport,
    );
    expect(events).toEqual([
      'http://127.0.0.1:3000/api/auth/get-session',
      'session body',
      'http://127.0.0.1:3000/projects',
      'redirect body',
    ]);
  });
  it.each([500, 401])(
    'fails closed for auth endpoint status %s',
    async (status) => {
      const transport = vi.fn(async () => ({
        status,
        headers: new Headers(),
        text: async () => '',
      }));
      await expect(
        warmReferenceRoutes(
          'http://localhost:3000',
          Date.now() + 1000,
          transport,
        ),
      ).rejects.toThrow('Anonymous session readiness failed');
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [200, '/login'],
    [307, '/projects'],
    [307, 'https://example.com/login'],
  ])(
    'rejects an unexpected protected response %s %s',
    async (status, location) => {
      const transport = vi
        .fn()
        .mockResolvedValueOnce({
          status: 200,
          headers: new Headers(),
          text: async () => 'null',
        })
        .mockResolvedValueOnce({
          status,
          headers: new Headers({ location: String(location) }),
          text: async () => '',
        });
      await expect(
        warmReferenceRoutes(
          'http://localhost:3000',
          Date.now() + 1000,
          transport,
        ),
      ).rejects.toThrow('Anonymous projects readiness failed');
    },
  );
  it('shares the startup deadline instead of extending browser assertions', async () => {
    const transport = vi.fn();
    await expect(
      warmReferenceRoutes('http://localhost:3000', Date.now() - 1, transport),
    ).rejects.toThrow('startup deadline');
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects an authenticated session in an anonymous warmup', async () => {
    const transport = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => '{"session":{"id":"test"}}',
    }));
    await expect(
      warmReferenceRoutes(
        'http://localhost:3000',
        Date.now() + 1000,
        transport,
      ),
    ).rejects.toThrow('Anonymous session readiness failed');
  });
});
