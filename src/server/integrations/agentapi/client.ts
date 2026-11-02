import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  customTool,
  outgoingEvent,
  parseEventPage,
  sessionId,
  type CustomTool,
  type OutgoingEvent,
  type NativeEvent,
} from './protocol';

export class AgentApiError extends Error {
  constructor(
    readonly kind:
      | 'configuration'
      | 'unauthorized'
      | 'conflict'
      | 'rate_limited'
      | 'unavailable'
      | 'protocol'
      | 'limit'
      | 'cancelled'
      | 'timeout',
    readonly uncertain = false,
    readonly createdSessionId?: string,
  ) {
    super(kind);
    this.name = 'AgentApiError';
  }
}
const origins = {
  'cn-east': 'https://agent.qiniuapi.com',
  'us-west': 'https://agent.sufy.com',
} as const;
const configSchema = z.strictObject({
  apiKey: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[^\s\u0000-\u001f\u007f]+$/u),
  region: z.enum(['cn-east', 'us-west']),
  agentId: z.string().regex(/^agt_[A-Za-z0-9_-]{1,100}$/),
  agentVersion: z.number().int().positive(),
  environmentId: z.string().regex(/^env_[A-Za-z0-9_-]{1,100}$/),
  modelId: z.string().regex(/^[A-Za-z0-9_./-]{1,150}$/),
});
export type AgentApiConfig = z.infer<typeof configSchema>;
export type AgentApiClient = ReturnType<typeof createAgentApiClient>;
const maxBytes = 1_048_576;
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AgentApiError('protocol');
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AgentApiError('limit');
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } catch {
      throw new AgentApiError('protocol');
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
/** Explicit configuration only. No import-time env, retry, SDK or network call. */
export function createAgentApiClient(
  input: AgentApiConfig,
  transport: typeof fetch = fetch,
) {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) throw new AgentApiError('configuration');
  const config = parsed.data;
  async function request(
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const write = body !== undefined;
    if (signal?.aborted) throw new AgentApiError('cancelled');
    const encoded = write ? JSON.stringify(body) : undefined;
    if (encoded && Buffer.byteLength(encoded) > 262144)
      throw new AgentApiError('limit');
    const timeout = AbortSignal.timeout(15000);
    try {
      const response = await transport(new URL(path, origins[config.region]), {
        method: write ? 'POST' : 'GET',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          'x-api-key': config.apiKey,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        ...(encoded ? { body: encoded } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        throw new AgentApiError(
          status === 401 || status === 403
            ? 'unauthorized'
            : status === 409
              ? 'conflict'
              : status === 429
                ? 'rate_limited'
                : 'unavailable',
          write && status >= 500,
        );
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof AgentApiError) {
        // A malformed/oversized successful POST acknowledgement is uncertain.
        if (write && (error.kind === 'protocol' || error.kind === 'limit'))
          throw new AgentApiError(error.kind, true);
        throw error;
      }
      throw new AgentApiError(
        signal?.aborted
          ? 'cancelled'
          : timeout.aborted
            ? 'timeout'
            : 'unavailable',
        write,
      );
    }
  }
  function checked<T>(parse: () => T, uncertain: boolean): T {
    try {
      return parse();
    } catch {
      throw new AgentApiError('protocol', uncertain);
    }
  }
  const validSession = (id: string) =>
    checked(() => sessionId.parse(id), false);
  return {
    async create(
      system: string,
      tools: readonly CustomTool[],
      signal?: AbortSignal,
    ) {
      checked(() => z.string().min(1).max(16000).parse(system), false);
      const list = checked(
        () => z.array(customTool).min(1).max(16).parse(tools),
        false,
      );
      if (new Set(list.map((t) => t.name)).size !== list.length)
        throw new AgentApiError('configuration');
      const raw = await request(
        '/v1/sessions',
        {
          title: '小犇：人才工作台对话',
          agent: {
            type: 'agent_with_overrides',
            id: config.agentId,
            version: config.agentVersion,
            model: { id: config.modelId },
            system,
            tools: list,
            mcp_servers: [],
            skills: [],
          },
          environment_id: config.environmentId,
          resources: [],
          vault_ids: [],
        },
        signal,
      );
      const id = checked(() => z.object({ id: sessionId }).parse(raw).id, true);
      try {
        const value = z
          .object({
            id: sessionId,
            status: z.literal('idle'),
            environment_id: z.literal(config.environmentId),
            agent: z.object({
              id: z.literal(config.agentId),
              version: z.literal(config.agentVersion),
              runtime: z.literal('native'),
              model: z.object({ id: z.literal(config.modelId) }),
              system: z.literal(system),
              tools: z.array(customTool),
              mcp_servers: z.array(z.unknown()).max(0).optional(),
              skills: z.array(z.unknown()).max(0).optional(),
              multiagent: z
                .object({
                  type: z.literal('coordinator'),
                  agents: z.array(z.unknown()).max(0),
                })
                .nullable()
                .optional(),
              callable_agents: z.array(z.unknown()).max(0).optional(),
            }),
            resources: z.array(z.unknown()).max(0).optional(),
            vault_ids: z.array(z.unknown()).max(0).optional(),
          })
          .parse(raw);
        if (!isDeepStrictEqual(value.agent.tools, list)) throw new Error();
      } catch {
        throw new AgentApiError('protocol', false, id);
      }
      return { id };
    },
    async send(id: string, event: OutgoingEvent, signal?: AbortSignal) {
      validSession(id);
      const payload = checked(() => outgoingEvent.parse(event), false);
      const raw = await request(
        `/v1/sessions/${id}/events`,
        { events: [payload] },
        signal,
      );
      const page = checked(() => parseEventPage(raw), true);
      if (
        page.nextPage ||
        page.events.length !== 1 ||
        page.events[0]!.type !== payload.type
      )
        throw new AgentApiError('protocol', true);
      return page.events[0]!.id;
    },
    async events(id: string, signal?: AbortSignal): Promise<NativeEvent[]> {
      validSession(id);
      const all: NativeEvent[] = [],
        pages = new Set<string>();
      let next: string | null = null;
      for (let n = 0; n < 5; n++) {
        const query = new URLSearchParams({ order: 'asc', limit: '100' });
        if (next) query.set('page', next);
        const raw = await request(
          `/v1/sessions/${id}/events?${query}`,
          undefined,
          signal,
        );
        const page = checked(() => parseEventPage(raw), false);
        all.push(...page.events);
        next = page.nextPage;
        if (next === null) return all;
        if (pages.has(next)) throw new AgentApiError('protocol');
        pages.add(next);
      }
      throw new AgentApiError('limit');
    },
    async archive(id: string, signal?: AbortSignal) {
      validSession(id);
      await request(`/v1/sessions/${id}/archive`, {}, signal);
      const raw = await request(`/v1/sessions/${id}`, undefined, signal);
      checked(
        () =>
          z
            .object({
              id: z.literal(id),
              status: z.literal('terminated'),
              archived_at: z.string().min(1),
            })
            .parse(raw),
        true,
      );
    },
    async readStatus(id: string, signal?: AbortSignal) {
      validSession(id);
      const raw = await request(`/v1/sessions/${id}`, undefined, signal);
      return checked(
        () =>
          z
            .object({
              id: z.literal(id),
              status: z.enum(['idle', 'running', 'rescheduling', 'terminated']),
            })
            .parse(raw),
        false,
      );
    },
  };
}
