import { z } from 'zod';
import { sourceCategorySchema, sourceReferenceSchema } from './sources';

// BOW-836 revision list (R*, U*) applied on top of #77. Conventions:
//  - Scalar display fields that may be missing are `.nullable()` and the key is
//    always present. A field the caller is not authorized to see is omitted
//    (the key does not exist), never nulled.
//  - Dates are `YYYY-MM-DD` strings (`z.iso.date()`); no client timezone maths.
//  - Nothing here is a total score, percentage, ranking or AI confidence.
//  - Names of people who recorded, scored or wrote something (`recorderName`,
//    `scoredByName`, `authorName`, `mentorNames`) are provenance attributes of
//    the record they belong to: they are shown when the record is readable and
//    never require the caller to read the signer's own talent profile (R0.6).
//    People who are the *subject* of a record (`participants[].name`) must each
//    be readable, otherwise the whole record is omitted.

export const notConnectedSchema = z.strictObject({
  status: z.literal('not_connected'),
});
// A resolved response is not a loading indicator or a substitute for a failed read.
export const emptyBlockSchema = z.strictObject({ status: z.literal('empty') });
// `reason` is printed in the UI and in `title`: a short Chinese sentence that
// never carries internal ids, rule versions, hidden-item counts or score values.
// It may name how many *events* are missing ("专业度缺 1 条事件"), which is not a score.
const reasonSchema = z
  .string()
  .min(1)
  .regex(/[一-鿿]/, '须为用户可读的中文短句');
export const insufficientEvidenceSchema = z.strictObject({
  status: z.literal('insufficient_evidence'),
  reason: reasonSchema,
});
export const unknownBlockSchema = z.strictObject({
  status: z.literal('unknown'),
  reason: reasonSchema,
});
export function evidenceBlockSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ready'), data }),
    emptyBlockSchema,
    insufficientEvidenceSchema,
    unknownBlockSchema,
  ]);
}

const str = z.string().min(1);
const day = z.iso.date();

/** Avatar facts only; the workbench trainee rows use this alone. */
export const personAvatarSchema = z.strictObject({
  id: str,
  name: str,
  hue: z.number().int().min(0).max(360),
  // An avatar resource key, never a URL or a path.
  photo: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .nullable(),
});
// `level`, `tenureLabel` and `batch` are display facts only: they never take
// part in filtering, sorting or any ability judgement.
// `batch` is the cohort chosen by the single rule in R1.4 (the visible, confirmed,
// unrevoked enrolment valid on `asOf` with the latest `validFrom`, ties by smallest
// cohort id); `tenureLabel`, `Person.landing` and the workbench `topic` are all
// computed inside that same batch context. The batch table only holds training
// camp cohorts, so `batch !== null` is exactly "第六期学员" style membership.
export const personIdentitySchema = personAvatarSchema.extend({
  demo: z.boolean(),
  teamId: str,
  teamName: str,
  teamPath: str,
  jobTitle: str,
  level: str.nullable(),
  batch: z.strictObject({ id: str, name: str }).nullable(),
  // 「入营 3 个月」「入职 2 年」: full text with its prefix, from the server's business clock.
  tenureLabel: str.nullable(),
});
export const personReadInputSchema = z.strictObject({ id: str });

// Display label (UI source tag) and authorization category are two fields.
// `contentCategorySchema` uses exactly the strings of the authorization layer's
// TalentKind. The category is a stored attribute written at import time and the
// same value feeds page projection, source reads and model input.
export const sourceLabelSchema = z.enum([
  'fact',
  'history',
  'self',
  'observation',
  'ai',
  'human',
]);
export const contentCategorySchema = z.enum([
  'evaluation',
  'management-observation',
  'restricted-evaluation',
  'performance',
  'quadrant',
]);
// Restricted reviews require a current relation to their explicit content node.
// The server filters every subject/source before constructing this response;
// cohort teaching alone still grants neither these reviews nor management content.
const mentorCategory = z.enum(['evaluation', 'restricted-evaluation']);

