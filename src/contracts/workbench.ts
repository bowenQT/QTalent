import { z } from 'zod';
import {
  notConnectedSchema,
  evidenceBlockSchema,
  personAvatarSchema,
  unknownBlockSchema,
} from './person';

// `entries` is the only source of authorized actions: the find-people box is shown
// when it contains `find_people`, the one-line composer when it contains `record`.
// Navigation targets (people, projects) belong to the shell contract, not here.
// Managers get ['find_people'], HR ['record', 'find_people'], mentors ['record'].
const entrySchema = z.enum(['record', 'find_people']);
const entriesFor = (allowed: readonly z.infer<typeof entrySchema>[]) =>
  z
    .array(entrySchema)
    .refine((a) => new Set(a).size === a.length, '入口不得重复')
    .refine((a) => a.every((x) => allowed.includes(x)), '该角色没有此入口');
const greetingSchema = z.strictObject({ displayName: z.string().min(1) });
// The business day of this page; the client never reads `new Date()` for rules.
const shared = { greeting: greetingSchema, asOf: z.iso.date() };

// Activity is shown only on a trainee row's second line: no ranking, no scoring.
// Window: the 7 days ending on `asOf` (asOf and the 6 days before it), counting only
// key events recorded by the signed-in mentor themselves. `lastRecordedOn` is their
// latest one and may be older than the window. `ready` with `recordedThisWeek` 0
// means "known to be 0"; when it cannot be computed it is `unknown`, never 0.
const traineeActivitySchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('ready'),
    data: z.strictObject({
      recordedThisWeek: z.number().int().nonnegative(),
      lastRecordedOn: z.iso.date().nullable(),
    }),
  }),
  unknownBlockSchema,
]);
// A deliberately small projection: no summary, scores, anchors, sources or project
// detail. The same order as the people list (teamName, name, id). A quick view for
// a trainee is read per person later, not embedded here.
const traineeSchema = z.strictObject({
  person: personAvatarSchema,
  // The topic project name in the selected batch; null when there are several.
  topic: z.string().min(1).nullable(),
  activity: traineeActivitySchema,
});
export const workbenchSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('manager'),
    ...shared,
    entries: entriesFor(['find_people']),
    judgmentReminders: notConnectedSchema,
    noteworthyPeople: notConnectedSchema,
    noteworthyProjects: notConnectedSchema,
    myWatch: notConnectedSchema,
  }),
  z.strictObject({
    role: z.literal('hr'),
    ...shared,
    entries: entriesFor(['record', 'find_people']),
    changedPeople: notConnectedSchema,
    judgmentComparison: notConnectedSchema,
    todos: notConnectedSchema,
    materialTasks: notConnectedSchema,
  }),
  z.strictObject({
    role: z.literal('mentor'),
    ...shared,
    entries: entriesFor(['record']),
    trainees: evidenceBlockSchema(
      z
        .array(traineeSchema)
        .min(1)
        .refine(
          (a) => new Set(a.map((t) => t.person.id)).size === a.length,
          '学员不得重复',
        ),
    ),
    todos: notConnectedSchema,
    recommendations: notConnectedSchema,
    materialTasks: notConnectedSchema,
  }),
]);
export type Workbench = z.infer<typeof workbenchSchema>;
