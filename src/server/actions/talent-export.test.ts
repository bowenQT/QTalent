import { beforeEach, expect, it, vi } from 'vitest';
import { generateTalentExportAction } from './talent-export';
import { memoryFixture } from '../usecases/talent-export/test-helpers';
const mocks = vi.hoisted(() => ({
  account: vi.fn(),
  store: null as ReturnType<typeof memoryFixture>['store'] | null,
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('../jobs/request', () => ({ jobAccount: mocks.account }));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/talent-export/postgres', () => ({
  createPostgresTalentExportStore: () => mocks.store,
}));
let current: ReturnType<typeof memoryFixture>;
beforeEach(() => {
  vi.clearAllMocks();
  current = memoryFixture();
  mocks.store = current.store;
  mocks.account.mockResolvedValue('account');
});
it('matches the 841 generate port and returns a request URL, never rows or a stored file token', async () => {
  const result = await generateTalentExportAction('all', 'all');
  expect(result).toMatchObject({
    status: 'done',
    people: 1,
    rows: 4,
    href: '/api/talent-export?scopeId=all&range=all',
  });
  expect(Object.keys(result).sort()).toEqual([
    'at',
    'fileName',
    'href',
    'people',
    'rows',
    'status',
  ]);
  expect(current.f.audits).toEqual([{ phase: 'generate', outcome: 'success' }]);
});
it('cannot impersonate another account through the scope argument', async () => {
  expect(
    (
      await generateTalentExportAction(
        { scopeId: 'all', accountId: 'other' },
        'all',
      )
    ).status,
  ).toBe('failed');
  expect(current.f.reads).toBe(0);
});
it('rechecks authentication after generation, including switching accounts', async () => {
  mocks.account.mockResolvedValueOnce('account').mockResolvedValueOnce('other');
  expect(await generateTalentExportAction('all', 'all')).toEqual({
    status: 'denied',
  });
});
it('anonymous, empty, denied and audited failure are distinct outcomes', async () => {
  mocks.account.mockResolvedValueOnce(null);
  expect(await generateTalentExportAction('all', 'all')).toEqual({
    status: 'denied',
  });
  expect(await generateTalentExportAction('all', 'last3Months')).toEqual({
    status: 'empty',
  });
  current.f.data.context.grants[0]!.role = 'mentor';
  expect(await generateTalentExportAction('all', 'all')).toEqual({
    status: 'denied',
  });
  current.f.failAudit = true;
  expect(await generateTalentExportAction('all', 'all')).toMatchObject({
    status: 'failed',
  });
});
it('auth dependency failures return no content or private diagnostics', async () => {
  mocks.account.mockRejectedValue(new Error('synthetic private auth failure'));
  const result = await generateTalentExportAction('all', 'all');
  expect(result.status).toBe('failed');
  expect(JSON.stringify(result)).not.toContain('auth failure');
});
