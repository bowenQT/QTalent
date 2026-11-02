import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import type { InterviewImportPreviewResult } from '../../contracts/interview-import';
import { createClock } from '../../lib/clock';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { readInterviewImportPreview } from '../usecases/interview-import/store';

/** The /import preview read: the stored batch, rows filtered by the current HR grant. */
export async function getInterviewImportPreview(
  batchId: string,
): Promise<InterviewImportPreviewResult> {
  try {
    const session = await requireSession();
    return await readInterviewImportPreview(
      getDatabase(),
      session.user.id,
      batchId,
      createClock(getEnv().APP_ENV).now().toISOString(),
    );
  } catch (error) {
    // Sign-in redirects pass through; a failed read is stated as unavailable.
    unstable_rethrow(error);
    return { status: 'unavailable' };
  }
}
