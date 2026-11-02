import 'server-only';
import { getDatabase } from '../db/client';
import { getEnv } from '../env';
import { createClock } from '../../lib/clock';
import { getAppJobProducer } from '../platform/jobs/app-runtime';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { staffingDemandQueue } from './staffing-demand-runtime';
import { createMcpPostgresHttp } from './mcp/postgres';

type McpHandler = (request: Request) => Promise<Response>;
let pending: Promise<McpHandler> | undefined;

/** The single MCP handler for this process. Its global request cap and
 * per-account concurrency live in memory, so it must not be rebuilt per
 * request; this holds only for one app instance (the demo deployment). The
 * app's lazy pg-boss producer is shared, never a second instance. Returns null
 * while MCP_ENDPOINT is unset so the route answers 503. */
export function mcpHttpForServer(): Promise<McpHandler> | null {
  const env = getEnv();
  if (!env.MCP_ENDPOINT) return null;
  const endpoint = env.MCP_ENDPOINT;
  const allowedOrigins = env.MCP_ALLOWED_ORIGINS;
  const clock = createClock(env.APP_ENV);
  pending ??= (async () => {
    // Both queues the three tools may enqueue into must exist before use.
    await getAppJobProducer(staffingDemandQueue);
    const boss = await getAppJobProducer(recordArrangeQueue);
    return createMcpPostgresHttp({
      db: getDatabase(),
      boss,
      endpoint,
      allowedOrigins,
      businessNow: () => clock.now().toISOString(),
    });
  })().catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
