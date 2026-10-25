import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
const mocks = vi.hoisted(() => ({ read: vi.fn(), command: vi.fn() }));
vi.mock('../../../../server/queries/jobs', () => ({
  readJobForCurrentUser: mocks.read,
}));
vi.mock('../../../../server/actions/jobs', () => ({
  commandJobAction: mocks.command,
}));
const context = { params: Promise.resolve({ jobId: 'j' }) };
const payload = {
  jobId: 'j',
  action: 'cancel',
  operationId: 'op',
  expectedRevision: 1,
};
function request(body: unknown = payload, origin = 'https://app.test') {
  return new Request('https://app.test/api/jobs/j', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ status: 'success', snapshot: { jobId: 'j' } });
  mocks.command.mockResolvedValue({
    status: 'success',
    snapshot: { jobId: 'j' },
  });
});
it('uses the query facade and disables shared and browser caches', async () => {
  const result = await GET(new Request('https://app.test/api/jobs/j'), context);
  expect(await result.json()).toEqual({ jobId: 'j' });
  expect(result.headers.get('cache-control')).toContain('no-store');
  expect(mocks.read).toHaveBeenCalledWith('j');
});
it.each([
  ['unauthenticated', 401],
  ['forbidden', 403],
  ['not_found', 404],
  ['conflict', 409],
  ['validation_error', 400],
] as const)('maps %s without internal fields', async (status, code) => {
  mocks.read.mockResolvedValue({ status });
  const result = await GET(new Request('https://app.test/api/jobs/j'), context);
  expect(result.status).toBe(code);
  expect(await result.json()).toEqual({ status });
});
it('rejects cross-origin writes before calling the action', async () => {
  expect(
    (await POST(request(payload, 'https://evil.test'), context)).status,
  ).toBe(403);
  expect(mocks.command).not.toHaveBeenCalled();
});
it('validates JSON and matching resource IDs before action execution', async () => {
  expect(
    (
      await POST(
        new Request('https://app.test/api/jobs/j', {
          method: 'POST',
          headers: { origin: 'https://app.test' },
          body: '{',
        }),
        context,
      )
    ).status,
  ).toBe(400);
  expect(
    (await POST(request({ ...payload, jobId: 'other' }), context)).status,
  ).toBe(400);
  expect((await POST(request(null), context)).status).toBe(400);
  expect(mocks.command).not.toHaveBeenCalled();
  expect((await POST(request(), context)).status).toBe(200);
  expect(mocks.command).toHaveBeenCalledWith(payload);
});
it('sanitizes dependency errors without claiming task completion', async () => {
  mocks.read.mockRejectedValue(new Error('private-db-stack'));
  mocks.command.mockRejectedValue(new Error('private-provider-stack'));
  for (const result of [
    await GET(new Request('https://app.test/api/jobs/j'), context),
    await POST(request(), context),
  ]) {
    expect(result.status).toBe(503);
    expect(await result.text()).not.toMatch(/private|stack|completed/);
  }
});
