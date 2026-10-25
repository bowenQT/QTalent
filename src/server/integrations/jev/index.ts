import { z } from 'zod';
export const jevConfigSchema = z.object({
  endpoint: z.url().startsWith('https://'),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});
export const conclusionSchema = z.enum([
  'supported',
  'not_supported',
  'insufficient',
  'conflict',
]);
const inputSchema = z
  .object({
    requirement: z.string().min(1),
    evidence: z
      .array(
        z.object({ sourceRef: z.string().min(1), text: z.string().min(1) }),
      )
      .min(1),
  })
  .strict();
export interface JevClient {
  decide(
    input: z.infer<typeof inputSchema>,
  ): Promise<{ conclusion: z.infer<typeof conclusionSchema> }>;
}
export function createFakeJev(
  conclusion: z.infer<typeof conclusionSchema>,
): JevClient {
  const value = conclusionSchema.parse(conclusion);
  return {
    async decide(input) {
      inputSchema.parse(input);
      return { conclusion: value };
    },
  };
}
