import 'server-only';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { createEntryIdentityService } from '../auth/entry/identity';
import { createWebEntryAuthenticator } from '../auth/entry/web';
import { createAgentApiEntryAuthenticator } from '../auth/entry/persistent';
import {
  createAgentApiClient,
  type AgentApiClient,
  type AgentApiConfig,
} from '../integrations/agentapi/client';
import {
  createStaffingDemandRuntime,
  staffingDemandQueue,
} from './staffing-demand-runtime';
import { createRecordBatchArrangeRequests } from './record-batch-arrange-requests';
import { createAgentConversationPostgresPorts } from './agentapi/postgres';
import { createAgentConversationService } from './agentapi/service';

let client: { key: string; value: AgentApiClient } | undefined;

/** All six settings or none: a partial configuration stays unavailable. The
 * adapter validates their shape; the key is never echoed. */
function agentApiConfig(): AgentApiConfig | null {
  const env = getEnv();
  const values = [
    env.AGENTAPI_API_KEY,
    env.AGENTAPI_REGION,
    env.AGENTAPI_AGENT_ID,
    env.AGENTAPI_AGENT_VERSION,
    env.AGENTAPI_ENVIRONMENT_ID,
    env.AGENTAPI_MODEL_ID,
  ];
  if (values.some((value) => !value)) return null;
  return {
    apiKey: env.AGENTAPI_API_KEY!,
    region: env.AGENTAPI_REGION as AgentApiConfig['region'],
    agentId: env.AGENTAPI_AGENT_ID!,
    agentVersion: Number(env.AGENTAPI_AGENT_VERSION),
    environmentId: env.AGENTAPI_ENVIRONMENT_ID!,
    modelId: env.AGENTAPI_MODEL_ID!,
  };
}

/** Request-scoped conversation service for an existing, already bound
 * conversation. The owner proof is this request's Web entry identity (Access
 * assertion → Better Auth → current binding and session generation), re-read on
 * every AgentAPI credential check; no caller-supplied account or session ID is
 * trusted. Conversation creation is not offered here. Returns null while the
 * AgentAPI settings are absent so the route answers 503. */
export async function agentConversationForRequest(headers: Headers) {
  const config = agentApiConfig();
  if (!config) return null;
  const fingerprint = JSON.stringify(config);
  if (client?.key !== fingerprint)
    client = { key: fingerprint, value: createAgentApiClient(config) };
  const provider = client.value;
  const db = getDatabase();
  const wallNow = () => new Date();
  const clock = createClock(getEnv().APP_ENV);
  const businessNow = () => clock.now().toISOString();
  const web = createEntryIdentityService(
    { web: createWebEntryAuthenticator(db, wallNow) },
    wallNow,
  );
  const owner = await web.authenticate('web', headers);
  const identities = createEntryIdentityService(
    {
      agentapi: createAgentApiEntryAuthenticator(
        db,
        async () => {
          const current = await web.current(owner);
          return {
            accountId: current.accountId,
            sessionId: current.credentialId,
            agentId: config.agentId,
          };
        },
        wallNow,
      ),
    },
    wallNow,
  );
  const identity = await identities.authenticate('agentapi', true);
  const domains = {
    demands: createStaffingDemandRuntime({
      db,
      boss: () => getAppJobProducer(staffingDemandQueue),
      now: businessNow,
    }).service,
    records: createRecordBatchArrangeRequests({
      db,
      now: wallNow,
      businessNow,
      async enqueue(tx, job) {
        const boss = await getAppJobProducer(recordArrangeQueue);
        const sent = await boss.send(
          recordArrangeQueue,
          { jobId: job.jobId, attempt: job.attempt },
          { db: fromDrizzle(tx, sql), retryLimit: 0 },
        );
        if (!sent)
          throw new Error('Record arrangement enqueue was not committed');
      },
    }),
  };
  const service = createAgentConversationService(
    createAgentConversationPostgresPorts({
      db,
      identities,
      domains,
      now: businessNow,
    }),
    provider,
  );
  return { identity, service };
}
