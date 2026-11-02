import {
  createModelinkMaasClient,
  MODELINK_ENDPOINT,
  MODELINK_MODEL,
} from '../integrations/maas';
import { createRecordArrangeApplication } from './record-arrange-application';

export interface RecordArrangeModelEnvironment {
  MODELINK_API_KEY?: string;
  MODELINK_BASE_URL?: string;
  MODELINK_MODEL?: string;
}

/** One provider dispatch per native job attempt; explicit retry is owned by842.
 * Importing or constructing this factory never reads files or sends a request. */
export function createRecordArrangeModelClient(
  environment: RecordArrangeModelEnvironment,
  transport: { fetch?: typeof fetch } = {},
) {
  return createModelinkMaasClient(
    {
      apiKey: environment.MODELINK_API_KEY,
      endpoint:
        environment.MODELINK_BASE_URL === undefined
          ? MODELINK_ENDPOINT
          : `${environment.MODELINK_BASE_URL}/chat/completions`,
      model: environment.MODELINK_MODEL ?? MODELINK_MODEL,
      maxAttempts: 1,
      attemptTimeoutMs: 30000,
      totalTimeoutMs: 45000,
      maxTokens: 8192,
      maxResponseBytes: 1048576,
    },
    transport,
  );
}

/** X1 calls register() once using the existing worker boss and business clock.
 * This factory does not start/stop a boss, create a DB pool, or load env files. */
export function createRecordArrangeWorker(
  input: Omit<
    Parameters<typeof createRecordArrangeApplication>[0],
    'client'
  > & {
    environment: RecordArrangeModelEnvironment;
  },
  transport: { fetch?: typeof fetch } = {},
) {
  const { environment, ...application } = input;
  return createRecordArrangeApplication({
    ...application,
    client: createRecordArrangeModelClient(environment, transport),
  });
}
