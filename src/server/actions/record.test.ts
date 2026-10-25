import { beforeEach, expect, it, vi } from 'vitest';
import { saveRecordAction, undoRecordAction } from './record';
import { requireSession } from '../auth/next';
import { createRecordSaveService } from '../usecases/record-save';
import { revalidatePath } from 'next/cache';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', () => ({ getDatabase: () => 'synthetic-db' }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'demo' }) }));
vi.mock('../usecases/record-save', () => ({ createRecordSaveService: vi.fn() }));
const save = vi.fn();
const undo = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: 'session-account' } } as Awaited<ReturnType<typeof requireSession>>);
  vi.mocked(createRecordSaveService).mockReturnValue({ save, undo });
});
const input = {
  operation_id: 'save-op', expected_revision: 1, draftId: 'draft',
  personIds: ['person'], projectId: null,
  sbi: { title: 'Synthetic event', situation: '', behavior: 'Synthetic behavior', impact: '' },
  decisions: [],
};
it('rejects malformed requests without executing and preserves the submitted input', async () => {
  const bad = { ...input, evaluatorId: 'forged' };
  expect(await saveRecordAction(bad)).toMatchObject({ status: 'validation_error', input: bad });
  expect(await undoRecordAction({ operation_id: '', saveId: 'save' })).toMatchObject({ status: 'validation_error' });
  expect(createRecordSaveService).not.toHaveBeenCalled();
});
it('uses session identity and a real wall clock separate from demo business date', async () => {
  save.mockResolvedValue({ status: 'conflict', message: 'Changed', input });
  expect(await saveRecordAction(input)).toEqual({ status: 'conflict', message: 'Changed', input });
  expect(save).toHaveBeenCalledWith('session-account', input);
  const deps = vi.mocked(createRecordSaveService).mock.calls[0][0];
  expect(deps.businessDate()).toBe('2026-09-04');
  expect(Math.abs(deps.now().getTime() - Date.now())).toBeLessThan(1000);
  expect(revalidatePath).not.toHaveBeenCalled();
});
it('invalidates current projections only after successful undo', async () => {
  const request = { operation_id: 'undo-op', saveId: 'save' };
  undo.mockResolvedValue({ status: 'success', replayed: false, result: {
    saveId: 'save', withdrawnEvents: [], withdrawnConfirmationIds: [],
    withdrawnReviewItemIds: [], originalInput: {
      operation_id: 'organize', text: 'Synthetic observation', attachmentIds: [],
      personId: null, projectId: null,
    },
  } });
  expect(await undoRecordAction(request)).toMatchObject({ status: 'success' });
  expect(undo).toHaveBeenCalledWith('session-account', request);
  expect(vi.mocked(revalidatePath).mock.calls).toEqual([['/people'], ['/record'], ['/queue']]);
});
