import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EntryIdentityError } from '../auth/entry/identity';
import { EntryUsecaseError } from '../usecases/entry/context';
import { AgentSessionError } from '../usecases/agentapi/session-policy';
const runtime = vi.hoisted(() => ({ agentConversationForRequest: vi.fn() }));
vi.mock('../usecases/agentapi-runtime', () => runtime);
import { handleAgentConversationCommand } from './agentapi-http';

const origin = 'https://talent.example.invalid';
function post(body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(origin + '/api/agentapi/conversations/demo-conversation', {
    method: 'POST',
    body: text,
    headers: {
      origin,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
      ...headers,
    },
  });
}
function streamed(
  body: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) {
  return new Request(origin + '/api/agentapi/conversations/demo-conversation', {
    method: 'POST',
    body,
    duplex: 'half',
    headers: { origin, 'content-type': 'application/json', ...headers },
  } as RequestInit);
}
const service = {
  submit: vi.fn(),
  advance: vi.fn(),
  cancel: vi.fn(),
};
const identity = Object.freeze({ channel: 'agentapi' });
beforeEach(() => {
  vi.clearAllMocks();
  runtime.agentConversationForRequest.mockResolvedValue({ identity, service });
});

describe('request gate', () => {
  it.each([
    ['cross-origin', { origin: 'https://evil.example.invalid' }, 403],
    ['missing origin', { origin: '' }, 403],
  ])(
    'rejects a %s caller before any verification',
    async (_, headers, code) => {
      const response = await handleAgentConversationCommand(
        post({ action: 'cancel' }, headers),
        'demo-conversation',
      );
      expect(response.status).toBe(code);
      expect(runtime.agentConversationForRequest).not.toHaveBeenCalled();
    },
  );
  it.each([
    ['malformed JSON', '{'],
    ['unknown action', { action: 'publish' }],
    ['caller-supplied actor fields', { action: 'cancel', accountId: 'x' }],
    ['missing text', { action: 'submit', operationId: 'op' }],
  ])('rejects %s as validation_error', async (_, body) => {
    const response = await handleAgentConversationCommand(
      post(body),
      'demo-conversation',
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: 'validation_error' });
    expect(runtime.agentConversationForRequest).not.toHaveBeenCalled();
  });
  it('rejects a malformed declared length before reading', async () => {
    for (const length of ['', 'abc', '-1'])
      expect(
        (
          await handleAgentConversationCommand(
            post({ action: 'cancel' }, { 'content-length': length }),
            'demo-conversation',
          )
        ).status,
      ).toBe(400);
  });
  it('answers 413 for a declared length above 64KiB without pulling the body', async () => {
    const pull = vi.fn();
    const response = await handleAgentConversationCommand(
      streamed(new ReadableStream({ pull }, { highWaterMark: 0 }), {
        'content-length': '65537',
      }),
      'demo-conversation',
    );
    expect(response.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
  });
  it('stops and cancels an understated, never-ending body once it passes 64KiB', async () => {
    let sent = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 16384;
        controller.enqueue(new Uint8Array(16384).fill(0x20));
      },
      cancel,
    });
    const response = await handleAgentConversationCommand(
      streamed(body, { 'content-length': '1' }),
      'demo-conversation',
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalled();
    // Rejected within a chunk or two of the cap, not after buffering it all.
    expect(sent).toBeLessThanOrEqual(65536 + 3 * 16384);
    expect(runtime.agentConversationForRequest).not.toHaveBeenCalled();
  });
  it('answers 408 for a body that stalls past the read deadline', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"action":'));
        },
        cancel,
      });
      const pending = handleAgentConversationCommand(
        streamed(body),
        'demo-conversation',
      );
      await vi.advanceTimersByTimeAsync(5001);
      expect((await pending).status).toBe(408);
      expect(cancel).toHaveBeenCalled();
      expect(runtime.agentConversationForRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('accepts a normal chunked body without a declared length', async () => {
    service.cancel.mockResolvedValue({ status: 'cancelled', cleanup: 'none' });
    const encoded = new TextEncoder().encode(
      JSON.stringify({ action: 'cancel' }),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 5));
        controller.enqueue(encoded.slice(5));
        controller.close();
      },
    });
    const response = await handleAgentConversationCommand(
      streamed(body),
      'demo-conversation',
    );
    expect(response.status).toBe(200);
  });
});

