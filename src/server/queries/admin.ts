import 'server-only';
import {
  adminConnectionsPageSchema,
  type AdminConnectionsPage,
} from '../../contracts/admin-connections';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import { readDirectory } from '../modules/directory';

const notConnected = { status: 'not_connected' } as const;

/**
 * 系统管理 · 接入状态, for system administrators only (business roles are refused).
 * The WeCom, MCP and AgentAPI reads (BOW-909/910/915) are not wired yet, so every
 * block says so instead of returning an empty list or a zero.
 */
export async function getAdminConnectionsPage(): Promise<AdminConnectionsPage> {
  const session = await requireSession();
  const directory = await readDirectory(getDatabase(), session.user.id);
  if (!directory?.account.isSystemAdmin) return { status: 'forbidden' };
  return adminConnectionsPageSchema.parse({
    status: 'ok',
    data: {
      wecom: notConnected,
      mcp: notConnected,
      agentapi: notConnected,
      recentCalls: notConnected,
      bindingFailures: notConnected,
      taskFailures: notConnected,
    },
  });
}
