import { z } from 'zod';
export const parseLimitsSchema = z.strictObject({
  maxBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxFragments: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxFragmentChars: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
