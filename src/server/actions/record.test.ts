import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { revalidatePath } from 'next/cache';
import {
  recordSaveInputSchema,
  recordSaveResultSchema,
  recordUndoResultSchema,
} from '../../contracts/record';
import { recordBatchDraftSetFixture } from '../../contracts/materials.fixtures';
import { requireSession } from '../auth/next';
import { getDatabase } from '../db/client';
import {
  saveRecordDraft,
  undoRecordSave,
  RecordSaveError,
} from '../usecases/record-save';
import { saveRecordAction, undoRecordAction } from './record';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../auth/next', () => ({ requireSession: vi.fn() }));
vi.mock('../db/client', () => ({ getDatabase: vi.fn() }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/record-save', () => ({
  saveRecordDraft: vi.fn(),
  undoRecordSave: vi.fn(),
  RecordSaveError: class extends Error {
    constructor(
      readonly status: string,
      readonly reason: string,
    ) {
      super(reason);
    }
  },
  RecordSaveUnavailableError: class extends Error {
    readonly status = 'unavailable';
  },
}));
const draft = recordBatchDraftSetFixture.drafts[0];
const input = recordSaveInputSchema.parse({
  operation_id: 'operation',
  expected_revision: 1,
  draftId: draft.draftId,
  personIds: draft.personIds,
  projectId: draft.projectId,
  sbi: draft.sbi,
  decisions: [
    {
      personId: draft.personIds[0],
      dimensionId: draft.scores[0].dimensionId,
      action: 'confirm',
    },
  ],
});
const receipt = {
  saveId: 'save',
  events: [{ personId: draft.personIds[0], eventId: 'event' }],
  revision: 2,
  confirmationIds: ['confirmation'],
  reviewItemIds: [],
  savedBy: 'session-account',
  savedAt: '2026-11-01T00:00:00.000Z',
  undoUntil: '2026-11-01T00:00:05.000Z',
};
const undo = { operation_id: 'undo-operation', saveId: 'save' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(receipt.savedAt));
  vi.mocked(requireSession).mockResolvedValue({
    user: { id: 'session-account' },
  } as Awaited<ReturnType<typeof requireSession>>);
  vi.mocked(getDatabase).mockReturnValue({} as ReturnType<typeof getDatabase>);
  vi.mocked(saveRecordDraft).mockResolvedValue({
    replayed: false,
    result: receipt,
  });
  vi.mocked(undoRecordSave).mockResolvedValue({
    replayed: true,
    result: {
      saveId: 'save',
      withdrawnEvents: receipt.events,
      withdrawnConfirmationIds: receipt.confirmationIds,
      withdrawnReviewItemIds: [],
      inputRestoration: 'available',
      originalInput: {
        operation_id: 'input-op',
        text: '演示原文',
        attachmentIds: [],
        personId: null,
        projectId: null,
      },
    },
  });
});
afterEach(() => vi.useRealTimers());
it('combines current session/database with the business clock and independent real wall clock', async () => {
  const result = await saveRecordAction(input);
  expect(recordSaveResultSchema.parse(result)).toEqual({
    status: 'success',
    replayed: false,
    result: receipt,
  });
  const [db, accountId, received, clocks] =
    vi.mocked(saveRecordDraft).mock.calls[0];
  expect(db).toBe(getDatabase());
  expect(accountId).toBe('session-account');
  expect(received).toEqual(input);
  expect(clocks.businessNow()).toBe('2026-09-04T00:00:00.000Z');
  expect(clocks.wallNow()).toBe(receipt.savedAt);
  expect(revalidatePath).toHaveBeenCalledWith('/work');
  expect(revalidatePath).toHaveBeenCalledWith('/people');
});
it('returns the actual accepted undo/replay result', async () => {
  const result = await undoRecordAction(undo);
  expect(recordUndoResultSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({
    status: 'success',
    replayed: true,
    result: { saveId: 'save' },
  });
  expect(undoRecordSave).toHaveBeenCalledWith(
    getDatabase(),
    'session-account',
    undo,
    expect.any(Object),
  );
});
it.each([
  null,
  { ...input, evaluatorId: 'forged-rater' },
  { ...input, sbi: { ...input.sbi, behavior: '  ' } },
])(
  'retains invalid save input without touching a session or database',
  async (raw) => {
    expect(await saveRecordAction(raw)).toMatchObject({
      status: 'validation_error',
      input: raw,
    });
    expect(requireSession).not.toHaveBeenCalled();
    expect(saveRecordDraft).not.toHaveBeenCalled();
  },
);
it('returns field errors and preserves invalid undo input', async () => {
  const raw = { saveId: '' };
  expect(await undoRecordAction(raw)).toMatchObject({
    status: 'validation_error',
    input: raw,
  });
  expect(requireSession).not.toHaveBeenCalled();
});
it.each(['conflict', 'forbidden', 'not_found'] as const)(
  'maps %s from native save and undo without a success cache invalidation',
  async (status) => {
    const failure = new RecordSaveError(status, 'native-reason');
    vi.mocked(saveRecordDraft).mockRejectedValue(failure);
    vi.mocked(undoRecordSave).mockRejectedValue(failure);
    const saved = await saveRecordAction(input);
    const undone = await undoRecordAction(undo);
    expect(saved.status).toBe(status);
    expect(undone.status).toBe(status);
    expect(recordSaveResultSchema.safeParse(saved).success).toBe(true);
    expect(recordUndoResultSchema.safeParse(undone).success).toBe(true);
    if (status === 'conflict') {
      expect(saved).toHaveProperty('input', input);
      expect(undone).toHaveProperty('input', undo);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  },
);
it('preserves unavailable dependencies instead of reporting an empty success or fake revision', async () => {
  vi.mocked(saveRecordDraft).mockRejectedValue(
    new RecordSaveError('unavailable', 'speaker_binding_not_connected'),
  );
  vi.mocked(undoRecordSave).mockRejectedValue(
    new RecordSaveError('unavailable', 'material_reader_not_connected'),
  );
  await expect(saveRecordAction(input)).rejects.toHaveProperty(
    'status',
    'unavailable',
  );
  await expect(undoRecordAction(undo)).rejects.toHaveProperty(
    'status',
    'unavailable',
  );
  expect(revalidatePath).not.toHaveBeenCalled();
});
it('propagates infrastructure failures and never turns them into conflicts or receipts', async () => {
  const failure = new Error('synthetic database failure');
  vi.mocked(saveRecordDraft).mockRejectedValue(failure);
  vi.mocked(undoRecordSave).mockRejectedValue(failure);
  await expect(saveRecordAction(input)).rejects.toBe(failure);
  await expect(undoRecordAction(undo)).rejects.toBe(failure);
});
it('requires a live session before invoking either native usecase', async () => {
  const failure = new Error('synthetic no session');
  vi.mocked(requireSession).mockRejectedValue(failure);
  await expect(saveRecordAction(input)).rejects.toBe(failure);
  await expect(undoRecordAction(undo)).rejects.toBe(failure);
  expect(saveRecordDraft).not.toHaveBeenCalled();
  expect(undoRecordSave).not.toHaveBeenCalled();
});
