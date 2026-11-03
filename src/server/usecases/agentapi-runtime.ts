import 'server-only';
import { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { getDatabase, type Database } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { attachmentParseQueue } from '../jobs/attachment-parse';
import {
  createEntryIdentityService,
  type EntryIdentity,
  type EntryIdentityService,
} from '../auth/entry/identity';
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

type Provider = Pick<AgentApiClient, 'send' | 'events' | 'archive'>;

/** Composition for one request whose Web entry identity is already issued.
 * The Web check (Access assertion → Better Auth → current binding and session
 * generation) runs ONCE here, on the pool, before any conversation transaction
 * holds a connection: re-running it inside the transaction would borrow a
 * second pool connection per transaction and can exhaust the pool. Inside each
 * transaction the AgentAPI reader then re-reads, on the transaction's own
 * connection under share locks, the session row (still present, unexpired,
 * same account) and its issue-time binding generation against the account's
 * current one, so logout, expiry, rebind and revocation after this check are
 * still refused. */
export async function composeAgentConversation(input: {
  db: Database;
  web: EntryIdentityService;
  owner: EntryIdentity;
  agentId: string;
  provider: Provider;
  domains: Parameters<
    typeof createAgentConversationPostgresPorts
  >[0]['domains'];
  businessNow: () => string;
  wallNow?: () => Date;
}) {
  const wallNow = input.wallNow ?? (() => new Date());
  const verified = await input.web.current(input.owner);
  const proof = Object.freeze({
    accountId: verified.accountId,
    sessionId: verified.credentialId,
    agentId: input.agentId,
  });
  const identities = createEntryIdentityService(
    {
      agentapi: createAgentApiEntryAuthenticator(
        input.db,
        async () => proof,
        wallNow,
      ),
    },
    wallNow,
  );
  const identity = await identities.authenticate('agentapi', true);
  const service = createAgentConversationService(
    createAgentConversationPostgresPorts({
      db: input.db,
      identities,
      domains: input.domains,
      now: input.businessNow,
    }),
    input.provider,
  );
  return { identity, service };
}

/** Request-scoped conversation service for an existing, already bound
 * conversation. No caller-supplied account or session ID is trusted.
 * Conversation creation is not offered here. Returns null while the AgentAPI
 * settings are absent so the route answers 503. */
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
  return composeAgentConversation({
    db,
    web,
    owner,
    agentId: config.agentId,
    provider,
    businessNow,
    wallNow,
    domains: {
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
          const queue =
            job.kind === 'media' ? attachmentParseQueue : recordArrangeQueue;
          const boss = await getAppJobProducer(queue);
          const sent = await boss.send(
            queue,
            { jobId: job.jobId, attempt: job.attempt },
            { db: fromDrizzle(tx, sql), retryLimit: 0 },
          );
          if (!sent)
            throw new Error('Record arrangement enqueue was not committed');
        },
      }),
    },
  });
}
