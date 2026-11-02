import 'server-only';
import { mcpHttpForServer } from '../usecases/mcp-runtime';

const unavailable = () =>
  Response.json(
    { error: 'unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store, private' } },
  );

/** Streamable HTTP entry. Authentication, Origin/Host checks and every error
 * mapping stay in the MCP handler; this only resolves the single instance. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  let handler;
  try {
    handler = await mcpHttpForServer();
  } catch {
    return unavailable();
  }
  return handler ? handler(request) : unavailable();
}
