import { handleAgentConversationCommand } from '../../../../../server/queries/agentapi-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ conversationId: string }> };
export async function POST(request: Request, context: Context) {
  return handleAgentConversationCommand(
    request,
    (await context.params).conversationId,
  );
}
