import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ mcpHttpForServer: vi.fn() }));
vi.mock('../usecases/mcp-runtime', () => runtime);
import { handleMcpRequest } from './mcp-http';

const request = () =>
  new Request('https://talent.example.invalid/api/mcp', { method: 'POST' });
beforeEach(() => runtime.mcpHttpForServer.mockReset());

it('answers 503 without touching the request while MCP is not configured', async () => {
  runtime.mcpHttpForServer.mockReturnValue(null);
  const response = await handleMcpRequest(request());
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store, private');
  expect(await response.json()).toEqual({ error: 'unavailable' });
});
it('answers 503 without detail when the single handler cannot be built', async () => {
  runtime.mcpHttpForServer.mockRejectedValueOnce(
    new Error('synthetic-private-db-detail'),
  );
  const response = await handleMcpRequest(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('synthetic');
});
it('delegates the original request to the configured MCP handler', async () => {
  const handler = vi.fn(async () => new Response('ok', { status: 202 }));
  runtime.mcpHttpForServer.mockReturnValue(Promise.resolve(handler));
  const original = request();
  const response = await handleMcpRequest(original);
  expect(handler).toHaveBeenCalledExactlyOnceWith(original);
  expect(response.status).toBe(202);
});
