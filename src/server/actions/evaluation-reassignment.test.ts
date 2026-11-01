import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvaluationReassignmentError } from '../modules/programs';
import { reassignEvaluationWorkAction } from './evaluation-reassignment';
import {
  reassignmentInputFixture as input,
  evaluationWorkFixture,
} from '../modules/programs/reassignment.fixtures';
import { planEvaluationReassignment } from '../modules/programs/reassignment-policy';
import { evaluationContextFixture } from '../modules/programs/reassignment.fixtures';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  db: vi.fn(),
  reassign: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../db/client', () => ({ getDatabase: mocks.db }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/reassign-evaluation-work', () => ({
  reassignEvaluationWork: mocks.reassign,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'demo-hr-account' } });
  mocks.db.mockReturnValue({ database: 'synthetic-boundary' });
  mocks.reassign.mockResolvedValue(
    planEvaluationReassignment(
      evaluationContextFixture(),
      evaluationWorkFixture(),
      input,
      null,
    ),
  );
});
describe('authenticated reassignment action boundary', () => {
  it('uses the current session actor and a server-owned clock callback', async () => {
    const result = await reassignEvaluationWorkAction(input);
    expect(result.status).toBe('success');
    const [db, accountId, payload, now] = mocks.reassign.mock.calls[0];
    expect(db).toEqual({ database: 'synthetic-boundary' });
    expect(accountId).toBe('demo-hr-account');
    expect(payload).toEqual(input);
    expect(typeof now).toBe('function');
    expect(now()).toBe('2026-09-04T00:00:00.000Z');
    expect(mocks.revalidate).toHaveBeenCalledWith('/work');
  });
  it.each([
    { ...input, role: 'hr' },
    { ...input, actorId: 'demo-other-account' },
    { ...input, now: '2000-01-01' },
    { ...input, expectedRevision: 0 },
    null,
  ])(
    'rejects forged or invalid input before a business write: %j',
    async (value) => {
      const result = await reassignEvaluationWorkAction(value);
      expect(result.status).toBe('validation_error');
      if (result.status === 'validation_error') {
        expect(result.input).toBe(value);
        expect(Object.keys(result.fieldErrors).length).toBeGreaterThan(0);
      }
      expect(mocks.reassign).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );
  it.each(['forbidden', 'not_found', 'conflict'] as const)(
    'returns %s explicitly and retains edits only on conflict',
    async (status) => {
      mocks.reassign.mockRejectedValue(
        new EvaluationReassignmentError(status, '演示：当前状态不可处理'),
      );
      const result = await reassignEvaluationWorkAction(input);
      expect(result.status).toBe(status);
      expect(result).not.toHaveProperty('receipt');
      expect(mocks.revalidate).not.toHaveBeenCalled();
      if (status === 'conflict') expect(result).toHaveProperty('input', input);
      else expect(result).not.toHaveProperty('input');
    },
  );
  it('does not convert session or database failure into a success/empty result', async () => {
    mocks.session.mockRejectedValue(new Error('synthetic session failure'));
    await expect(reassignEvaluationWorkAction(input)).rejects.toThrow(
      'session failure',
    );
    expect(mocks.reassign).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue({ user: { id: 'demo-hr-account' } });
    mocks.reassign.mockRejectedValue(new Error('synthetic database failure'));
    await expect(reassignEvaluationWorkAction(input)).rejects.toThrow(
      'database failure',
    );
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
