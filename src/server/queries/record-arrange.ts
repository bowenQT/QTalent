import 'server-only';
import { jobCommandSchema } from '../../contracts/jobs';
import { requireSession } from '../auth/next';
import { recordArrangeRequestsForServer } from '../usecases/record-arrange-runtime';

export async function readRecordArrangeJobForCurrentUser(input: unknown) {
  const checked = jobCommandSchema.pick({ jobId: true }).safeParse(input);
  if (!checked.success) return { status: 'validation_error' as const };
  const session = await requireSession();
  return recordArrangeRequestsForServer().read(
    session.user.id,
    checked.data.jobId,
  );
}