const sources = z.array(sourceReferenceSchema).min(1);
const scoreFacts = {
  value: z.number().int().min(1).max(5),
  anchor: str,
  scoredByName: str,
  ruleVersionId: str,
  sourceCategory: sourceCategorySchema,
  // Each confirmation carries its own fragment, not the event's sources.
  sources,
};
const confirmedScoreSchema = z.strictObject({
  state: z.literal('confirmed'),
  scoreId: str,
  dimensionId: str,
  dimensionLabel: str,
  ...scoreFacts,
});
// Equal-spread scores below are not conflicts. A conflict is a spread of at least
// 2 between effective confirmed scores of one dimension on one event; it is shown
// as such and counts towards no ability line, spectrum or reference position.
const conflictScoreSchema = z.strictObject({
  state: z.literal('conflict'),
  dimensionId: str,
  dimensionLabel: str,
  ratings: z
    .array(z.strictObject({ scoreId: str, ...scoreFacts }))
    .min(2)
    .refine((ratings) => {
      const values = ratings.map((rating) => rating.value);
      return Math.max(...values) - Math.min(...values) >= 2;
    }, '证据冲突要求评分差至少为 2'),
});
// "Insufficient" and "absent" carry no number: they are neither 0 nor a low score.
// No AI suggestion, AI original value, confidence or model version appears here.
export const eventScoreSchema = z.discriminatedUnion('state', [
  confirmedScoreSchema,
  z.strictObject({
    state: z.literal('insufficient'),
    dimensionId: str,
    dimensionLabel: str,
  }),
  z.strictObject({
    state: z.literal('absent'),
    dimensionId: str,
    dimensionLabel: str,
  }),
  conflictScoreSchema,
]);

function timelineEntrySchema<C extends z.ZodType>(category: C) {
  // Order: `occurredOn` descending, then `id` by code point. The count of
  // sources is `sources.length`; there is no separate counter.
  const base = {
    id: str,
    title: str,
    occurredOn: day,
    label: sourceLabelSchema,
    category,
    sources,
  };
  const keyEvent = z.strictObject({
    kind: z.literal('key_event'),
    ...base,
    recorderName: str,
    projectName: str.optional(),
    // Only multi-person events; every named participant was authorized one by one.
    participants: z
      .array(z.strictObject({ name: str, role: str.optional() }))
      .min(2)
      .optional(),
    selfRole: str.optional(),
    situation: str,
    behavior: str.nullable(),
    impact: str.nullable(),
    scores: z.array(eventScoreSchema),
    // A count only: no suggested value, anchor or model information.
    pendingScoreCount: z.number().int().nonnegative().optional(),
  });
  const selfReport = z.strictObject({
    kind: z.literal('self_report'),
    ...base,
  });
  const history = z.strictObject({
    kind: z.literal('history'),
    ...base,
    // The original scale is kept as written, not converted to 1-5.
    scale: z.array(z.tuple([str, str])).min(1),
  });
  return z.discriminatedUnion('kind', [keyEvent, selfReport, history]);
}

