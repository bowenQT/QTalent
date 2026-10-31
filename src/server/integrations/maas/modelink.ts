import { z } from 'zod';
import { createStructuredChatClient } from './client';
import {
  metadataFor,
  validateValue,
  type StructuredMaasClient,
  type StructuredMaasInput,
} from './structured';

export const MODELINK_MODEL = 'google/gemini-3.8-flash' as const;
export const MODELINK_ENDPOINT = 'https://api.modelink.ai/v1/chat/completions';
const MODELINK_BASE_URL = 'https://api.modelink.ai/v1';
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_BYTES = 262144;

const textPart = z
  .object({ type: z.literal('text'), text: z.string().trim().min(1) })
  .strict();
const inlineImage = z
  .string()
  .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 32)
  .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
  .refine((value) => {
    const encoded = value.slice(value.indexOf(',') + 1);
    const bytes = Buffer.from(encoded, 'base64');
    return (
      bytes.length <= MAX_IMAGE_BYTES && bytes.toString('base64') === encoded
    );
  });
const imagePart = z
  .object({
    type: z.literal('image_url'),
    image_url: z
      .object({
        url: inlineImage,
        detail: z
          .enum(['low', 'medium', 'high', 'ultra_high', 'auto'])
          .optional(),
      })
      .strict(),
  })
  .strict();
const messageSchema = z.union([
  z
    .object({
      role: z.enum(['system', 'assistant']),
      content: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      role: z.literal('user'),
      content: z.union([
        z.string().trim().min(1),
        z
          .array(z.discriminatedUnion('type', [textPart, imagePart]))
          .min(1)
          .max(100),
      ]),
    })
    .strict(),
]);
const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(100),
  promptVersion: z.string().regex(/^[A-Za-z0-9._:/-]{1,128}$/),
});
type ModelinkMessage = z.input<typeof messageSchema>;
export type ModelinkStructuredInput<T extends Record<string, unknown>> =
  StructuredMaasInput<T, ModelinkMessage>;
export type ModelinkMaasClient = StructuredMaasClient<
  typeof MODELINK_MODEL,
  ModelinkMessage
>;

function validModelinkInput(
  input: ModelinkStructuredInput<Record<string, unknown>>,
): boolean {
  const checked = requestSchema.safeParse(input);
  if (!checked.success || !(input.schema instanceof z.ZodObject)) return false;
  if (
    Buffer.byteLength(JSON.stringify(input.messages), 'utf8') >
    MAX_PAYLOAD_BYTES
  )
    return false;
  const texts: string[] = [];
  let imageCount = 0;
  // Count the exact bytes that will be sent, including whitespace removed by Zod trim.
  for (const message of input.messages) {
    if (typeof message.content === 'string') texts.push(message.content);
    else
      for (const part of message.content) {
        if (part.type === 'text') texts.push(part.text);
        else imageCount++;
      }
  }
  return (
    imageCount <= 10 &&
    texts.some((text) => /json/i.test(text)) &&
    Buffer.byteLength(JSON.stringify(texts), 'utf8') <= MAX_TEXT_BYTES
  );
}

/** Explicit opt-in: configuration and evidence must come from trusted server code. */
export function createModelinkMaasClient(
  configuration: unknown,
  transport: { fetch?: typeof fetch } = {},
): ModelinkMaasClient {
  return createStructuredChatClient(
    configuration,
    {
      endpoint: MODELINK_ENDPOINT,
      model: MODELINK_MODEL,
      validInput: validModelinkInput,
    },
    transport,
  );
}

/** Only invoked by server composition or an explicit manual probe; never loads env files. */
export function createModelinkMaasClientFromEnv(
  environment: Record<string, string | undefined> = process.env,
  transport: { fetch?: typeof fetch } = {},
): ModelinkMaasClient {
  const checked = z
    .object({
      MODELINK_API_KEY: z.string().regex(/^[^\s]+$/),
      MODELINK_BASE_URL: z
        .literal(MODELINK_BASE_URL)
        .default(MODELINK_BASE_URL),
      MODELINK_MODEL: z.literal(MODELINK_MODEL).default(MODELINK_MODEL),
    })
    .safeParse(environment);
  return createModelinkMaasClient(
    checked.success
      ? {
          apiKey: checked.data.MODELINK_API_KEY,
          endpoint: `${checked.data.MODELINK_BASE_URL}/chat/completions`,
          model: checked.data.MODELINK_MODEL,
        }
      : {},
    transport,
  );
}

export function createFakeModelinkMaas(value: unknown): ModelinkMaasClient {
  return {
    async generateStructured(input) {
      const metadata = metadataFor(input, MODELINK_MODEL);
      if (!validModelinkInput(input))
        return {
          ok: false,
          kind: 'invalid_request',
          retryable: false,
          metadata,
        };
      if (input.signal?.aborted)
        return { ok: false, kind: 'cancelled', retryable: false, metadata };
      const result = validateValue(structuredClone(value), input, metadata);
      if (input.signal?.aborted)
        return { ok: false, kind: 'cancelled', retryable: false, metadata };
      return result;
    },
  };
}
