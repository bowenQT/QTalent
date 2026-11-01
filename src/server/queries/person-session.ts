import 'server-only';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { loadPersonData } from './person-data';
export async function loadCurrentPersonData() {
  const session = await requireSession();
  const now = createClock(getEnv().APP_ENV).now().toISOString();
  return loadPersonData(getDatabase(), session.user.id, now);
}