// The ability spectrum projection. It holds confirmed scores inside the window
// [`windowFrom`, `asOf`] only (the server cuts the window); the quick view uses a
// separate, window-free projection and its counts can differ.
export const capabilityScoreSchema = z.strictObject({
  id: str,
  dimensionId: str,
  dimensionLabel: str,
  status: z.literal('confirmed'),
  sourceCategory: sourceCategorySchema,
  value: z.number().int().min(1).max(5),
  anchor: str,
  scoredByName: str,
  ruleVersionId: str,
  eventId: str,
  eventTitle: str,
  occurredOn: day,
  sources,
});
const dimensionSchema = z.strictObject({
  id: str,
  label: str,
  group: z.enum(['professional', 'potential_core', 'potential_bonus']),
  state: z.enum(['scored', 'insufficient']),
  // Required when `state` is 'insufficient', e.g. 「待补受挫后如何反应的事件」.
  missing: str.optional(),
});
const capabilityProfileDataSchema = z
  .strictObject({
    // asOf - 365 days, boundary day included.
    windowFrom: day,
    dimensions: z.array(dimensionSchema).min(1),
    scores: z.array(capabilityScoreSchema).min(1),
  })
  .superRefine((profile, ctx) => {
    const known = new Set(profile.dimensions.map((d) => d.id));
    const scored = new Set(profile.scores.map((s) => s.dimensionId));
    profile.scores.forEach((score, index) => {
      if (!known.has(score.dimensionId))
        ctx.addIssue({
          code: 'custom',
          path: ['scores', index, 'dimensionId'],
          message: '分数的维度必须在 dimensions 中',
        });
      if (score.occurredOn < profile.windowFrom)
        ctx.addIssue({
          code: 'custom',
          path: ['scores', index, 'occurredOn'],
          message: '分数不得早于窗口起点',
        });
    });
    // Spectrum scores of one dimension on one event that differ by 2 or more are
    // a conflict and must not be counted at all (checked here so it also holds
    // when the timeline is not ready).
    const groups = new Map<string, number[]>();
    for (const score of profile.scores) {
      const key = `${score.eventId}\u0000${score.dimensionId}`;
      groups.set(key, [...(groups.get(key) ?? []), score.value]);
    }
    for (const [key, values] of groups)
      if (Math.max(...values) - Math.min(...values) >= 2)
        ctx.addIssue({
          code: 'custom',
          path: ['scores'],
          message: `事件维度 ${key.replace('\u0000', ' / ')} 评分差至少为 2，属于证据冲突，不得计入能力谱`,
        });
    profile.dimensions.forEach((dimension, index) => {
      const has = scored.has(dimension.id);
      if (dimension.state === 'scored' && !has)
        ctx.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'state'],
          message: 'scored 的维度至少有一条分数',
        });
      if (dimension.state === 'insufficient' && (has || !dimension.missing))
        ctx.addIssue({
          code: 'custom',
          path: ['dimensions', index, 'state'],
          message: 'insufficient 的维度须有 missing 且没有分数',
        });
    });
  });

// Reference position: the list (and quick view) gets the brief shape; the profile
// adds `bonus`. No coordinates, ever.
const referenceQuadrant = z.enum([
  'high_professional_high_potential',
  'high_professional_low_potential',
  'low_professional_high_potential',
  'low_professional_low_potential',
]);
export const referencePositionBriefSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    data: z.strictObject({
      kind: z.literal('reference'),
      quadrant: referenceQuadrant,
    }),
  }),
  insufficientEvidenceSchema,
  unknownBlockSchema,
]);
export const referencePositionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    data: z.strictObject({
      kind: z.literal('reference'),
      quadrant: referenceQuadrant,
      // Extra items (leadership, openness) average at least 4. Never changes the quadrant.
      bonus: z.boolean(),
    }),
  }),
  insufficientEvidenceSchema,
  unknownBlockSchema,
]);

// Human conclusions are signed and dated; AI inferences live in their own block
// and never pose as conclusions. The body of either must itself be authorized:
// `category` is `quadrant` / `management-observation` / `performance` whenever the
// text was produced from such inputs, even if every cited source is readable.
function humanConclusionSchema<C extends z.ZodType>(category: C) {
  return z.strictObject({
    id: str,
    text: str,
    authorName: str,
    at: day,
    category,
    sources,
  });
}
function aiInferenceSchema<C extends z.ZodType>(category: C) {
  return z.strictObject({
    id: str,
    text: str,
    nature: z.literal('ai_inference'),
    category,
    sources,
  });
}
// Only projects the caller may read; unreadable ones are omitted without a placeholder.
export const projectParticipationSchema = z.strictObject({
  id: str,
  name: str,
  role: str,
  mode: str,
  from: day,
  // null = still in the project.
  to: day.nullable(),
});
// The cohort topic and mentors of the selected batch; null when the person has no batch.
const landingSchema = z
  .strictObject({
    // The only topic project of that batch, otherwise null (the client does not guess).
    topicName: str.nullable(),
    mentorNames: z.array(str),
  })
  .nullable();

