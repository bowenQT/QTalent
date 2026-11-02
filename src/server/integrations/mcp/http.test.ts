import type { MaterialBatchReceipt } from '../../../contracts/materials';
import type { QuickView } from '../../../contracts/people';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEntryIdentityService } from '../../auth/entry/identity';
import { evaluationContextFixture } from '../../modules/programs/reassignment.fixtures';
import { createEntryContextLoader } from '../../usecases/entry/context';
import { createMcpTools } from './tools';
import { createMcpHttpHandler } from './http';
import { staffingDemandJobFixture } from '../../../contracts/staffing.fixtures';

const instant = '2026-11-01T01:00:00.000Z';
const proof = 'synthetic-http-proof-not-personal-credential';
const args = {
  operationId: 'demo-operation',
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  text: '演示：合成记录',
  files: [],
};
const receipt = {
  batchId: 'demo-batch',
  revision: 1,
  evaluationNodeId: 'demo-node',
  personIds: ['demo-person'],
  projectId: null,
  hasHiddenContent: false,
  files: [],
  status: 'processing' as const,
  jobId: 'demo-job',
  textMaterial: {
    materialId: 'demo-text-material',
    originalVersionId: 'demo-text-original',
  },
  items: [],
  resolvedItems: [],
  draftSet: null,
  confirmedDrafts: [],
  counts: {
    files: {
      total: 0,
      processing: 0,
      parsed: 0,
      needs_review: 0,
      unsupported: 0,
      failed: 0,
      original_only: 0,
      attachment_only: 0,
    },
    events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
    reviewItems: 0,
  },
  error: null,
} satisfies MaterialBatchReceipt;
const brief = {
  role: 'hr' as const,
  person: {
    id: 'demo-person',
    demo: true,
    name: '演示小禾',
    hue: 120,
    photo: null,
    teamId: 'demo-team',
    teamName: '演示组',
    teamPath: '演示组织 / 演示组',
    jobTitle: '演示岗位',
    level: null,
    batch: null,
    tenureLabel: null,
  },
  projectLoad: { current: 0, ever: 0 },
  recentFacts: { status: 'empty' as const },
  capabilityLines: { status: 'empty' as const },
  referencePosition: { status: 'unknown' as const, reason: '演示：无快照' },
} satisfies QuickView;
const rpc = (method: string, params?: unknown, id: string | number = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params }),
});
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    expect(server.listening).toBe(false);
  }
});

