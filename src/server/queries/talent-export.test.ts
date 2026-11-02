import { beforeEach, expect, it, vi } from 'vitest';
import { memoryFixture } from '../usecases/talent-export/test-helpers';
import {
  readTalentExportForCurrentUser,
  readConfirmedPersonExportForCurrentUser,
  talentExportFailure,
} from './talent-export';
import { TalentExportError } from '../usecases/talent-export/types';
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
it('current-user preview exposes only current authorized scope counts, not CSV cells', async () => {
  const result = await readTalentExportForCurrentUser();
  expect(result.status).toBe('ready');
  expect(JSON.stringify(result)).not.toContain('confirmationId');
  expect(JSON.stringify(result)).not.toContain('Synthetic observation');
  expect(mocks.account).toHaveBeenCalledTimes(2);
});
it('anonymous and post-read signed-out users cannot receive scope counts', async () => {
  mocks.account.mockResolvedValueOnce(null);
  expect(await readTalentExportForCurrentUser()).toEqual({
    status: 'unauthenticated',
  });
  expect(current.f.reads).toBe(0);
  mocks.account.mockResolvedValueOnce('account').mockResolvedValueOnce(null);
  expect(await readTalentExportForCurrentUser()).toEqual({
    status: 'unauthenticated',
  });
});
it('forbidden roles and unavailable snapshots remain explicit rather than ready/empty', async () => {
  current.f.data.context.grants[0]!.role = 'mentor';
  expect(await readTalentExportForCurrentUser()).toEqual({
    status: 'forbidden',
  });
  current.store.readSnapshot = async () => {
    throw new Error('synthetic private diagnostic');
  };
  expect(await readTalentExportForCurrentUser()).toEqual({
    status: 'unavailable',
  });
});
it.each([
  'changed',
  'invalid_input',
  'audit_unavailable',
  'unavailable',
] as const)('classifies %s without returning raw diagnostics', (code) => {
  expect(talentExportFailure(new TalentExportError(code)).status).toBe(
    'failed',
  );
  expect(
    JSON.stringify(
      talentExportFailure(new Error('private synthetic diagnostic')),
    ),
  ).not.toContain('diagnostic');
});

it('the authenticated single-person core remains partial and fails closed on account switching or missing facts', async () => {
  const result = await readConfirmedPersonExportForCurrentUser('one');
  expect(result).toMatchObject({
    status: 'partial',
    content: { person: { id: 'one' }, projection: { rows: 4 } },
  });
  mocks.account.mockResolvedValueOnce('account').mockResolvedValueOnce('other');
  expect(await readConfirmedPersonExportForCurrentUser('one')).toEqual({
    status: 'denied',
  });
  mocks.account.mockResolvedValueOnce(null);
  expect(await readConfirmedPersonExportForCurrentUser('one')).toEqual({
    status: 'denied',
  });
  current.store.readSnapshot = async () => {
    throw new Error('private synthetic diagnostic');
  };
  expect(await readConfirmedPersonExportForCurrentUser('one')).toEqual({
    status: 'unavailable',
  });
});
