import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  producer: vi.fn(),
  http: vi.fn(),
}));
vi.mock('../env', () => ({ getEnv: () => m.env }));
vi.mock('../db/client', () => ({ getDatabase: () => ({ db: 'demo' }) }));
vi.mock('../platform/jobs/app-runtime', () => ({
  getAppJobProducer: m.producer,
}));
vi.mock('./mcp/postgres', () => ({ createMcpPostgresHttp: m.http }));

async function fresh() {
  vi.resetModules();
  return (await import('./mcp-runtime')).mcpHttpForServer;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.env = { APP_ENV: 'test' };
  m.producer.mockResolvedValue({ boss: 'shared' });
  m.http.mockReturnValue(async () => new Response('ok'));
});

it('stays unavailable without building anything while MCP_ENDPOINT is unset', async () => {
  const mcpHttpForServer = await fresh();
  expect(mcpHttpForServer()).toBeNull();
  expect(m.producer).not.toHaveBeenCalled();
  expect(m.http).not.toHaveBeenCalled();
});
it('builds one handler per process from the shared producer and configured endpoint', async () => {
  m.env = {
    APP_ENV: 'test',
    MCP_ENDPOINT: 'https://talent.example.invalid/api/mcp',
    MCP_ALLOWED_ORIGINS: ['https://client.example.invalid'],
  };
  const mcpHttpForServer = await fresh();
  const first = await mcpHttpForServer();
  expect(await mcpHttpForServer()).toBe(first);
  expect(m.http).toHaveBeenCalledTimes(1);
  expect(m.http).toHaveBeenCalledWith(
    expect.objectContaining({
      db: { db: 'demo' },
      boss: { boss: 'shared' },
      endpoint: 'https://talent.example.invalid/api/mcp',
      allowedOrigins: ['https://client.example.invalid'],
    }),
  );
  // Both producer queues are ensured; no second pg-boss instance is created.
  expect(m.producer.mock.calls.map(([queue]) => queue).sort()).toEqual(
    ['record-arrange', 'staffing-demand'].sort(),
  );
});
it('retries the build after a failure instead of caching the rejection', async () => {
  m.env = {
    APP_ENV: 'test',
    MCP_ENDPOINT: 'https://talent.example.invalid/api/mcp',
  };
  const mcpHttpForServer = await fresh();
  m.producer.mockRejectedValueOnce(new Error('synthetic queue failure'));
  await expect(mcpHttpForServer()).rejects.toThrow('synthetic');
  expect(await mcpHttpForServer()).toBeTypeOf('function');
});
