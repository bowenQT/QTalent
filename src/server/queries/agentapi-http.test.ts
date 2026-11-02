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
  it('rejects missing or oversized declared bodies without reading them', async () => {
    for (const length of ['', '0', '65537', 'abc']) {
      const response = await handleAgentConversationCommand(
        post({ action: 'cancel' }, { 'content-length': length }),
        'demo-conversation',
      );
      expect(response.status).toBe(400);
    }
  });
  it('rejects an actual body larger than its declared limit', async () => {
    const big = JSON.stringify({
      action: 'submit',
      operationId: 'op',
      text: '演'.repeat(30000),
    });
    const response = await handleAgentConversationCommand(
      post(big, { 'content-length': '100' }),
      'demo-conversation',
    );
    expect(response.status).toBe(400);
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