function variantShared<C extends z.ZodType>(category: C) {
  return {
    person: personIdentitySchema,
    // The page's business day; the client never reads `new Date()` for business rules.
    asOf: day,
    landing: landingSchema,
    summary: evidenceBlockSchema(
      z.array(humanConclusionSchema(category)).min(1),
    ),
    capabilityProfile: evidenceBlockSchema(capabilityProfileDataSchema),
    timeline: evidenceBlockSchema(
      z.array(timelineEntrySchema(category)).min(1),
    ),
    projects: evidenceBlockSchema(z.array(projectParticipationSchema).min(1)),
    aiInferences: evidenceBlockSchema(
      z.array(aiInferenceSchema(category)).min(1),
    ),
  };
}

type Variant = {
  asOf: string;
  capabilityProfile:
    | { status: 'ready'; data: z.infer<typeof capabilityProfileDataSchema> }
    | { status: string };
  timeline: { status: string; data?: unknown };
};
// Reference identity, independent of array order.
const sourceIds = (
  list: Array<{ fragmentId: string; originalVersionId: string }>,
) =>
  list
    .map((x) => `${x.fragmentId}\u0000${x.originalVersionId}`)
    .sort()
    .join('\u0001');
const dayNumber = (value: string) =>
  Date.parse(`${value}T00:00:00Z`) / 86_400_000;
