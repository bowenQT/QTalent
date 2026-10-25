import { z } from 'zod';
export const tingwuConfigSchema = z.object({
  endpoint: z.url().startsWith('https://'),
  accessKeyId: z.string().min(1),
  accessKeySecret: z.string().min(1),
  appKey: z.string().min(1),
});
const inputSchema = z.object({ sourceRef: z.string().min(1) }).strict();
const segmentSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    text: z.string(),
  })
  .refine((value) => value.endMs >= value.startMs);
type Segment = z.infer<typeof segmentSchema>;
export interface TingwuClient {
  transcribe(input: {
    sourceRef: string;
  }): Promise<{ sourceRef: string; segments: Segment[] }>;
}
export function createFakeTingwu(segments: Segment[]): TingwuClient {
  const validated = z.array(segmentSchema).parse(segments);
  return {
    async transcribe(input) {
      const value = inputSchema.parse(input);
      return {
        sourceRef: value.sourceRef,
        segments: structuredClone(validated),
      };
    },
  };
}
