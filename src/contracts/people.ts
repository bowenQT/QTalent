import { z } from 'zod';
import {
  personIdentitySchema,
  evidenceBlockSchema,
  referencePositionBriefSchema,
} from './person';
import { sourceReferenceSchema } from './sources';

// P0 pages read the whole authorized set once and filter on the client, so they do
// not use these inputs; the query facade keeps the capability for later.
// No pagination for the bounded demo directory.
//
// Ordering contract (the query sorts after authorization, in code, not in the
// database): `teamName` and `name` by Chinese pinyin (`Intl.Collator('zh')`), then
// `id` by code point as a stable tail. The schema does not check the order because
// ICU data differs between runtimes; `expectDirectoryOrder` in the shared fixtures
// asserts it in the integration tests. No score, calibration or reference position
// takes part in any sort or filter.
export const peopleInputSchema = z.strictObject({
  query: z.string().trim().optional(),
  teamId: z.string().min(1).optional(),
});
const str = z.string().min(1);

// Everything below is computed after authorization: counts and facts never include
// projects, events or scores the caller cannot read.
const recentFactSchema = z.strictObject({
  eventId: str,
  occurredOn: z.iso.date(),
  // The event title, not a profile summary. `projectName` is omitted (key absent)
  // when the project is unreadable; no placeholder.
  title: str,
  projectName: str.optional(),
  recorderName: str,
  // The only place a list payload carries source detail: the "原文" mark needs it.
  // Any unreadable source drops the whole event.
  sources: z.array(sourceReferenceSchema).min(1),
});
// Window-free projection (the profile spectrum uses the last 12 months, so the
// two can differ). `eventCount` counts distinct events with an effective
// confirmed score; events with a conflict (spread >= 2) are not counted. Only the
// count and the anchor text of the highest level are shown: no value, mean,
// percentage or rank. Order = dimension catalogue order, never by score.
const capabilityLineSchema = z.strictObject({
  dimensionId: str,
  dimensionLabel: str,
  eventCount: z.number().int().positive(),
  topAnchor: str,
});
const projectLoadSchema = z
  .strictObject({
    // Membership not closed (`validTo` empty), whatever the project status.
    current: z.number().int().nonnegative(),
    // All memberships. Both count only projects the caller may read.
    ever: z.number().int().nonnegative(),
  })
  .refine((x) => x.current <= x.ever, '当前项目数不得大于参与过的项目数');
const quickShared = {
  person: personIdentitySchema,
  projectLoad: projectLoadSchema,
  recentFacts: evidenceBlockSchema(z.array(recentFactSchema).min(1).max(3)),
  capabilityLines: evidenceBlockSchema(
    z
      .strictObject({
        lines: z.array(capabilityLineSchema).min(1),
        // Dimensions without an effective confirmed score.
        uncoveredCount: z.number().int().nonnegative(),
      })
      .refine(
        (x) =>
          new Set(x.lines.map((l) => l.dimensionId)).size === x.lines.length,
        '维度不得重复',
      ),
  ),
};
export const managerQuickViewSchema = z.strictObject({
  role: z.enum(['manager', 'hr']),
  ...quickShared,
  referencePosition: referencePositionBriefSchema,
});
export const mentorQuickViewSchema = z.strictObject({
  role: z.literal('mentor'),
  ...quickShared,
});
export const quickViewSchema = z.discriminatedUnion('role', [
  managerQuickViewSchema,
  mentorQuickViewSchema,
]);
// Accounts with both HR (per cohort) and mentor grants get the HR variant only if
// every listed person is inside the HR scope; otherwise the whole response is the
// mentor variant (fail closed). `manager` always gets the manager variant.
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
