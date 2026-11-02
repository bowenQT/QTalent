import { beforeEach, expect, it, vi } from 'vitest';
import type { VerifiedAgentOwner } from '../auth/entry/persistent';
const m = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  web: { verify: vi.fn(), current: vi.fn() },
  agent: vi.fn(),
  client: vi.fn(),
  ports: vi.fn(),
  service: vi.fn(),
  producer: vi.fn(),
  records: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => m.env }));
vi.mock('../db/client', () => ({ getDatabase: () => ({ db: 'demo' }) }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: m.producer,
}));
vi.mock('../auth/entry/web', () => ({
  createWebEntryAuthenticator: () => m.web,
}));
vi.mock('../auth/entry/persistent', () => ({
  createAgentApiEntryAuthenticator: m.agent,
}));
vi.mock('../integrations/agentapi/client', () => ({
  createAgentApiClient: m.client,
}));
vi.mock('./agentapi/postgres', () => ({
  createAgentConversationPostgresPorts: m.ports,
}));
vi.mock('./agentapi/service', () => ({
  createAgentConversationService: m.service,
}));
vi.mock('./staffing-demand-runtime', () => ({
  staffingDemandQueue: 'staffing-demand',
  createStaffingDemandRuntime: () => ({ service: { demo: 'demands' } }),
}));
vi.mock('../jobs/record-arrange', () => ({
  recordArrangeQueue: 'record-arrange',
}));
vi.mock('./record-batch-arrange-requests', () => ({
  createRecordBatchArrangeRequests: m.records,
}));

const config = {
  AGENTAPI_API_KEY: 'synthetic-offline-key',
  AGENTAPI_REGION: 'cn-east',
  AGENTAPI_AGENT_ID: 'agt_demo',
  AGENTAPI_AGENT_VERSION: '3',
  AGENTAPI_ENVIRONMENT_ID: 'env_demo',
  AGENTAPI_MODEL_ID: 'demo-model',
};
const binding = (credentialId: string) => ({
  credentialId,
  accountId: 'demo-account',
  personId: 'demo-person',
  revision: 1,
  expiresAt: '2099-01-01T00:00:00.000Z',
  revokedAt: null,
});
let owner: (() => Promise<VerifiedAgentOwner | null>) | undefined;
async function load() {
  vi.resetModules();
  return (await import('./agentapi-runtime')).agentConversationForRequest;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env = { APP_ENV: 'test', ...config };
  m.web.verify.mockResolvedValue(binding('demo-web-session'));
  m.web.current.mockResolvedValue(binding('demo-web-session'));
  m.agent.mockImplementation((_db, verifiedOwner) => {
    owner = verifiedOwner;
    const read = async () => {
      await verifiedOwner();
      return binding('demo-agent-binding');
    };
    return { verify: read, current: read };
  });
  m.client.mockReturnValue({ demo: 'provider' });
  m.ports.mockReturnValue({ demo: 'ports' });
  m.service.mockReturnValue({ demo: 'service' });
  m.records.mockReturnValue({ demo: 'records' });
});

it.each(Object.keys(config))(
  'stays unavailable without authenticating when %s is missing',
  async (key) => {
    m.env = { APP_ENV: 'test', ...config, [key]: undefined };
    const agentConversationForRequest = await load();
    expect(await agentConversationForRequest(new Headers())).toBeNull();
    expect(m.web.verify).not.toHaveBeenCalled();
    expect(m.client).not.toHaveBeenCalled();
  },
);
it('proves the owner from the current Web entry identity on every AgentAPI read', async () => {
  const agentConversationForRequest = await load();
  const headers = new Headers({ cookie: 'synthetic' });
  const result = await agentConversationForRequest(headers);
  expect(m.web.verify).toHaveBeenCalledExactlyOnceWith(headers);
  expect(m.client).toHaveBeenCalledExactlyOnceWith({
    apiKey: 'synthetic-offline-key',
    region: 'cn-east',
    agentId: 'agt_demo',
    agentVersion: 3,
    environmentId: 'env_demo',
    modelId: 'demo-model',
  });
  expect(await owner!()).toEqual({
    accountId: 'demo-account',
    sessionId: 'demo-web-session',
    agentId: 'agt_demo',
  });
  // Authentication plus the explicit owner read each re-check the Web session.
  expect(m.web.current).toHaveBeenCalledTimes(2);
  expect(m.ports).toHaveBeenCalledWith(
    expect.objectContaining({
      db: { db: 'demo' },
      domains: { demands: { demo: 'demands' }, records: { demo: 'records' } },
    }),
  );
  expect(m.service).toHaveBeenCalledWith(
    { demo: 'ports' },
    { demo: 'provider' },
  );
  expect(result).toMatchObject({
    identity: { channel: 'agentapi' },
    service: { demo: 'service' },
  });
});
it('reuses the provider client for unchanged settings only', async () => {
  const agentConversationForRequest = await load();
  await agentConversationForRequest(new Headers());
  await agentConversationForRequest(new Headers());
  expect(m.client).toHaveBeenCalledTimes(1);
  m.env = { ...m.env, AGENTAPI_AGENT_VERSION: '4' };
  await agentConversationForRequest(new Headers());
  expect(m.client).toHaveBeenCalledTimes(2);
});
it('fails closed when the Web session no longer verifies, before any conversation work', async () => {
  const agentConversationForRequest = await load();
  m.web.current.mockRejectedValue(new Error('synthetic logout'));
  await expect(
    agentConversationForRequest(new Headers()),
  ).rejects.toMatchObject({ kind: 'unavailable' });
  expect(m.ports).not.toHaveBeenCalled();
  m.web.verify.mockResolvedValue(null);
  await expect(
    agentConversationForRequest(new Headers()),
  ).rejects.toMatchObject({ kind: 'unauthenticated' });
});
it('enqueues record arrangement on the caller transaction through the shared producer', async () => {
  const agentConversationForRequest = await load();
  await agentConversationForRequest(new Headers());
  const { enqueue } = m.records.mock.calls[0]![0] as {
    enqueue(
      tx: unknown,
      job: { jobId: string; attempt: number },
    ): Promise<void>;
  };
  const send = vi
    .fn()
    .mockResolvedValueOnce('demo-queued')
    .mockResolvedValueOnce(null);
  m.producer.mockResolvedValue({ send });
  const tx = { execute: vi.fn() };
  await enqueue(tx, { jobId: 'demo-job', attempt: 1 });
  expect(m.producer).toHaveBeenCalledWith('record-arrange');
  expect(send).toHaveBeenCalledWith(
    'record-arrange',
    { jobId: 'demo-job', attempt: 1 },
    expect.objectContaining({ retryLimit: 0, db: expect.anything() }),
  );
  await expect(enqueue(tx, { jobId: 'demo-job', attempt: 2 })).rejects.toThrow(
    'not committed',
  );
});
