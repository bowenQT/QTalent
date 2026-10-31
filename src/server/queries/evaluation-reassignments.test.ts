import { beforeEach, expect, it, vi } from 'vitest';
import { readEvaluationReassignmentsForCurrentUser } from './evaluation-reassignments';
import { EvaluationReassignmentError } from '../modules/programs';
import { ForbiddenError } from '../usecases/project-context';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: vi.fn(),
  read: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../db/client', () => ({ getDatabase: mocks.db }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/read-evaluation-reassignments', () => ({
  readEvaluationReassignments: mocks.read,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'demo-hr-account' } });
  mocks.db.mockReturnValue({ database: 'synthetic-boundary' });
});
it('reads for the authenticated HR with the business clock and returns the actual list', async () => {
  const data = {
    asOf: '2026-09-04T00:00:00.000Z',
    items: [{ workItemId: 'demo-visible-task' }],
  };
  mocks.read.mockResolvedValue(data);
  expect(await readEvaluationReassignmentsForCurrentUser()).toEqual({
    status: 'success',
    ...data,
  });
  expect(mocks.read).toHaveBeenCalledWith(
    { database: 'synthetic-boundary' },
    'demo-hr-account',
    '2026-09-04T00:00:00.000Z',
  );
});
it.each([
  new ForbiddenError(),
  new EvaluationReassignmentError('forbidden', '演示：无权'),
])(
  'returns a data-free forbidden result for an inaccessible session',
  async (error) => {
    mocks.read.mockRejectedValue(error);
    expect(await readEvaluationReassignmentsForCurrentUser()).toEqual({
      status: 'forbidden',
      message: '你没有查看重新分派事项的权限',
    });
  },
);
it('does not hide read failures or stale-data conflicts behind an empty list', async () => {
  mocks.read.mockRejectedValue(new Error('synthetic read failed'));
  await expect(readEvaluationReassignmentsForCurrentUser()).rejects.toThrow(
    'read failed',
  );
  mocks.read.mockRejectedValue(
    new EvaluationReassignmentError('conflict', 'synthetic conflict'),
  );
  await expect(readEvaluationReassignmentsForCurrentUser()).rejects.toThrow(
    'synthetic conflict',
  );
});
