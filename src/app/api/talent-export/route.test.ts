import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import {
  memoryFixture,
  openReview,
} from '../../../server/usecases/talent-export/test-helpers';
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  store: null as ReturnType<typeof memoryFixture>['store'] | null,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../../../server/jobs/request', () => ({ jobAccount: mocks.account }));
vi.mock('../../../server/db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../../../server/env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../../../server/usecases/talent-export/postgres', () => ({
  createPostgresTalentExportStore: () => mocks.store,
}));
let current: ReturnType<typeof memoryFixture>;
const request = (query = 'scopeId=all&range=all') =>
  new Request('https://app.invalid/api/talent-export?' + query);
beforeEach(() => {
  vi.clearAllMocks();
  current = memoryFixture();
  mocks.store = current.store;
  mocks.account.mockResolvedValue('account');
});
it('serves actual authenticated CSV with protected response headers and an audit, not a JSON mock', async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-disposition')).toMatch(
    /^attachment; filename="confirmed-content-/,
  );
  const csv = await response.text();
  expect(csv).toContain('行为锚点');
  expect(csv).toContain('演示·one');
  expect(current.f.audits).toEqual([{ phase: 'download', outcome: 'success' }]);
});
it('does not deliver bytes to anonymous or signed-out users even with a formerly valid URL', async () => {
  mocks.account.mockResolvedValueOnce(null);
  expect((await GET(request())).status).toBe(401);
  expect(current.f.reads).toBe(0);
  mocks.account.mockResolvedValueOnce('account').mockResolvedValueOnce(null);
  const response = await GET(request());
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain('演示·one');
});
it.each([
  'scopeId=all&range=all&scopeId=other',
  'scopeId=all&range=all&role=manager',
  'scopeId=all&range=all&file=old',
  'scopeId=all&range=unknown',
])(
  'rejects invalid/duplicate parameters without reading records: %s',
  async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(current.f.reads).toBe(0);
    expect(current.f.audits[0]!.outcome).toBe('failed');
  },
);
it('regenerates against a newly opened review and never downloads the old reviewed score', async () => {
  openReview(current.f.data);
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('"已确认维度分条数","3"');
});
it('fails closed on scope denial, empty content, post-read changes, read errors and audit errors', async () => {
  current.f.data.context.grants[0]!.role = 'mentor';
  expect((await GET(request())).status).toBe(403);
  current = memoryFixture();
  mocks.store = current.store;
  expect((await GET(request('scopeId=all&range=last3Months'))).status).toBe(
    409,
  );
  current.f.change = (read) => {
    if (read === 4) openReview(current.f.data);
  };
  expect((await GET(request())).status).toBe(409);
  current = memoryFixture();
  mocks.store = current.store;
  current.store.readSnapshot = async () => {
    throw new Error('private synthetic storage detail');
  };
  const failed = await GET(request());
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('storage detail');
  current = memoryFixture();
  mocks.store = current.store;
  current.f.failAudit = true;
  expect((await GET(request())).status).toBe(503);
});
it('rejects non-GET entry and preserves auth failures as unavailable rather than anonymous', async () => {
  expect(
    (
      await GET(
        new Request('https://app.invalid/api/talent-export', {
          method: 'POST',
        }),
      )
    ).status,
  ).toBe(405);
  mocks.account.mockRejectedValue(new Error('synthetic JWKS unavailable'));
  expect((await GET(request())).status).toBe(503);
});