describe('dispatch', () => {
  it('answers 503 while AgentAPI is not configured', async () => {
    runtime.agentConversationForRequest.mockResolvedValue(null);
    const response = await handleAgentConversationCommand(
      post({ action: 'cancel' }),
      'demo-conversation',
    );
    expect(response.status).toBe(503);
  });
  it('passes only the route conversation, server identity and command fields', async () => {
    service.submit.mockResolvedValue({ status: 'waiting' });
    service.advance.mockResolvedValue({
      status: 'complete',
      text: '演示回答',
      nature: 'ai_suggestion',
    });
    service.cancel.mockResolvedValue({
      status: 'cancelled',
      cleanup: 'verified',
    });
    const submitted = await handleAgentConversationCommand(
      post({ action: 'submit', operationId: 'op-1', text: '演示输入' }),
      'demo-conversation',
    );
    expect(service.submit).toHaveBeenCalledExactlyOnceWith(
      identity,
      'demo-conversation',
      'op-1',
      '演示输入',
    );
    expect(await submitted.json()).toEqual({ status: 'waiting' });
    expect(submitted.headers.get('cache-control')).toBe('no-store, private');
    const advanced = await handleAgentConversationCommand(
      post({ action: 'advance', operationId: 'op-1' }),
      'demo-conversation',
    );
    expect(service.advance).toHaveBeenCalledExactlyOnceWith(
      identity,
      'demo-conversation',
      'op-1',
    );
    expect(await advanced.json()).toMatchObject({ nature: 'ai_suggestion' });
    const cancelled = await handleAgentConversationCommand(
      post({ action: 'cancel' }),
      'demo-conversation',
    );
    expect(service.cancel).toHaveBeenCalledExactlyOnceWith(
      identity,
      'demo-conversation',
    );
    expect(cancelled.status).toBe(200);
  });
  it.each([
    [new EntryIdentityError('unauthenticated'), 401, 'unauthenticated'],
    [new EntryIdentityError('unavailable'), 503, 'unavailable'],
    [new EntryUsecaseError('forbidden'), 403, 'forbidden'],
    [new AgentSessionError('permission_changed'), 409, 'permission_changed'],
    [new AgentSessionError('budget'), 429, 'budget'],
    [new AgentSessionError('model_failed'), 502, 'model_failed'],
    [new AgentSessionError('protocol'), 400, 'protocol'],
    [Object.assign(new Error('x'), { kind: 'not_found' }), 404, 'not_found'],
    [Object.assign(new Error('x'), { kind: 'conflict' }), 409, 'conflict'],
    [Object.assign(new Error('x'), { kind: 'admin' }), 503, 'unavailable'],
    [new Error('synthetic-private-provider-detail'), 503, 'unavailable'],
  ])('maps %s without echoing detail', async (error, code, status) => {
    runtime.agentConversationForRequest.mockRejectedValueOnce(error);
    const response = await handleAgentConversationCommand(
      post({ action: 'cancel' }),
      'demo-conversation',
    );
    expect(response.status).toBe(code);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status });
    expect(text).not.toContain('synthetic');
  });
  it('maps a failure thrown by the service call the same way', async () => {
    service.advance.mockRejectedValue(new AgentSessionError('cancelled'));
    const response = await handleAgentConversationCommand(
      post({ action: 'advance', operationId: 'op-1' }),
      'demo-conversation',
    );
    expect(response.status).toBe(409);
  });
});
