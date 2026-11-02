import { z } from 'zod';
import { EntryIdentityError } from '../../auth/entry/identity';
import { McpCapacityError, McpToolProtocolError, type McpTools } from './tools';

const versions: readonly string[] = ['2025-03-26', '2025-06-18', '2025-11-25'];
const latestVersion = '2025-11-25';
const maxBodyBytes = 256 * 1024;
const bodyTimeoutMs = 5000;
const maxInFlight = 8;
const object = z.record(z.string(), z.unknown());
const requestId = z.union([z.string(), z.number().finite()]);
const envelope = z.strictObject({
  jsonrpc: z.literal('2.0'),
  id: requestId.optional(),
  method: z.string().min(1),
  params: object.optional(),
});
const meta = { _meta: object.optional() };
const emptyParams = z.strictObject(meta);
const initializeParams = z.strictObject({
  protocolVersion: z.string().min(1).max(50),
  capabilities: object,
  clientInfo: z.looseObject({
    name: z.string().min(1).max(128),
    version: z.string().min(1).max(128),
  }),
  ...meta,
});
const callParams = z.strictObject({
  name: z.string().min(1),
  arguments: object.optional(),
  ...meta,
});
const cancelledParams = z.strictObject({
  requestId,
  reason: z.string().optional(),
  ...meta,
});

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function json(status: number, value?: unknown, headers: HeadersInit = {}) {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}
function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id }),
    error: { code, message },
  };
}
function accepts(value: string | null, type: string) {
  return (value ?? '').split(',').some((part) => {
    const [media, ...parameters] = part.toLowerCase().trim().split(';');
    return (
      media.trim() === type &&
      !parameters.some((p) => /^q\s*=\s*0(?:\.0*)?$/.test(p.trim()))
    );
  });
}
async function readBody(request: Request): Promise<unknown> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared))
      throw new HttpFailure(400, 'invalid_content_length');
    if (Number(declared) > maxBodyBytes)
      throw new HttpFailure(413, 'request_too_large');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HttpFailure(400, 'parse_error');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new HttpFailure(408, 'request_timeout')),
      bodyTimeoutMs,
    );
  });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBodyBytes) throw new HttpFailure(413, 'request_too_large');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new HttpFailure(400, 'parse_error');
    }
  } catch (error) {
    throw error instanceof HttpFailure
      ? error
      : new HttpFailure(400, 'request_interrupted');
  } finally {
    clearTimeout(timer);
    // Cancellation of request-body IO is not cancellation of a domain job.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function canonicalEndpoint(value: string) {
  try {
    const endpoint = new URL(value);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      (endpoint.protocol !== 'https:' &&
        !(
          endpoint.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)
        ))
    )
      throw new Error();
    return endpoint;
  } catch {
    throw new Error('Invalid MCP endpoint');
  }
}

/** Stateless Streamable HTTP adapter. It does not open a listener, issue a
 * credential, install a production handler or trust proxy identity headers.
 */
export function createMcpHttpHandler(options: {
  endpoint: string;
  allowedOrigins?: readonly string[];
  tools: McpTools;
}) {
  const endpoint = canonicalEndpoint(options.endpoint);
  const origins = new Set(options.allowedOrigins ?? [endpoint.origin]);
  for (const origin of origins) {
    if (canonicalEndpoint(origin).origin !== origin)
      throw new Error('Invalid MCP origin');
  }
  let inFlight = 0;
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const host = request.headers.get('host');
      const origin = request.headers.get('origin');
      if (
        url.origin !== endpoint.origin ||
        (host !== null && host !== endpoint.host) ||
        (origin !== null && !origins.has(origin))
      )
        throw new HttpFailure(403, 'origin_rejected');
      if (url.pathname !== endpoint.pathname || url.search !== '')
        throw new HttpFailure(404, 'not_found');
      const auth = request.headers.get('authorization') ?? '';
      const bearer = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(auth);
      if (!bearer || auth.length > 4096)
        throw new EntryIdentityError('unauthenticated');
      const identity = await options.tools.authenticate(bearer[1]);
      if (request.method !== 'POST')
        return json(405, undefined, { allow: 'POST' });
      if (request.headers.has('mcp-session-id'))
        throw new HttpFailure(400, 'stateless_endpoint');
      const version = request.headers.get('mcp-protocol-version');
      if (version !== null && !versions.includes(version))
        throw new HttpFailure(400, 'unsupported_protocol_version');
      if (
        !accepts(request.headers.get('accept'), 'application/json') ||
        !accepts(request.headers.get('accept'), 'text/event-stream')
      )
        throw new HttpFailure(406, 'accept_required');
      if (
        request.headers
          .get('content-type')
          ?.split(';')[0]
          .trim()
          .toLowerCase() !== 'application/json'
      )
        throw new HttpFailure(415, 'json_required');
      if (inFlight >= maxInFlight)
        return json(429, { error: 'busy' }, { 'retry-after': '1' });
      inFlight++;
      try {
        const raw = await readBody(request);
        const parsed = envelope.safeParse(raw);
        if (!parsed.success)
          return json(400, rpcError(null, -32600, 'Invalid request'));
        const message = parsed.data;
        if (!('id' in message)) {
          if (
            (message.method === 'notifications/initialized' &&
              emptyParams.safeParse(message.params ?? {}).success) ||
            (message.method === 'notifications/cancelled' &&
              cancelledParams.safeParse(message.params).success)
          )
            return json(202);
          // A tools/call notification must never produce an unaudited write.
          return json(400, rpcError(undefined, -32600, 'Invalid notification'));
        }
        const id = message.id!;
        const invalid = () =>
          json(200, rpcError(id, -32602, 'Invalid parameters'));
        let result: unknown;
        if (message.method === 'initialize') {
          const init = initializeParams.safeParse(message.params);
          if (!init.success) return invalid();
          result = {
            protocolVersion: versions.includes(init.data.protocolVersion)
              ? init.data.protocolVersion
              : latestVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'qtalent-mcp', version: '0.1.0' },
          };
        } else if (message.method === 'ping') {
          if (!emptyParams.safeParse(message.params ?? {}).success)
            return invalid();
          result = {};
        } else if (message.method === 'tools/list') {
          if (!emptyParams.safeParse(message.params ?? {}).success)
            return invalid();
          result = await options.tools.list(identity);
        } else if (message.method === 'tools/call') {
          const call = callParams.safeParse(message.params);
          if (!call.success) return invalid();
          try {
            result = await options.tools.call(
              identity,
              call.data.name,
              call.data.arguments ?? {},
            );
          } catch (error) {
            if (error instanceof McpToolProtocolError) return invalid();
            throw error;
          }
        } else {
          return json(200, rpcError(id, -32601, 'Method not found'));
        }
        return json(200, { jsonrpc: '2.0', id, result });
      } finally {
        inFlight--;
      }
    } catch (error) {
      if (error instanceof McpCapacityError)
        return json(429, { error: 'busy' }, { 'retry-after': '1' });
      if (error instanceof EntryIdentityError)
        return json(
          error.kind === 'unauthenticated' ? 401 : 503,
          { error: error.kind },
          error.kind === 'unauthenticated'
            ? { 'www-authenticate': 'Bearer realm="QTalent-MCP"' }
            : {},
        );
      if (error instanceof HttpFailure)
        return error.code === 'parse_error'
          ? json(error.status, rpcError(null, -32700, 'Parse error'))
          : json(error.status, { error: error.code });
      return json(503, { error: 'unavailable' });
    }
  };
}
