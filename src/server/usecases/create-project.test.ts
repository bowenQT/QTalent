import { beforeEach, expect, it, vi } from 'vitest';
import type { AuthzContext } from '../authz';
import type { Database } from '../db/client';
import { createProject, ConflictError } from './create-project';
import { ForbiddenError } from './project-context';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  insert: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./project-context', () => ({
  loadProjectContext: mocks.load,
  ForbiddenError: class extends Error {},
}));
vi.mock('../modules/staffing', async () => ({
  ...(await vi.importActual('../modules/staffing/create-policy')),
  insertProject: mocks.insert,
  readCreateRequest: mocks.read,
}));
vi.mock('../platform/audit', () => ({ recordAudit: mocks.audit }));
const input = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  name: '测试项目',
  type: '专项' as const,
  status: '进行中' as const,
  goal: '目标',
  ownerId: 'p1',
  memberIds: ['p2'],
};
let context: AuthzContext;
const tx = { execute: vi.fn() };
const transaction = vi.fn(
  async (callback: (executor: typeof tx) => Promise<unknown>) => callback(tx),
);
const db = { transaction } as unknown as Database;
beforeEach(() => {
  vi.clearAllMocks();
  context = {
    account: { id: 'a', personId: 'p1', isSystemAdmin: false },
    now: '2026-09-04',
    grants: [
      {
        accountId: 'a',
        role: 'manager',
        scope: 'company',
        cohortId: null,
        validFrom: '2026-01-01',
        validTo: null,
        revokedAt: null,
      },
    ],
    people: [
      { id: 'p1', noReview: false },
      { id: 'p2', noReview: false },
    ],
    projects: [],
    members: [],
    enrollments: [],
    assignments: [],
  };
  mocks.load.mockImplementation(async () => ({ context }));
  mocks.read.mockResolvedValue(undefined);
  mocks.insert.mockResolvedValue('created');
  mocks.audit.mockResolvedValue(undefined);
  transaction.mockImplementation(async (callback) => callback(tx));
});
it('writes project and audit in the same serializable transaction', async () => {
  expect(await createProject(db, 'a', input, context.now)).toEqual({
    projectId: 'created',
    replayed: false,
  });
  expect(mocks.insert).toHaveBeenCalledWith(
    tx,
    input,
    { accountId: 'a', personId: 'p1' },
    context.now,
    expect.any(String),
  );
  expect(mocks.audit).toHaveBeenCalledWith(tx, {
    actorId: 'a',
    action: 'project.create',
    resourceId: 'created',
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: 'serializable',
  });
});
it('replays original result without additional writes', async () => {
  const { fingerprintSubmission } =
    await import('../modules/staffing/create-policy');
  mocks.read.mockResolvedValue({
    projectId: 'old',
    fingerprint: fingerprintSubmission(input),
  });
  context.projects = [
    {
      id: 'old',
      cohortId: null,
      isTopic: false,
      ownerId: 'p1',
      creatorId: 'p1',
    },
  ];
  expect(await createProject(db, 'a', input, context.now)).toEqual({
    projectId: 'old',
    replayed: true,
  });
  expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
it('rejects changed payload for original request id', async () => {
  mocks.read.mockResolvedValue({ projectId: 'old', fingerprint: 'different' });
  await expect(
    createProject(db, 'a', input, context.now),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it.each(['p1', 'p2'])('revalidates forged owner or member %s', async (id) => {
  context.people = context.people.filter((p) => p.id !== id);
  await expect(
    createProject(db, 'a', input, context.now),
  ).rejects.toBeInstanceOf(ForbiddenError);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it.each(['admin', 'revoked', 'expired', 'mentor'])(
  'rejects current unauthorized context %s',
  async (mode) => {
    if (mode === 'admin') context.account.isSystemAdmin = true;
    if (mode === 'revoked') context.grants[0].revokedAt = context.now;
    if (mode === 'expired') context.grants[0].validTo = context.now;
    if (mode === 'mentor') context.grants[0].role = 'mentor';
    await expect(
      createProject(db, 'a', input, context.now),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.read).not.toHaveBeenCalled();
  },
);
it('propagates audit failure to transaction rollback', async () => {
  mocks.audit.mockRejectedValue(new Error('audit unavailable'));
  await expect(createProject(db, 'a', input, context.now)).rejects.toThrow(
    'audit unavailable',
  );
});
it('retries aborted serialization only with a fresh transaction', async () => {
  transaction.mockRejectedValueOnce(
    Object.assign(new Error('serialization'), { code: '40001' }),
  );
  expect(await createProject(db, 'a', input, context.now)).toEqual({
    projectId: 'created',
    replayed: false,
  });
  expect(transaction).toHaveBeenCalledTimes(2);
});
it('bounds repeated serialization failures', async () => {
  transaction.mockRejectedValue(
    Object.assign(new Error('serialization'), { code: '40001' }),
  );
  await expect(
    createProject(db, 'a', input, context.now),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(transaction).toHaveBeenCalledTimes(3);
});
it('never retries unknown or uncertain failures', async () => {
  transaction.mockRejectedValue(new Error('connection lost'));
  await expect(createProject(db, 'a', input, context.now)).rejects.toThrow(
    'connection lost',
  );
  expect(transaction).toHaveBeenCalledTimes(1);
});
it('retries only the request uniqueness race after rollback, not arbitrary unique conflicts', async () => {
  transaction.mockRejectedValueOnce(
    Object.assign(new Error('duplicate request'), {
      code: '23505',
      constraint: 'staffing_request_account_key_idx',
    }),
  );
  expect((await createProject(db, 'a', input, context.now)).projectId).toBe(
    'created',
  );
  expect(transaction).toHaveBeenCalledTimes(2);
  transaction.mockClear().mockRejectedValue(
    Object.assign(new Error('other unique violation'), {
      code: '23505',
      constraint: 'unrelated',
    }),
  );
  await expect(createProject(db, 'a', input, context.now)).rejects.toThrow(
    'other unique',
  );
  expect(transaction).toHaveBeenCalledTimes(1);
});
it.each([
  { code: '40001' },
  { code: '23505', constraint: 'staffing_request_account_key_idx' },
])(
  'maps exhausted wrapped database conflict %j to typed conflict',
  async (cause) => {
    const original = new Error('query failed', { cause });
    transaction.mockRejectedValue(original);
    try {
      await createProject(db, 'a', input, context.now);
      expect.fail('expected conflict');
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).cause).toBe(original);
    }
    expect(transaction).toHaveBeenCalledTimes(3);
  },
);
it('does not map unrelated wrapped unique violations to a user conflict', async () => {
  const original = new Error('query failed', {
    cause: { code: '23505', constraint: 'unrelated' },
  });
  transaction.mockRejectedValue(original);
  await expect(createProject(db, 'a', input, context.now)).rejects.toBe(
    original,
  );
  expect(transaction).toHaveBeenCalledTimes(1);
});
