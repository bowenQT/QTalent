import { z } from 'zod';

export const MAAS_MODEL = 'deepseek/deepseek-v4.1-flash' as const;
export const MAAS_ENDPOINT = 'https://api.qnaigc.com/v1/chat/completions';

const messageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().trim().min(1),
  })
  .strict();
const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
  promptVersion: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/),
});

export interface StructuredMaasInput<
  T extends Record<string, unknown>,
  TMessage = z.input<typeof messageSchema>,
> {
  /** Only caller-authorized, minimized evidence belongs here. Include a JSON instruction. */
  messages: TMessage[];
  promptVersion: string;
  /** A concrete Zod object schema; no coercion of unsupported enum values. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}
export interface MaasMetadata<TModel extends string = typeof MAAS_MODEL> {
  model: TModel;
  promptVersion: string;
  attempts: number;
  elapsedMs: number;
  requestId?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
export type MaasFailureKind =
  | 'configuration'
  | 'invalid_request'
  | 'authentication'
  | 'permission'
  | 'network'
  | 'outcome_unknown'
  | 'invalid_response'
  | 'cancelled';
export type MaasResult<T, TModel extends string = typeof MAAS_MODEL> =
  | { ok: true; value: T; metadata: MaasMetadata<TModel> }
  | {
      ok: false;
      kind: MaasFailureKind;
      retryable: boolean;
      metadata: MaasMetadata<TModel>;
      reason?:
        'timeout' | 'cancelled' | 'network' | 'rate_limited' | 'unavailable';
      status?: number;
    };
export interface StructuredMaasClient<
  TModel extends string = typeof MAAS_MODEL,
  TMessage = z.input<typeof messageSchema>,
> {
  generateStructured<T extends Record<string, unknown>>(
    input: StructuredMaasInput<T, TMessage>,
  ): Promise<MaasResult<T, TModel>>;
}

export function metadataFor(input: { promptVersion: string }): MaasMetadata;
export function metadataFor<TModel extends string>(
  input: { promptVersion: string },
  model: TModel,
): MaasMetadata<TModel>;
export function metadataFor(
  input: { promptVersion: string },
  model: string = MAAS_MODEL,
): MaasMetadata<string> {
  return {
    model,
    promptVersion: input.promptVersion,
    attempts: 0,
    elapsedMs: 0,
  };
}
export function validInput<T extends Record<string, unknown>>(
  input: StructuredMaasInput<T>,
): boolean {
  const checked = requestSchema.safeParse(input);
  return (
    checked.success &&
    input.schema instanceof z.ZodObject &&
    input.messages.some((message) => /json/i.test(message.content)) &&
    Buffer.byteLength(JSON.stringify(input.messages), 'utf8') <= 262144
  );
}
export function validateValue<
  T extends Record<string, unknown>,
  TModel extends string = typeof MAAS_MODEL,
>(
  value: unknown,
  input: { schema: z.ZodType<T> },
  metadata: MaasMetadata<TModel>,
): MaasResult<T, TModel> {
  try {
    const parsed = input.schema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data, metadata };
  } catch {
    // Custom synchronous validators must not expose provider content in exceptions.
  }
  return { ok: false, kind: 'invalid_response', retryable: false, metadata };
}
