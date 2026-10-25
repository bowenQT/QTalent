import { beforeEach, expect, it, vi } from 'vitest';
import { createProjectAction } from './projects';
import { ConflictError } from '../usecases/create-project';
import { ForbiddenError } from '../usecases/project-context';
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  session: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('../auth/next', () => ({ requireSession: mocks.session }));
vi.mock('../db/client', () => ({ getDatabase: () => ({}) }));
vi.mock('../env', () => ({ getEnv: () => ({ APP_ENV: 'test' }) }));
vi.mock('../usecases/create-project', () => ({
  createProject: mocks.create,
  ConflictError: class extends Error {},
}));
vi.mock('../usecases/project-context', () => ({
  ForbiddenError: class extends Error {},
}));
const input = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  name: '测试',
  type: '专项',
  status: '进行中',
  goal: '',
  ownerId: null,
  memberIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'a' } });
  mocks.create.mockResolvedValue({ projectId: 'created', replayed: false });
});
it('preserves invalid input and field errors before writing', async () => {
  const result = await createProjectAction({ ...input, name: ' ' });
  expect(result.status).toBe('validation_error');
  expect(result).toMatchObject({
    input: { ...input, name: ' ' },
    fieldErrors: { name: ['请输入项目名称'] },
  });
  expect(mocks.create).not.toHaveBeenCalled();
});
it('rejects unrecognized fields rather than trusting client actor', async () => {
  expect(
    (await createProjectAction({ ...input, accountId: 'admin' })).status,
  ).toBe('validation_error');
});
it('normalizes valid input and uses authenticated identity', async () => {
  expect(await createProjectAction(input)).toEqual({
    status: 'success',
    projectId: 'created',
    replayed: false,
  });
  expect(mocks.create).toHaveBeenCalledWith(
    {},
    'a',
    { ...input, goal: '目标待补充' },
    '2026-09-04',
  );
  expect(mocks.revalidate).toHaveBeenCalledWith('/projects');
});
it.each([
  [new ForbiddenError(), 'forbidden'],
  [new ConflictError(), 'conflict'],
  [Object.assign(new Error('serialization'), { code: '40001' }), 'conflict'],
])('maps expected error %s', async (error, status) => {
  mocks.create.mockRejectedValue(error);
  expect((await createProjectAction(input)).status).toBe(status);
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('propagates unexpected database failure', async () => {
  mocks.create.mockRejectedValue(new Error('db down'));
  await expect(createProjectAction(input)).rejects.toThrow('db down');
});
