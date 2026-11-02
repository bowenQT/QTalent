import 'server-only';
import { z } from 'zod';
import { EntryIdentityError } from '../auth/entry/identity';
import { EntryUsecaseError } from '../usecases/entry/context';
import { AgentSessionError } from '../usecases/agentapi/session-policy';
import { agentConversationForRequest } from '../usecases/agentapi-runtime';

const maxBody = 65536;
const bodyTimeoutMs = 5000;
const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('submit'),
    operationId: z.string(),
    text: z.string(),
  }),
  z.strictObject({ action: z.literal('advance'), operationId: z.string() }),
  z.strictObject({ action: z.literal('cancel') }),
]);
const statusCodes: Record<string, number> = {
  validation_error: 400,
  request_timeout: 408,
  request_too_large: 413,
  protocol: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  permission_changed: 409,
  cancelled: 409,
  budget: 429,
  model_failed: 502,
  unavailable: 503,
};
function reply(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie, Authorization',
    },
  });
}
const failure = (kind: string) =>
  reply({ status: kind }, statusCodes[kind] ?? 503);
class BodyFailure extends Error {
  constructor(
    readonly kind: 'validation_error' | 'request_too_large' | 'request_timeout',
  ) {
    super(kind);
  }
}
/** Read raw bytes chunk by chunk: stop and cancel as soon as the cap is
 * exceeded or the deadline passes, whatever Content-Length claimed. */
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw new BodyFailure('validation_error');
    if (Number(declared) > maxBody) throw new BodyFailure('request_too_large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new BodyFailure('validation_error');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new BodyFailure('request_timeout')),
      bodyTimeoutMs,
    );
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBody) throw new BodyFailure('request_too_large');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw error instanceof BodyFailure
      ? error
      : new BodyFailure('validation_error');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
/** Only typed domain failures keep their kind; anything else is unavailable
 * and never echoes provider, database or input detail. */
function kindOf(error: unknown): string {
  if (
    error instanceof EntryIdentityError ||
    error instanceof EntryUsecaseError ||
    error instanceof AgentSessionError
  )
    return error.kind;
  const kind = (error as { kind?: unknown } | null)?.kind;
  return kind === 'not_found' || kind === 'forbidden' || kind === 'conflict'
    ? kind
    : 'unavailable';
}

/** Same-origin Web caller only. The conversation ID comes from the route; the
 * account, person and session come from the server's Web entry verification. */
export async function handleAgentConversationCommand(
  request: Request,
  conversationId: string,
): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return failure('forbidden');
  let command: z.infer<typeof commandSchema>;
  try {
    const parsed = commandSchema.safeParse(await readBody(request));
    if (!parsed.success) return failure('validation_error');
    command = parsed.data;
  } catch (error) {
    return failure(
      error instanceof BodyFailure ? error.kind : 'validation_error',
    );
  }
  try {
    const conversation = await agentConversationForRequest(request.headers);
    if (!conversation) return failure('unavailable');
    const { identity, service } = conversation;
    const result =
      command.action === 'submit'
        ? await service.submit(
            identity,
            conversationId,
            command.operationId,
            command.text,
          )
        : command.action === 'advance'
          ? await service.advance(identity, conversationId, command.operationId)
          : await service.cancel(identity, conversationId);
    return reply(result);
  } catch (error) {
    return failure(kindOf(error));
  }
}
