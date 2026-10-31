import { z } from 'zod';
import {
  MCP_ENTRY_TOOLS,
  entryToolInputSchemas,
  type EntryToolResult,
} from '../../../contracts/entry-tools';
import type {
  EntryIdentity,
  EntryIdentityService,
} from '../../auth/entry/identity';
import { EntryIdentityError } from '../../auth/entry/identity';
import { createEntryToolUsecase } from '../../usecases/entry/tools';

export class McpToolProtocolError extends Error {
  constructor() {
    super('Invalid tool parameters');
    this.name = 'McpToolProtocolError';
  }
}

const descriptions = {
  record_moment:
    '提交一件事的材料并返回处理回执。AI 整理是待人工确认的建议，不会确认评分或写入正式结论。',
  person_brief:
    '读取当前账号获准查看的人员速览。不会返回北森绩效、晋升材料及其引用。',
  draft_requirement: '起草项目需求并返回任务状态。不会确认需求或执行人事动作。',
} as const;

type EntryPorts<C> = Parameters<typeof createEntryToolUsecase<C>>[0];

/** Trusted server composition only; no default production identity or handlers.
 * Installed 903 authorizeOutput handlers MUST resolve the real output sources,
 * enforce current scope and exclude performance/promotion text AND citations.
 * A schema-valid DTO, a web authorization or unknown provenance is not proof.
 */
export function createMcpTools<C>(options: {
  identities: EntryIdentityService;
  entry: EntryPorts<C>;
}) {
  const handlers: EntryPorts<C>['handlers'] = {};
  for (const name of MCP_ENTRY_TOOLS) {
    const handler = options.entry.handlers[name];
    if (
      handler &&
      typeof handler.authorize === 'function' &&
      typeof handler.execute === 'function' &&
      typeof handler.authorizeOutput === 'function'
    )
      handlers[name] = handler;
  }
  const invoke = createEntryToolUsecase({ ...options.entry, handlers });
  const definitions = MCP_ENTRY_TOOLS.map((name) => ({
    name,
    description: descriptions[name],
    // Runtime 903 Zod validation still enforces refinements not expressible in
    // JSON Schema. Do not maintain another copy of a business input contract.
    inputSchema: z.toJSONSchema(entryToolInputSchemas[name], { io: 'input' }),
    annotations: {
      readOnlyHint: name === 'person_brief',
      destructiveHint: false,
      openWorldHint: name !== 'person_brief',
    },
  }));

  async function current(identity: EntryIdentity) {
    if (identity?.channel !== 'mcp')
      throw new EntryIdentityError('unauthenticated');
    await options.identities.current(identity);
  }

  return {
    async authenticate(presented: string): Promise<EntryIdentity> {
      const identity = await options.identities.authenticate('mcp', presented);
      await current(identity);
      return identity;
    },
    async list(identity: EntryIdentity) {
      await current(identity);
      return { tools: structuredClone(definitions) };
    },
    async call(identity: EntryIdentity, name: string, args: unknown) {
      if (!(MCP_ENTRY_TOOLS as readonly string[]).includes(name))
        throw new McpToolProtocolError();
      await current(identity);
      // This is the actual 903 usecase, including authorization, real output
      // validation/authorization and rollback on post-effect refusal.
      const result: EntryToolResult = await invoke(identity, { name, args });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.status !== 'success',
      };
    },
  };
}

export type McpTools = ReturnType<typeof createMcpTools>;
