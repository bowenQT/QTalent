import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  session: vi.fn(),
  readBatch: vi.fn(),
  readSource: vi.fn(),
  readAnchors: vi.fn(),
  resolve: vi.fn(),
  factory: vi.fn(),
}));
vi.mock('../auth/next', () => ({ requireSession: runtime.session }));
vi.mock('../queries/record-arrange', () => ({
  readRecordMaterialBatchForCurrentUser: runtime.readBatch,
}));
vi.mock('../queries/sources', () => ({
  readSourceForCurrentUser: runtime.readSource,
}));
vi.mock('../queries/record-page', () => ({
  readRecordAnchors: runtime.readAnchors,
}));
vi.mock('../db/client', () => ({ getDatabase: () => 'db' }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../../lib/clock', () => ({
  createClock: () => ({ now: () => new Date('2026-10-15T00:00:00.000Z') }),
}));
vi.mock('../usecases/record-evaluation-node', async (original) => ({
  ...(await original<typeof import('../usecases/record-evaluation-node')>()),
  createRecordEvaluationNodeResolver: runtime.factory,
}));
import { RecordNodeResolutionUnavailable } from '../usecases/record-evaluation-node';
import {
  readRecordAnchorsAction,
  readRecordBatchAction,
  readRecordSourceAction,
  resolveRecordNodeAction,
} from './record-batch';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.session.mockResolvedValue({ user: { id: 'trusted-session' } });
  runtime.factory.mockReturnValue(runtime.resolve);
});

it('reads a batch through the session-checked query and gives its answer back', async () => {
  runtime.readBatch.mockResolvedValue({ status: 'not_found', message: 'x' });
  expect(await readRecordBatchAction({ batchId: 'b-1' })).toEqual({
    status: 'not_found',
    message: 'x',
  });
  expect(runtime.readBatch).toHaveBeenCalledWith({ batchId: 'b-1' });
});

it('turns the query input check into the contract validation shape', async () => {
  runtime.readBatch.mockResolvedValue({ status: 'validation_error' });
  expect(await readRecordBatchAction({ batchId: 2 })).toEqual({
    status: 'validation_error',
    fieldErrors: { batchId: ['请提供有效批次'] },
    input: { batchId: 2 },
  });
});

it('reads a source through the P0 reader', async () => {
  runtime.readSource.mockResolvedValue({ status: 'forbidden', message: 'x' });
  const input = { fragmentId: 'f', originalVersionId: 'v' };
  expect((await readRecordSourceAction(input)).status).toBe('forbidden');
  expect(runtime.readSource).toHaveBeenCalledWith(input);
});

it('reads anchors only for a valid list of versions and a current session', async () => {
  expect(await readRecordAnchorsAction({ ruleVersions: 'v' })).toEqual([]);
  expect(runtime.session).not.toHaveBeenCalled();
  runtime.readAnchors.mockResolvedValue([{ dimensionId: 'mot' }]);
  expect(await readRecordAnchorsAction({ ruleVersions: ['v-1'] })).toEqual([
    { dimensionId: 'mot' },
  ]);
  expect(runtime.session).toHaveBeenCalledOnce();
  expect(runtime.readAnchors).toHaveBeenCalledWith(['v-1']);
  runtime.session.mockRejectedValue(new Error('session unavailable'));
  await expect(
    readRecordAnchorsAction({ ruleVersions: ['v'] }),
  ).rejects.toThrow('session unavailable');
});

it('derives the node for the session account on the business day', async () => {
  runtime.resolve.mockResolvedValue({
    status: 'unique',
    evaluationNodeId: 'n',
  });
  const input = { personIds: ['p-1'], projectId: null, accountId: 'forged' };
  expect(await resolveRecordNodeAction(input)).toEqual({
    status: 'unique',
    evaluationNodeId: 'n',
  });
  // The account comes from the session, never from the input.
  expect(runtime.resolve).toHaveBeenCalledWith('trusted-session', input);
  const options = runtime.factory.mock.calls[0]?.[0];
  expect(options.db).toBe('db');
  expect(options.businessNow()).toBe('2026-10-15T00:00:00.000Z');
});

it('says the node is unavailable instead of failing like a lost connection', async () => {
  runtime.resolve.mockRejectedValue(new RecordNodeResolutionUnavailable());
  expect(await resolveRecordNodeAction({ personIds: ['p-1'] })).toEqual({
    status: 'unavailable',
  });
  runtime.resolve.mockRejectedValue(new Error('other'));
  await expect(resolveRecordNodeAction({ personIds: ['p-1'] })).rejects.toThrow(
    'other',
  );
});

it('derives nothing without a session', async () => {
  runtime.session.mockRejectedValue(new Error('unauthenticated'));
  await expect(
    resolveRecordNodeAction({ personIds: ['p-1'] }),
  ).rejects.toThrow();
  expect(runtime.resolve).not.toHaveBeenCalled();
});
