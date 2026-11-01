import { z } from 'zod';

const kind = z.enum([
  'person',
  'evaluation',
  'restricted-evaluation',
  'confirmed-score',
  'quadrant',
  'management-observation',
  'change',
  'performance',
  'ai-inference',
]);
export const mediaIntakeScopeSchema = z.strictObject({
  subjects: z
    .array(
      z.strictObject({
        personId: z.string().min(1),
        evaluationNodeId: z.string().min(1),
        cohortId: z.string().nullable(),
      }),
    )
    .min(1),
  kind,
  requiredKinds: z.array(kind),
  occurredOn: z.iso.date(),
});
