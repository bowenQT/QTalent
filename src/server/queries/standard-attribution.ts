import 'server-only';
import { createClock } from '../../lib/clock';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import {
  createModelinkMaasClientFromEnv,
  MODELINK_MODEL,
} from '../integrations/maas';
import { nativeAttributionReadServices } from '../usecases/standard-attribution/batch-state';
import { createStandardAttributionUsecases } from '../usecases/standard-attribution/hypotheses';
import { createAttributionPostgresStore } from '../usecases/standard-attribution/postgres';

/**
 * BOW-921 on the native store, reading 919 canonical facts and the 918 standard
 * in the store's own transaction. Business time is the app clock; the ledger
 * keeps real execution time. Without Modelink configuration the model answers
 * model_failed and HR still attributes by hand.
 */
export function standardAttributionApp() {
  const clock = createClock(getEnv().APP_ENV);
  const store = createAttributionPostgresStore(
    getDatabase(),
    nativeAttributionReadServices(() => clock.now()),
  );
  return createStandardAttributionUsecases(
    store,
    {
      expectedModel: MODELINK_MODEL,
      client: createModelinkMaasClientFromEnv(),
    },
    { now: () => clock.now() },
  );
}
