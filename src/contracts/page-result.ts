import { z } from 'zod';
import { peopleListSchema } from './people';
import { personSchema } from './person';
import { workbenchSchema } from './workbench';

// One result type per page, shared by the queries and the three front-end cards.
// `forbidden` is an account-level refusal (such as the system administrator) and
// `not_found` covers both "does not exist" and "outside your scope": they are
// indistinguishable on the wire. Neither carries a message or a name.
const forbiddenSchema = z.strictObject({ status: z.literal('forbidden') });
const notFoundSchema = z.strictObject({ status: z.literal('not_found') });
export const pageResult = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('ok'), data }),
    forbiddenSchema,
  ]);
export const peoplePageSchema = pageResult(peopleListSchema);
export const workbenchPageSchema = pageResult(workbenchSchema);
export const personPageSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), data: personSchema }),
  forbiddenSchema,
  notFoundSchema,
]);
export type PeoplePage = z.infer<typeof peoplePageSchema>;
export type WorkbenchPage = z.infer<typeof workbenchPageSchema>;
export type PersonPage = z.infer<typeof personPageSchema>;
