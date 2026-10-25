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

export interface StructuredMaasInput<T extends Record<string, unknown>> {
  /** Only caller-authorized, minimized evidence belongs here. Include a JSON instruction. */
  messages: z.input<typeof messageSchema>[];
  promptVersion: string;
  /** A concrete Zod object schema; no coercion of unsupported enum values. */
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}
export interface MaasMetadata {
  model: typeof MAAS_MODEL;
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
export type MaasResult<T> =
  | { ok: true; value: T; metadata: MaasMetadata }
  | {
      ok: false;
      kind: MaasFailureKind;
      retryable: boolean;
      metadata: MaasMetadata;
      reason?:
        'timeout' | 'cancelled' | 'network' | 'rate_limited' | 'unavailable';
      status?: number;
    };
export interface StructuredMaasClient {
  generateStructured<T extends Record<string, unknown>>(
    input: StructuredMaasInput<T>,
  ): Promise<MaasResult<T>>;
}

export function metadataFor(input: { promptVersion: string }): MaasMetadata {
  return {
    model: MAAS_MODEL,
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
export function validateValue<T extends Record<string, unknown>>(
  value: unknown,
  input: StructuredMaasInput<T>,
  metadata: MaasMetadata,
): MaasResult<T> {
  try {
    const parsed = input.schema.safeParse(value);
    if (parsed.success) return { ok: true, value: parsed.data, metadata };
  } catch {
    // Custom synchronous validators must not expose provider content in exceptions.
  }
  return { ok: false, kind: 'invalid_response', retryable: false, metadata };
}
