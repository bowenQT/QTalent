import { z } from 'zod';
import { notConnectedSchema, evidenceBlockSchema } from './person';
import { mentorQuickViewSchema } from './people';

// Entries describe authorized actions, not results of future staffing workflows.
const greetingSchema = z.strictObject({ displayName: z.string().min(1) });
const entrySchema = z.enum(['people', 'projects', 'record', 'find_people']);
const shared = { greeting: greetingSchema, entries: z.array(entrySchema) };
export const workbenchSchema = z.discriminatedUnion('role', [
  z.strictObject({
    role: z.literal('manager'),
    ...shared,
    findPeople: z.strictObject({
      status: z.literal('ready'),
      action: z.literal('find_people'),
    }),
    judgmentReminders: notConnectedSchema,
    noteworthyPeople: notConnectedSchema,
    noteworthyProjects: notConnectedSchema,
    myWatch: notConnectedSchema,
  }),
  z.strictObject({
    role: z.literal('hr'),
    ...shared,
    changedPeople: notConnectedSchema,
    judgmentComparison: notConnectedSchema,
    todos: notConnectedSchema,
    materialTasks: notConnectedSchema,
  }),
  z.strictObject({
    role: z.literal('mentor'),
    ...shared,
    trainees: evidenceBlockSchema(z.array(mentorQuickViewSchema).min(1)),
    todos: notConnectedSchema,
    recommendations: notConnectedSchema,
    materialTasks: notConnectedSchema,
  }),
]);
export type Workbench = z.infer<typeof workbenchSchema>;
