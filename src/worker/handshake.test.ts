import { describe, expect, it, vi } from 'vitest';
import { authenticateHandshake, heartbeatReply } from './handshake';
describe('stream handshake', () => {
  it('requires Access before looking up a session', async () => {
    const session = vi.fn();
    await expect(
      authenticateHandshake(new Headers(), {
        access: async () => {
          throw new Error('invalid');
        },
        session,
      }),
    ).rejects.toThrow();
    expect(session).not.toHaveBeenCalled();
  });
  it('rejects absent and expired sessions, accepts current session', async () => {
    const access = vi.fn().mockResolvedValue(undefined);
    await expect(
      authenticateHandshake(new Headers(), {
        access,
        session: async () => null,
      }),
    ).rejects.toThrow();
    await expect(
      authenticateHandshake(new Headers(), {
        access,
        session: async () => ({
          user: { id: 'test-user' },
          session: { expiresAt: new Date(0) },
        }),
      }),
    ).rejects.toThrow();
    await expect(
      authenticateHandshake(new Headers(), {
        access,
        session: async () => ({
          user: { id: 'test-user' },
          session: { expiresAt: new Date(Date.now() + 60000) },
        }),
      }),
    ).resolves.toEqual({ accountId: 'test-user' });
  });
  it('supports heartbeat only, never accepts audio or commands', () => {
    expect(heartbeatReply('{"type":"ping"}')).toEqual({ type: 'pong' });
    for (const input of [
      '{',
      '{"type":"audio"}',
      '{"type":"ping","data":"x"}',
      'x'.repeat(1025),
    ])
      expect(heartbeatReply(input)).toEqual({ type: 'unsupported' });
  });
});
