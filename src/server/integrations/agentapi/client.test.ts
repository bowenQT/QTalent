import { describe, expect, it, vi } from 'vitest';
import { createAgentApiClient, type AgentApiConfig } from './client';
import { parseNativeEvent, type CustomTool } from './protocol';

const config: AgentApiConfig = {
  apiKey: 'synthetic-key',
  region: 'cn-east',
  agentId: 'agt_demo',
  agentVersion: 1,
  environmentId: 'env_demo',
  modelId: 'demo/model',
};
const tools: CustomTool[] = [
  {
    type: 'custom',
    name: 'person_brief',
    description: '读取已授权人员速览',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
];
const system = 'AI只形成待人工确认的建议。';
const created = () => ({
  id: 'ses_demo',
  status: 'idle',
  environment_id: config.environmentId,
  agent: {
    id: config.agentId,
    version: 1,
    runtime: 'native',
    model: { id: config.modelId },
    system,
    tools,
    mcp_servers: [],
    skills: [],
    multiagent: { type: 'coordinator', agents: [] },
    callable_agents: [],
  },
  resources: [],
  vault_ids: [],
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const ack = (type = 'user.message') => ({ data: [{ id: 'evt_ack', type }] });
const message = {
  type: 'user.message' as const,
  input: { parts: [{ type: 'text' as const, text: '演示：需要工程负责人' }] },
};
function fixture(replies: Response[]) {
  const send = vi.fn<typeof fetch>(async () => {
    const response = replies.shift();
    if (!response) throw new Error('unexpected request');
    return response;
  });
  return { send, client: createAgentApiClient(config, send) };
}

describe('AgentAPI Native HTTP adapter without external network', () => {
  it('constructs without I/O and restricts credentials to the confirmed region', async () => {
    const f = fixture([json(created())]);
    expect(f.send).not.toHaveBeenCalled();
    expect(await f.client.create(system, tools)).toEqual({ id: 'ses_demo' });
    const [url, init] = f.send.mock.calls[0]!;
    expect(String(url)).toBe('https://agent.qiniuapi.com/v1/sessions');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'synthetic-key' });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      agent: {
        type: 'agent_with_overrides',
        tools,
        mcp_servers: [],
        skills: [],
      },
      resources: [],
      vault_ids: [],
    });
  });
  it('uses the separately documented US origin, never a caller URL', async () => {
    const send = vi.fn<typeof fetch>(async () =>
      json({ id: 'ses_demo', status: 'rescheduling' }),
    );
    expect(
      await createAgentApiClient(
        { ...config, region: 'us-west' },
        send,
      ).readStatus('ses_demo'),
    ).toEqual({ id: 'ses_demo', status: 'rescheduling' });
    expect(String(send.mock.calls[0]![0])).toBe(
      'https://agent.sufy.com/v1/sessions/ses_demo',
    );
    expect(() =>
      createAgentApiClient({ ...config, apiKey: 'secret\nheader' }, send),
    ).toThrow('configuration');
  });
  it.each([
    'tools',
    'mcp',
    'skills',
    'members',
    'callable',
    'resources',
    'vault',
    'runtime',
    'version',
  ])('refuses unexpected inherited %s before any user input', async (field) => {
    const raw = created();
    if (field === 'tools')
      raw.agent.tools = [{ ...tools[0]!, input_schema: { type: 'object' } }];
    if (field === 'mcp') Object.assign(raw.agent, { mcp_servers: [{}] });
    if (field === 'skills') Object.assign(raw.agent, { skills: [{}] });
    if (field === 'members')
      Object.assign(raw.agent, {
        multiagent: { type: 'coordinator', agents: [{}] },
      });
    if (field === 'callable')
      Object.assign(raw.agent, { callable_agents: [{}] });
    if (field === 'resources') Object.assign(raw, { resources: [{}] });
    if (field === 'vault') Object.assign(raw, { vault_ids: ['secret-ref'] });
    if (field === 'runtime') raw.agent.runtime = 'codex';
    if (field === 'version') raw.agent.version = 2;
    const f = fixture([json(raw)]);
    await expect(f.client.create(system, tools)).rejects.toMatchObject({
      kind: 'protocol',
      uncertain: false,
      createdSessionId: 'ses_demo',
    });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('rejects duplicate tools, unsafe session paths and oversized input without requests', async () => {
    const f = fixture([]);
    await expect(
      f.client.create(system, [...tools, ...tools]),
    ).rejects.toMatchObject({ kind: 'configuration' });
    await expect(f.client.send('ses_../escape', message)).rejects.toMatchObject(
      { kind: 'protocol', uncertain: false },
    );
    await expect(
      f.client.send('ses_demo', {
        ...message,
        input: { parts: [{ type: 'text', text: 'x'.repeat(65537) }] },
      }),
    ).rejects.toMatchObject({ kind: 'protocol', uncertain: false });
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'unauthorized', false],
    [403, 'unauthorized', false],
    [409, 'conflict', false],
    [429, 'rate_limited', false],
    [500, 'unavailable', true],
  ] as const)(
    'classifies HTTP %s without retaining body or retrying',
    async (status, kind, uncertain) => {
      const f = fixture([json({ secret: 'private-error' }, status)]);
      await expect(f.client.send('ses_demo', message)).rejects.toMatchObject({
        kind,
        uncertain,
        message: kind,
      });
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it('treats a lost POST acknowledgement as uncertain, never resubmits', async () => {
    const send = vi.fn<typeof fetch>(async () => {
      throw new Error('private-url-and-key');
    });
    await expect(
      createAgentApiClient(config, send).send('ses_demo', message),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      uncertain: true,
      message: 'unavailable',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([
    {},
    { data: [] },
    { ...ack(), next_page: 'more' },
    ack('user.interrupt'),
  ])(
    'does not turn malformed accepted acknowledgements into safe retries',
    async (body) => {
      const f = fixture([json(body)]);
      await expect(f.client.send('ses_demo', message)).rejects.toMatchObject({
        kind: 'protocol',
        uncertain: true,
      });
    },
  );
  it('sends distinct user/tool-result/interrupt events and preserves acknowledgement ids', async () => {
    const f = fixture([
      json(ack()),
      json(ack('user.custom_tool_result')),
      json(ack('user.interrupt')),
    ]);
    expect(await f.client.send('ses_demo', message)).toBe('evt_ack');
    await f.client.send('ses_demo', {
      type: 'user.custom_tool_result',
      custom_tool_use_id: 'evt_call',
      content: [{ type: 'text', text: '{"status":"success"}' }],
    });
    await f.client.send('ses_demo', { type: 'user.interrupt' });
    expect(
      JSON.parse(String(f.send.mock.calls[1]![1]?.body)).events[0]
        .custom_tool_use_id,
    ).toBe('evt_call');
  });
  it('reads bounded history pages and drops private error/telemetry bodies', async () => {
    const f = fixture([
      json({
        data: [
          { id: 'evt_old', type: 'span.model_request_end', private: 'secret' },
        ],
        next_page: 'a+b?',
      }),
      json({
        data: [
          {
            id: 'evt_err',
            type: 'session.error',
            error: { message: 'private' },
          },
        ],
      }),
    ]);
    expect(await f.client.events('ses_demo')).toEqual([
      { id: 'evt_old', type: 'ignored' },
      { id: 'evt_err', type: 'session.error' },
    ]);
    expect(
      new URL(String(f.send.mock.calls[1]![0])).searchParams.get('page'),
    ).toBe('a+b?');
  });
  it('fails a pagination cycle rather than returning a falsely complete history', async () => {
    const f = fixture([
      json({ data: [], next_page: 'same' }),
      json({ data: [], next_page: 'same' }),
    ]);
    await expect(f.client.events('ses_demo')).rejects.toMatchObject({
      kind: 'protocol',
      uncertain: false,
    });
  });
  it('caps page count even for changing cursors', async () => {
    const f = fixture(
      Array.from({ length: 5 }, (_, n) =>
        json({ data: [], next_page: String(n) }),
      ),
    );
    await expect(f.client.events('ses_demo')).rejects.toMatchObject({
      kind: 'limit',
    });
    expect(f.send).toHaveBeenCalledTimes(5);
  });
  it('cancels an oversized response stream and marks accepted POST unknown', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(1048577));
      },
      cancel,
    });
    const f = fixture([new Response(body)]);
    await expect(f.client.send('ses_demo', message)).rejects.toMatchObject({
      kind: 'limit',
      uncertain: true,
    });
    expect(cancel).toHaveBeenCalled();
  });
  it('refuses already cancelled input without side effects', async () => {
    const f = fixture([]);
    await expect(
      f.client.send('ses_demo', message, AbortSignal.abort()),
    ).rejects.toMatchObject({ kind: 'cancelled', uncertain: false });
    expect(f.send).not.toHaveBeenCalled();
  });
  it('verifies archive with a subsequent read instead of treating POST as completion', async () => {
    const f = fixture([
      json({}),
      json({
        id: 'ses_demo',
        status: 'terminated',
        archived_at: '2026-11-01T00:00:00Z',
      }),
    ]);
    await f.client.archive('ses_demo');
    expect(f.send.mock.calls.map(([, init]) => init?.method)).toEqual([
      'POST',
      'GET',
    ]);
    const g = fixture([json({}), json({ id: 'ses_demo', status: 'running' })]);
    await expect(g.client.archive('ses_demo')).rejects.toMatchObject({
      kind: 'protocol',
      uncertain: true,
    });
  });
  it('maps ordinary and external tool events into distinct checked shapes', () => {
    expect(
      parseNativeEvent({
        id: 'evt_tool',
        type: 'agent.custom_tool_use',
        name: 'person_brief',
        input: { id: 'demo' },
      }),
    ).toMatchObject({ name: 'person_brief' });
    expect(
      parseNativeEvent({
        id: 'evt_tool',
        type: 'agent.tool_use',
        command: 'secret',
      }),
    ).toEqual({ id: 'evt_tool', type: 'unsafe_tool' });
    expect(
      parseNativeEvent({ id: 'evt_mcp', type: 'agent.mcp_tool_use' }).type,
    ).toBe('unsafe_tool');
    expect(
      parseNativeEvent({
        id: 'evt_text',
        type: 'agent.message',
        content: [{ type: 'text', text: '演示建议' }],
      }).type,
    ).toBe('agent.message');
    expect(
      parseNativeEvent({
        id: 'evt_idle',
        type: 'session.status_idle',
        stop_reason: { type: 'requires_action', event_ids: ['evt_tool'] },
      }).type,
    ).toBe('session.status_idle');
  });
});

