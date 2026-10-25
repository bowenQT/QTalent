import { z } from 'zod';
export const maasConfigSchema = z.object({
  endpoint: z.url().startsWith('https://'),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});
export const extractionInputSchema = z
  .object({
    sourceRefs: z.array(z.string().min(1)).min(1),
    text: z.string().min(1),
  })
  .strict();
export interface MaasClient {
  extract(input: z.infer<typeof extractionInputSchema>): Promise<unknown>;
}
// Authorization and source filtering belong to the caller, never this transport boundary.
export function createFakeMaas(result: unknown): MaasClient {
  return {
    async extract(input) {
      extractionInputSchema.parse(input);
      return structuredClone(result);
    },
  };
}
