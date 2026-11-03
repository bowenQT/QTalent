import { z } from 'zod';
import { materialSourceReferenceSchema } from './sources';

const text = z.string().min(1).regex(/\S/);
/** The original interview scale is not a dimension score. Source coordinates are
 * canonical PDF material references, not the legacy profile's document locators. */
export const interviewArchiveRecordSchema = z.strictObject({
  kind: z.literal('interview'),
  id: text,
  title: text,
  occurredOn: z.iso.date(),
  interviewerName: text,
  interviewerConfirmedInSystem: z.literal(false),
  importedByName: text,
  importedAt: z.iso.datetime(),
  scale: z
    .array(
      z.strictObject({
        item: text,
        value: text,
        origin: z.enum(['parser', 'hr_entry', 'not_applicable']),
        sources: z.array(materialSourceReferenceSchema),
      }),
    )
    .min(1),
  sources: z.array(materialSourceReferenceSchema).min(1),
});
export const interviewArchiveBlockSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    data: z.array(interviewArchiveRecordSchema).min(1),
  }),
  z.strictObject({ status: z.literal('empty') }),
]);
export type InterviewArchiveRecord = z.infer<
  typeof interviewArchiveRecordSchema
>;
export type InterviewArchiveBlock = z.infer<typeof interviewArchiveBlockSchema>;