async function fixture() {
  const binding = {
    credentialId: 'demo-mcp-http-row',
    accountId: 'demo-hr-account',
    personId: 'demo-hr',
    revision: 1,
    expiresAt: '2026-11-02T00:00:00.000Z',
    revokedAt: null as string | null,
  };
  const verify = vi.fn(async (value: unknown) =>
    value === proof ? structuredClone(binding) : null,
  );
  const identities = createEntryIdentityService(
    { mcp: { verify, current: async () => structuredClone(binding) } },
    () => new Date(instant),
  );
  const facts = evaluationContextFixture();
  const execute = vi.fn(async () => structuredClone(receipt) as unknown);
  const authorizeOutput = vi.fn(async () => true);
  const tools = createMcpTools({
    identities,
    entry: {
      loadContext: createEntryContextLoader(identities, {
        load: async () => structuredClone(facts),
        businessNow: () => instant,
      }),
      transactions: {
        transaction: async (run) => run({}),
        audit: async () => undefined,
      },
      // Explicit synthetic adapters only. No production provenance claim.
      handlers: Object.fromEntries(
        ['record_moment', 'person_brief', 'draft_requirement'].map((name) => [
          name,
          { authorize: async () => true, execute, authorizeOutput },
        ]),
      ),
    },
  });
  const server = createServer(async (incoming, outgoing) => {
    const headers = new Headers();
    for (let i = 0; i < incoming.rawHeaders.length; i += 2)
      headers.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
    const hasBody = incoming.method !== 'GET' && incoming.method !== 'HEAD';
    const init = {
      method: incoming.method,
      headers,
      ...(hasBody
        ? {
            body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
            duplex: 'half',
          }
        : {}),
    };
    const response = await handler(new Request(origin + incoming.url, init));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const origin = 'http://127.0.0.1:' + address.port;
  const handler = createMcpHttpHandler({ endpoint: origin + '/mcp', tools });
  function headers(overrides: Record<string, string | null | undefined> = {}) {
    const result = new Headers({
      authorization: 'Bearer ' + proof,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    });
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      if (value === null) result.delete(key);
      else result.set(key, value);
    }
    return result;
  }
  async function send(
    payload: unknown,
    overrides: Record<string, string | null | undefined> = {},
    method = 'POST',
    path = '/mcp',
    raw = false,
  ) {
    return fetch(origin + path, {
      method,
      headers: headers(overrides),
      ...(method === 'POST'
        ? { body: raw ? (payload as string) : JSON.stringify(payload) }
        : {}),
    });
  }
  return {
    send,
    headers,
    endpoint: origin + '/mcp',
    handler,
    tools,
    execute,
    authorizeOutput,
    verify,
    binding,
  };
}

describe('MCP actual loopback HTTP boundary', () => {
  it('initializes, accepts the notification and calls each actual 903 tool path', async () => {
    const f = await fixture();
    const init = await f.send(
      rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'demo-protocol-client', version: '1.0.0' },
      }),
    );
    expect(init.status).toBe(200);
    expect(await init.json()).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: { listChanged: false } },
      },
    });
    expect(init.headers.has('mcp-session-id')).toBe(false);
    const ready = await f.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(ready.status).toBe(202);
    expect(await ready.text()).toBe('');
    const list = await f.send(rpc('tools/list'));
    expect(
      (await list.json()).result.tools.map((t: { name: string }) => t.name),
    ).toEqual(['record_moment', 'person_brief', 'draft_requirement']);
    for (const [name, input, output] of [
      ['record_moment', args, receipt],
      ['person_brief', { id: 'demo-person' }, brief],
      [
        'draft_requirement',
        {
          operationId: 'demo-demand-op',
          projectId: 'demo-project',
          inputText: '演示：起草需求',
        },
        staffingDemandJobFixture(),
      ],
    ] as const) {
      f.execute.mockResolvedValueOnce(output);
      const response = await f.send(
        rpc('tools/call', { name, arguments: input }, name),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(body.id).toBe(name);
      expect(body.result.structuredContent).toEqual({
        status: 'success',
        payload: output,
      });
      expect(body.result.isError).toBe(false);
      expect(JSON.parse(body.result.content[0].text)).toEqual(
        body.result.structuredContent,
      );
    }
    expect(f.execute).toHaveBeenCalledTimes(3);
  });

  it.each([null, 'Bearer wrong-proof', 'Basic c3ludGhldGlj', 'Bearer a,b'])(
    'refuses invalid Authorization %s before parsing or dispatch',
    async (authorization) => {
      const f = await fixture();
      const response = await f.send(
        'not-json',
        { authorization },
        'POST',
        '/mcp',
        true,
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe(
        'Bearer realm="QTalent-MCP"',
      );
      expect(await response.json()).toEqual({ error: 'unauthenticated' });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it('rejects an oversized credential without consulting a verifier', async () => {
    const f = await fixture();
    const response = await f.send(rpc('ping'), {
      authorization: 'Bearer ' + 'a'.repeat(4100),
    });
    expect(response.status).toBe(401);
    expect(f.verify).not.toHaveBeenCalled();
  });

  it('rechecks revoked bindings on subsequent requests', async () => {
    const f = await fixture();
    expect((await f.send(rpc('ping'))).status).toBe(200);
    f.binding.revokedAt = instant;
    expect((await f.send(rpc('tools/list'))).status).toBe(401);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each([{ origin: 'https://untrusted.example' }, { origin: 'null' }])(
    'rejects a foreign origin/host before authentication: %j',
    async (headers) => {
      const f = await fixture();
      expect((await f.send(rpc('ping'), headers)).status).toBe(403);
      expect(f.verify).not.toHaveBeenCalled();
    },
  );

  it('accepts only configured origins and ignores proxy identity claims', async () => {
    const f = await fixture();
    expect(
      (await f.send(rpc('ping'), { origin: new URL(f.endpoint).origin }))
        .status,
    ).toBe(200);
    const response = await f.send(rpc('ping'), {
      authorization: null,
      'x-forwarded-user': 'demo-hr-account',
      'cf-access-authenticated-user-email': 'demo@example.invalid',
    });
    expect(response.status).toBe(401);
  });

  it('rejects a foreign raw HTTP Host before authentication', async () => {
    const f = await fixture();
    // fetch normalizes Host to its URL. Use the actual Node HTTP wire API
    // here so the regression exercises a genuinely untrusted Host header.
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        f.endpoint,
        {
          method: 'POST',
          headers: Object.fromEntries(f.headers({ host: 'untrusted.example' })),
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode!));
        },
      );
      request.once('error', reject);
      request.end(JSON.stringify(rpc('ping')));
    });
    expect(status).toBe(403);
    expect(f.verify).not.toHaveBeenCalled();
  });

  it.each(['/other', '/mcp?token=not-a-real-token'])(
    'does not route %s or accept credentials in a query',
    async (path) => {
      const f = await fixture();
      expect((await f.send(rpc('ping'), {}, 'POST', path)).status).toBe(404);
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it.each(['GET', 'DELETE', 'OPTIONS'])(
    'responds 405 for authenticated %s with no SSE listener',
    async (method) => {
      const f = await fixture();
      const response = await f.send(undefined, {}, method);
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expect(await response.text()).toBe('');
    },
  );

  it.each([
    {},
    { accept: null },
    { accept: 'application/json' },
    { accept: 'text/event-stream' },
    { accept: 'application/json;q=0, text/event-stream' },
  ])('validates Accept without silently falling back: %j', async (change) => {
    const f = await fixture();
    const override = Object.keys(change).length ? change : { accept: '*/*' };
    expect((await f.send(rpc('ping'), override)).status).toBe(406);
  });

  it('accepts case-insensitive JSON media types and nonzero quality', async () => {
    const f = await fixture();
    const response = await f.send(rpc('ping'), {
      accept: 'Application/JSON;q=0.8, text/event-stream; q=1',
      'content-type': 'Application/JSON; charset=utf-8',
    });
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {},
    });
  });

  it.each([null, 'text/plain'])(
    'refuses non-JSON Content-Type %s',
    async (contentType) => {
      const f = await fixture();
      expect(
        (await f.send(rpc('ping'), { 'content-type': contentType })).status,
      ).toBe(415);
    },
  );

  it.each(['2025-03-26', '2025-06-18', '2025-11-25', null])(
    'supports the fixed Streamable HTTP version/header %s',
    async (version) => {
      const f = await fixture();
      expect(
        (await f.send(rpc('ping'), { 'mcp-protocol-version': version })).status,
      ).toBe(200);
    },
  );

  it('rejects unsupported headers and unsolicited session IDs', async () => {
    const f = await fixture();
    expect(
      (await f.send(rpc('ping'), { 'mcp-protocol-version': 'not-supported' }))
        .status,
    ).toBe(400);
    expect(
      (await f.send(rpc('ping'), { 'mcp-session-id': 'demo-stale-session' }))
        .status,
    ).toBe(400);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('negotiates another supported initialization version without echoing capabilities', async () => {
    const f = await fixture();
    for (const version of ['2025-03-26', '2099-01-01']) {
      const response = await f.send(
        rpc('initialize', {
          protocolVersion: version,
          capabilities: { roots: { listChanged: true } },
          clientInfo: { name: 'demo-client', version: '0.1', title: '演示' },
        }),
      );
      expect((await response.json()).result).toEqual({
        protocolVersion: version === '2025-03-26' ? version : '2025-11-25',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'qtalent-mcp', version: '0.1.0' },
      });
    }
  });

  it.each(['{', '', 'null'])(
    'returns a stable parse/envelope error for %j',
    async (raw) => {
      const f = await fixture();
      const response = await f.send(raw, {}, 'POST', '/mcp', true);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(
        raw === 'null' ? -32600 : -32700,
      );
    },
  );

  it.each([
    [rpc('ping')],
    { jsonrpc: '1.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: null, method: 'ping' },
    { jsonrpc: '2.0', id: 1, method: 'ping', params: [] },
    { jsonrpc: '2.0', id: 1, result: {} },
    { ...rpc('ping'), role: 'manager' },
  ])(
    'rejects malformed envelopes/responses/batches before dispatch: %j',
    async (input) => {
      const f = await fixture();
      const response = await f.send(input);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid request' },
      });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    rpc('initialize', { protocolVersion: '2025-11-25' }),
    rpc('ping', { privateValue: 'synthetic-private' }),
    rpc('tools/list', { cursor: 'not-a-real-cursor' }),
    rpc('tools/call', { name: 'record_moment', arguments: [] }),
    rpc('tools/call', { name: 'record_moment', arguments: args, role: 'hr' }),
    rpc('tools/call', { name: 'confirm_score', arguments: args }),
  ])(
    'correlates protocol parameter errors and never echoes input: %j',
    async (input) => {
      const f = await fixture();
      const response = await f.send({ ...input, id: 'demo-correlation' });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        jsonrpc: '2.0',
        id: 'demo-correlation',
        error: { code: -32602, message: 'Invalid parameters' },
      });
      expect(f.execute).not.toHaveBeenCalled();
    },
  );

  it('keeps semantic input errors separate from protocol errors', async () => {
    const f = await fixture();
    const response = await f.send(rpc('tools/call', { name: 'record_moment' }));
    expect(await response.json()).toMatchObject({
      result: {
        isError: true,
        structuredContent: { status: 'validation_error' },
      },
    });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('does not advertise other MCP capabilities or execute notifications', async () => {
    const f = await fixture();
    const unknown = await f.send(
      rpc('resources/read', { uri: 'synthetic-private' }, 0),
    );
    expect(await unknown.json()).toEqual({
      jsonrpc: '2.0',
      id: 0,
      error: { code: -32601, message: 'Method not found' },
    });
    const notification = await f.send({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'record_moment', arguments: args },
    });
    expect(notification.status).toBe(400);
    expect((await notification.json()).id).toBeUndefined();
    const cancelled = await f.send({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 'demo-finished-request', reason: '演示取消通知' },
    });
    expect(cancelled.status).toBe(202);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('passes refusal through as an error without returning text or citation identifiers', async () => {
    const f = await fixture();
    f.execute.mockResolvedValueOnce(brief);
    f.authorizeOutput.mockResolvedValueOnce(false);
    const response = await f.send(
      rpc('tools/call', {
        name: 'person_brief',
        arguments: { id: 'demo-person' },
      }),
    );
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({
      result: { isError: true, structuredContent: { status: 'forbidden' } },
    });
    expect(text).not.toContain('demo-person');
    expect(text).not.toContain('演示小禾');
  });

  it('enforces streaming byte limits even with no Content-Length', async () => {
    const f = await fixture();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(262145));
      },
      cancel: cancelled,
    });
    const response = await f.handler(
      new Request(f.endpoint, {
        method: 'POST',
        headers: f.headers(),
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it.each(['999999', 'invalid'])(
    'checks a declared Content-Length %s before reading',
    async (length) => {
      const f = await fixture();
      const response = await f.handler(
        new Request(f.endpoint, {
          method: 'POST',
          headers: f.headers({ 'content-length': length }),
          body: '{}',
        }),
      );
      expect(response.status).toBe(length === 'invalid' ? 400 : 413);
    },
  );

  it('rejects malformed UTF-8 and interrupted/no request bodies', async () => {
    const f = await fixture();
    const badUtf8 = await f.handler(
      new Request(f.endpoint, {
        method: 'POST',
        headers: f.headers(),
        body: new Uint8Array([255]),
      }),
    );
    expect((await badUtf8.json()).error.code).toBe(-32700);
    const missing = await f.handler(
      new Request(f.endpoint, {
        method: 'POST',
        headers: f.headers(),
      }),
    );
    expect(missing.status).toBe(400);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('synthetic-private-io'));
      },
    });
    const interrupted = await f.handler(
      new Request(f.endpoint, {
        method: 'POST',
        headers: f.headers(),
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(await interrupted.json()).toEqual({ error: 'request_interrupted' });
  });

  it('times out and cancels a stalled request body without dispatch', async () => {
    const f = await fixture();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = await f.handler(
      new Request(f.endpoint, {
        method: 'POST',
        headers: f.headers(),
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(408);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.execute).not.toHaveBeenCalled();
  }, 10000);

  it('bounds concurrent work and frees the slots once requests finish', async () => {
    const f = await fixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let count = 0;
    f.execute.mockImplementation(async () => {
      if (++count === 8) ready();
      await gate;
      return receipt;
    });
    const pending = Array.from({ length: 8 }, (_, i) =>
      f.send(rpc('tools/call', { name: 'record_moment', arguments: args }, i)),
    );
    try {
      await entered;
      const busy = await f.send(rpc('ping'));
      expect(busy.status).toBe(429);
      expect(busy.headers.get('retry-after')).toBe('1');
    } finally {
      release();
      const completed = await Promise.all(pending);
      for (const response of completed) expect(response.status).toBe(200);
    }
    expect((await f.send(rpc('ping'))).status).toBe(200);
  });

  it('maps backend authentication and unexpected failures without leaking errors', async () => {
    const f = await fixture();
    f.verify.mockRejectedValueOnce(
      new Error('synthetic-private-database-error'),
    );
    const auth = await f.send(rpc('ping'));
    expect(auth.status).toBe(503);
    expect(await auth.json()).toEqual({ error: 'unavailable' });
    vi.spyOn(f.tools, 'list').mockRejectedValueOnce(
      new Error('synthetic-private-error'),
    );
    const failure = await f.send(rpc('tools/list'));
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: 'unavailable' });
  });

  it('requires an explicit canonical HTTPS endpoint or a loopback test endpoint', async () => {
    const f = await fixture();
    for (const endpoint of [
      'invalid',
      'http://public.example/mcp',
      'https://user:password@example.invalid/mcp',
      'https://example.invalid/mcp?credential=x',
      'https://example.invalid/mcp#fragment',
    ])
      expect(() => createMcpHttpHandler({ endpoint, tools: f.tools })).toThrow(
        'Invalid MCP endpoint',
      );
    expect(() =>
      createMcpHttpHandler({
        endpoint: f.endpoint,
        allowedOrigins: ['https://example.invalid/path'],
        tools: f.tools,
      }),
    ).toThrow('Invalid MCP origin');
    const handler = createMcpHttpHandler({
      endpoint: 'https://demo.example.invalid/mcp',
      allowedOrigins: ['https://demo.example.invalid'],
      tools: f.tools,
    });
    const wrong = await handler(
      new Request('https://other.example.invalid/mcp', {
        method: 'POST',
        headers: f.headers(),
        body: JSON.stringify(rpc('ping')),
      }),
    );
    expect(wrong.status).toBe(403);
  });
});
