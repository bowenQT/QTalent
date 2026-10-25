import { z } from 'zod';
type Session = { user: { id: string }; session: { expiresAt: Date } } | null;
export async function authenticateHandshake(
  headers: Headers,
  dependencies: {
    access: (headers: Headers) => Promise<void>;
    session: (headers: Headers) => Promise<Session>;
  },
) {
  await dependencies.access(headers);
  const session = await dependencies.session(headers);
  // Security expiry always uses the real clock, independently of the demo business clock.
  if (!session || session.session.expiresAt.getTime() <= Date.now())
    throw new Error('Session authentication required');
  return { accountId: session.user.id };
}
const heartbeatSchema = z.object({ type: z.literal('ping') }).strict();
export function heartbeatReply(message: string): {
  type: 'pong' | 'unsupported';
} {
  if (message.length > 1024) return { type: 'unsupported' };
  try {
    return {
      type: heartbeatSchema.safeParse(JSON.parse(message)).success
        ? 'pong'
        : 'unsupported',
    };
  } catch {
    return { type: 'unsupported' };
  }
}