// Cross-block checks (scores are traceable one by one and consistent between
// the event cards and the spectrum). Event cards may hold scores that fall
// outside the spectrum window; the check only runs when the profile has the same score.
function crossBlockChecks(person: Variant, ctx: z.RefinementCtx) {
  const profile =
    person.capabilityProfile.status === 'ready'
      ? (
          person.capabilityProfile as {
            data: z.infer<typeof capabilityProfileDataSchema>;
          }
        ).data
      : null;
  if (profile) {
    if (dayNumber(person.asOf) - dayNumber(profile.windowFrom) !== 365)
      ctx.addIssue({
        code: 'custom',
        path: ['capabilityProfile', 'data', 'windowFrom'],
        message: 'windowFrom 必须是 asOf 前 365 天',
      });
    const ids = profile.scores.map((s) => s.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['capabilityProfile', 'data', 'scores'],
        message: '能力谱内 id 不得重复',
      });
    profile.scores.forEach((score, index) => {
      if (score.occurredOn > person.asOf)
        ctx.addIssue({
          code: 'custom',
          path: ['capabilityProfile', 'data', 'scores', index, 'occurredOn'],
          message: '分数不得晚于 asOf',
        });
    });
  }
  const profileById = new Map(profile?.scores.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const entries =
    person.timeline.status === 'ready'
      ? (person.timeline.data as Array<{
          kind: string;
          id: string;
          title: string;
          occurredOn: string;
          scores?: z.infer<typeof eventScoreSchema>[];
        }>)
      : [];
  entries.forEach((entry, entryIndex) => {
    if (entry.kind !== 'key_event') return;
    // Confirmed scores of one dimension that differ by 2 or more must have been
    // reported as a conflict, not as separate confirmed scores.
    const byDimension = new Map<string, number[]>();
    for (const score of entry.scores ?? [])
      if (score.state === 'confirmed')
        byDimension.set(score.dimensionId, [
          ...(byDimension.get(score.dimensionId) ?? []),
          score.value,
        ]);
    for (const [dimensionId, values] of byDimension)
      if (Math.max(...values) - Math.min(...values) >= 2)
        ctx.addIssue({
          code: 'custom',
          path: ['timeline', 'data', entryIndex, 'scores'],
          message: `维度 ${dimensionId} 评分差至少为 2，须以证据冲突表示`,
        });
    // A conflicted event-dimension is excluded as a whole: no confirmed score of
    // that dimension on the event, on the card or in the spectrum.
    const conflicted = new Set(
      (entry.scores ?? []).flatMap((score) =>
        score.state === 'conflict' ? [score.dimensionId] : [],
      ),
    );
    for (const score of entry.scores ?? [])
      if (score.state === 'confirmed' && conflicted.has(score.dimensionId))
        ctx.addIssue({
          code: 'custom',
          path: ['timeline', 'data', entryIndex, 'scores'],
          message: `维度 ${score.dimensionId} 已是证据冲突，不得再有已确认分`,
        });
    profile?.scores.forEach((counted) => {
      if (counted.eventId === entry.id && conflicted.has(counted.dimensionId))
        ctx.addIssue({
          code: 'custom',
          path: ['capabilityProfile', 'data', 'scores'],
          message: `证据冲突的事件维度 ${counted.dimensionId} 不得计入能力谱`,
        });
    });
    entry.scores?.forEach((score, scoreIndex) => {
      const path = ['timeline', 'data', entryIndex, 'scores', scoreIndex];
      const ratings =
        score.state === 'conflict'
          ? score.ratings
          : score.state === 'confirmed'
            ? [score]
            : [];
      for (const rating of ratings) {
        if (seen.has(rating.scoreId))
          ctx.addIssue({
            code: 'custom',
            path,
            message: '事件卡内 scoreId 不得重复',
          });
        seen.add(rating.scoreId);
        const counted = profileById.get(rating.scoreId);
        // A conflict is never counted; a confirmed score must match its spectrum twin.
        if (score.state === 'conflict' && counted)
          ctx.addIssue({
            code: 'custom',
            path,
            message: '证据冲突的评分不得进入能力谱',
          });
        if (score.state === 'confirmed' && counted) {
          const same =
            counted.eventId === entry.id &&
            counted.eventTitle === entry.title &&
            counted.occurredOn === entry.occurredOn &&
            counted.dimensionId === score.dimensionId &&
            counted.value === score.value &&
            counted.ruleVersionId === score.ruleVersionId &&
            counted.sourceCategory === score.sourceCategory &&
            sourceIds(counted.sources) === sourceIds(score.sources);
          if (!same)
            ctx.addIssue({
              code: 'custom',
              path,
              message: '事件卡与能力谱中同一 scoreId 的内容必须一致',
            });
        }
      }
    });
  });
}

// Role is server-produced, never accepted as a request parameter. These strict
// variants validate a projection; they do not perform authorization themselves.
// Accounts holding both HR (by cohort) and mentor grants get the HR variant only
// when everyone in the response is inside the HR scope, otherwise the whole
// response is the mentor variant (fail closed). `manager` (company scope) always
// gets the manager variant. Mentor variants carry no reference position,
// calibration, version history, hidden counts or non-evaluation content.
export const personSchema = z
  .discriminatedUnion('role', [
    z.strictObject({
      role: z.enum(['manager', 'hr']),
      ...variantShared(contentCategorySchema),
      referencePosition: referencePositionSchema,
      calibrationHistory: notConnectedSchema,
      versionsAndChanges: notConnectedSchema,
    }),
    z.strictObject({
      role: z.literal('mentor'),
      ...variantShared(mentorCategory),
    }),
  ])
  .superRefine((person, ctx) => crossBlockChecks(person as Variant, ctx));
export type PersonIdentity = z.infer<typeof personIdentitySchema>;
export type PersonAvatar = z.infer<typeof personAvatarSchema>;
export type PersonReadInput = z.infer<typeof personReadInputSchema>;
export type CapabilityScore = z.infer<typeof capabilityScoreSchema>;
export type EventScore = z.infer<typeof eventScoreSchema>;
export type ReferencePosition = z.infer<typeof referencePositionSchema>;
export type Person = z.infer<typeof personSchema>;
