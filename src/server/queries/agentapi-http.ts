import 'server-only';
import { z } from 'zod';
import { EntryIdentityError } from '../auth/entry/identity';
import { EntryUsecaseError } from '../usecases/entry/context';
import { AgentSessionError } from '../usecases/agentapi/session-policy';
import { agentConversationForRequest } from '../usecases/agentapi-runtime';

const maxBody = 65536;
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
  const length = Number(request.headers.get('content-length'));
  if (!Number.isSafeInteger(length) || length <= 0 || length > maxBody)
    return failure('validation_error');
  let command: z.infer<typeof commandSchema>;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBody) return failure('validation_error');
    const parsed = commandSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return failure('validation_error');
    command = parsed.data;
  } catch {
    return failure('validation_error');
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
