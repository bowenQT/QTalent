import { z } from 'zod';
import { sourceCategorySchema, sourceReferenceSchema } from './sources';

export const notConnectedSchema = z.strictObject({
  status: z.literal('not_connected'),
});
// A resolved response is not a loading indicator or a substitute for a failed read.
export const emptyBlockSchema = z.strictObject({ status: z.literal('empty') });
export const insufficientEvidenceSchema = z.strictObject({
  status: z.literal('insufficient_evidence'),
  reason: z.string().min(1),
});
export const unknownBlockSchema = z.strictObject({
  status: z.literal('unknown'),
  reason: z.string().min(1),
});
export function evidenceBlockSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ready'), data }),
    emptyBlockSchema,
    insufficientEvidenceSchema,
    unknownBlockSchema,
  ]);
}
export const personIdentitySchema = z.strictObject({
  id: z.string().min(1),
  demo: z.boolean(),
  name: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  jobTitle: z.string().min(1),
});
export const personReadInputSchema = z.strictObject({ id: z.string().min(1) });
export const citedStatementSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  nature: z.enum(['original_fact', 'self_report', 'human_conclusion']),
  sources: z.array(sourceReferenceSchema).min(1),
});
export const aiInferenceSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  nature: z.literal('ai_inference'),
  sources: z.array(sourceReferenceSchema).min(1),
});
export const managementObservationSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1),
  nature: z.literal('management_observation'),
  sources: z.array(sourceReferenceSchema).min(1),
});
export const capabilityScoreSchema = z.strictObject({
  id: z.string().min(1),
  dimensionId: z.string().min(1),
  dimensionLabel: z.string().min(1),
  status: z.literal('confirmed'),
  sourceCategory: sourceCategorySchema,
  value: z.number().int().min(1).max(5),
  anchor: z.string().min(1),
  scoredBy: z.string().min(1),
  ruleVersionId: z.string().min(1),
  sources: z.array(sourceReferenceSchema).min(1),
});
export const referencePositionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    data: z.strictObject({
      kind: z.literal('reference'),
      quadrant: z.enum([
        'high_professional_high_potential',
        'high_professional_low_potential',
        'low_professional_high_potential',
        'low_professional_low_potential',
      ]),
    }),
  }),
  insufficientEvidenceSchema,
  unknownBlockSchema,
]);
export const projectParticipationSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  participation: z.enum(['owner', 'member']),
});
export const timelineEventSchema = z.strictObject({
  id: z.string().min(1),
  occurredAt: z.iso.datetime(),
  statement: citedStatementSchema,
});
const shared = {
  person: personIdentitySchema,
  summary: evidenceBlockSchema(z.array(citedStatementSchema).min(1)),
  capabilityProfile: evidenceBlockSchema(z.array(capabilityScoreSchema).min(1)),
  timeline: evidenceBlockSchema(z.array(timelineEventSchema).min(1)),
  projects: evidenceBlockSchema(z.array(projectParticipationSchema).min(1)),
  aiInferences: evidenceBlockSchema(z.array(aiInferenceSchema).min(1)),
};
// Role is server-produced, never accepted as a request parameter. These strict
// variants validate a projection; they do not perform authorization themselves.
export const personSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.enum(['manager', 'hr']),
    ...shared,
    referencePosition: referencePositionSchema,
    managementObservations: evidenceBlockSchema(
      z.array(managementObservationSchema).min(1),
    ),
    calibrationHistory: notConnectedSchema,
    versionsAndChanges: notConnectedSchema,
  }),
  z.strictObject({ role: z.literal('mentor'), ...shared }),
]);
export type PersonIdentity = z.infer<typeof personIdentitySchema>;
export type PersonReadInput = z.infer<typeof personReadInputSchema>;
export type CapabilityScore = z.infer<typeof capabilityScoreSchema>;
export type ReferencePosition = z.infer<typeof referencePositionSchema>;
export type Person = z.infer<typeof personSchema>;
