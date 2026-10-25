import 'server-only';
import { z } from 'zod';
import { jobCommandSchema } from '../../contracts/jobs';
import { requireSession } from '../auth/next';
import { recordArrangeRequestsForServer } from '../usecases/record-arrange-runtime';

const pageInputSchema = z.strictObject({
  personId: z.string().trim().min(1).nullable().default(null),
  projectId: z.string().trim().min(1).nullable().default(null),
});
/** Initial context only; original text is session-local input, never a URL query. */
export async function getRecordPage(input: unknown = {}) {
  const checked = pageInputSchema.safeParse(input);
  if (!checked.success) return { status: 'validation_error' as const };
  const session = await requireSession();
  return recordArrangeRequestsForServer().page(session.user.id, checked.data);
}

export async function readRecordArrangeJobForCurrentUser(input: unknown) {
  const checked = jobCommandSchema.pick({ jobId: true }).safeParse(input);
  if (!checked.success) return { status: 'validation_error' as const };
  const session = await requireSession();
  return recordArrangeRequestsForServer().read(
    session.user.id,
    checked.data.jobId,
  );
}
