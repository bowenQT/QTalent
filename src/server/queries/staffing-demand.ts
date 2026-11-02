import 'server-only';
import { requireSession } from '../auth/next';
import { staffingDemandRuntime } from './staffing-runtime';
import { DemandAccessError } from '../modules/staffing/demand/service';

/** Missing and inaccessible demands have the same outward result, including history. */
export async function readStaffingDemand(demandId: string, revision?: number) {
  const session = await requireSession();
  if (
    !demandId.trim() ||
    (revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1))
  )
    return null;
  try {
    return await (
      await staffingDemandRuntime()
    ).service.read(session.user.id, demandId, revision);
  } catch (error) {
    if (error instanceof DemandAccessError) return null;
    throw error;
  }
}