it('rejects invalid JSON and missing response bodies without returning raw supplier content', async () => {
  for (const response of [
    new Response('private non-JSON error'),
    new Response(null),
  ]) {
    const f = fixture([response]);
    await expect(f.client.send('ses_demo', message)).rejects.toMatchObject({
      kind: 'protocol',
      uncertain: true,
    });
  }
});
it('keeps cancellation during an in-flight write uncertain and redacted', async () => {
  const controller = new AbortController();
  const send = vi.fn<typeof fetch>(async (_url, init) => {
    controller.abort();
    init?.signal?.throwIfAborted();
    return json(ack());
  });
  await expect(
    createAgentApiClient(config, send).send(
      'ses_demo',
      message,
      controller.signal,
    ),
  ).rejects.toMatchObject({ kind: 'cancelled', uncertain: true });
  expect(send).toHaveBeenCalledTimes(1);
});
it('caps encoded request bytes even when a multi-byte system prompt fits its character budget', async () => {
  const f = fixture([]);
  const large = Array.from({ length: 16 }, (_, n) => ({
    ...tools[0]!,
    name: 'tool_' + n,
    input_schema: { type: 'object', description: 'x'.repeat(20000) },
  }));
  await expect(f.client.create(system, large)).rejects.toMatchObject({
    kind: 'limit',
    uncertain: false,
  });
  expect(f.send).not.toHaveBeenCalled();
});
