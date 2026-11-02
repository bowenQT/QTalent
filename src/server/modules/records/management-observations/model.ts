import { createHash } from 'node:crypto';
import { z } from 'zod';
import { materialSourceLocationSchema } from '../../../../contracts/sources';

const id = z.string().min(1).max(200).regex(/\S/);
const text = z.string().min(1).max(100_000).regex(/\S/);
export const observationWhenSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);
export const observationReferenceSchema = z.strictObject({
  fragmentId: id,
  originalVersionId: id,
});
const references = z
  .array(observationReferenceSchema)
  .max(100)
  .refine(
    (values) => new Set(values.map((v) => v.fragmentId)).size === values.length,
  );
const subject = { evaluationNodeId: id, personId: id };
export const observationSubjectSchema = z.strictObject(subject);
const common = { ...subject, operationId: id, text, sources: references };
/** Internal usecase input, not an extension of the shared person/record DTO. */
export const createObservationInputSchema = z.discriminatedUnion('origin', [
  z.strictObject({
    ...common,
    origin: z.literal('manual'),
    occurredAt: observationWhenSchema,
  }),
  z.strictObject({
    ...common,
    origin: z.literal('interview_import'),
    attributionId: id,
    sources: references.refine((v) => v.length > 0),
  }),
]);
export const observationAuthorSchema = z.strictObject({
  personId: id.nullable(),
  name: text,
});
export const interviewAttributionSchema = z.strictObject({
  id,
  ...subject,
  interviewer: observationAuthorSchema,
  interviewedAt: observationWhenSchema,
  text,
  sources: references.refine((v) => v.length > 0),
});
export const managementObservationSchema = z
  .strictObject({
    id,
    ...subject,
    text,
    origin: z.enum(['manual', 'interview_import']),
    kind: z.literal('management-observation'),
    nature: z.literal('management_observation'),
    author: observationAuthorSchema,
    authorUnconfirmed: z.boolean(),
    importedBy: z
      .strictObject({ accountId: id, personId: id, name: text })
      .nullable(),
    recordedByAccountId: id,
    recordedAt: z.iso.datetime({ offset: true }),
    occurredAt: observationWhenSchema,
    attributionId: id.nullable(),
    sources: references,
  })
  .superRefine((row, ctx) => {
    const valid =
      row.origin === 'manual'
        ? row.author.personId !== null &&
          !row.authorUnconfirmed &&
          row.importedBy === null &&
          row.attributionId === null
        : row.authorUnconfirmed &&
          row.importedBy !== null &&
          row.importedBy.accountId === row.recordedByAccountId &&
          row.attributionId !== null &&
          row.sources.length > 0;
    if (!valid)
      ctx.addIssue({
        code: 'custom',
        message: 'Observation attribution is inconsistent',
      });
  });
const kind = z.enum([
  'person',
  'evaluation',
  'confirmed-score',
  'quadrant',
  'management-observation',
  'change',
  'performance',
  'ai-inference',
]);
export const observationSourceSchema = observationReferenceSchema.extend({
  location: materialSourceLocationSchema,
  kind,
  requiredKinds: z.array(kind),
  subjects: z.array(observationSubjectSchema).min(1),
});
export type ObservationSubject = z.infer<typeof observationSubjectSchema>;
export type ObservationReference = z.infer<typeof observationReferenceSchema>;
export type CreateObservationInput = z.infer<
  typeof createObservationInputSchema
>;
export type InterviewAttribution = z.infer<typeof interviewAttributionSchema>;
export type ManagementObservation = z.infer<typeof managementObservationSchema>;
export type ObservationSource = z.infer<typeof observationSourceSchema>;
export type VisibleObservation = Omit<
  ManagementObservation,
  'sources' | 'recordedByAccountId' | 'attributionId'
> & {
  sources: Pick<
    ObservationSource,
    'fragmentId' | 'originalVersionId' | 'location'
  >[];
};
export function referenceKey(value: ObservationReference): string {
  return JSON.stringify([value.fragmentId, value.originalVersionId]);
}
export function observationFingerprint(input: CreateObservationInput): string {
  const parsed = createObservationInputSchema.parse(input);
  const { sources, ...rest } = parsed;
  return createHash('sha256')
    .update(
      JSON.stringify({ ...rest, sources: sources.map(referenceKey).sort() }),
    )
    .digest('hex');
}
export class ObservationError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'forbidden'
      | 'conflict'
      | 'invalid_source'
      | 'invalid_data',
  ) {
    super(`Management observation: ${code}`);
  }
}
