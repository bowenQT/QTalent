import { z } from 'zod';
import {
  personIdentitySchema,
  citedStatementSchema,
  capabilityScoreSchema,
  projectParticipationSchema,
  evidenceBlockSchema,
  referencePositionSchema,
} from './person';

// No pagination for the bounded demo directory. Queries authorize, filter, then
// order by teamName, name, id (stable tie-break); no score/calibration sort/filter.
export const peopleInputSchema = z.strictObject({
  query: z.string().trim().optional(),
  teamId: z.string().min(1).optional(),
});
const shared = {
  person: personIdentitySchema,
  summary: evidenceBlockSchema(z.array(citedStatementSchema).min(1)),
  capabilityProfile: evidenceBlockSchema(z.array(capabilityScoreSchema).min(1)),
  projects: evidenceBlockSchema(z.array(projectParticipationSchema).min(1)),
};
export const managerQuickViewSchema = z.strictObject({
  role: z.enum(['manager', 'hr']),
  ...shared,
  referencePosition: referencePositionSchema,
});
export const mentorQuickViewSchema = z.strictObject({
  role: z.literal('mentor'),
  ...shared,
});
export const quickViewSchema = z.discriminatedUnion('role', [
  managerQuickViewSchema,
  mentorQuickViewSchema,
]);
export const peopleListSchema = z
  .discriminatedUnion('role', [
    z.strictObject({
      role: z.enum(['manager', 'hr']),
      people: z.array(managerQuickViewSchema),
      total: z.number().int().nonnegative(),
    }),
    z.strictObject({
      role: z.literal('mentor'),
      people: z.array(mentorQuickViewSchema),
      total: z.number().int().nonnegative(),
    }),
  ])
  .refine((x) => x.total === x.people.length, '计数只包含授权并筛选后的人员')
  .refine(
    (x) => new Set(x.people.map((p) => p.person.id)).size === x.people.length,
    '人员不得重复',
  )
  .refine((x) => x.people.every((p) => p.role === x.role), '角色投影须一致');
export type PeopleInput = z.infer<typeof peopleInputSchema>;
export type QuickView = z.infer<typeof quickViewSchema>;
export type PeopleList = z.infer<typeof peopleListSchema>;
