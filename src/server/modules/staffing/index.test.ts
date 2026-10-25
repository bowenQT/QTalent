import { expect, it, vi } from 'vitest';
import { insertProject } from './index';
import type { DbExecutor } from '../../db/client';
import { projects, members, memberLogs, createRequests } from './schema';
function fakeDb() {
  const values = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn<(table: unknown) => { values: typeof values }>(() => ({
    values,
  }));
  return { db: { insert } as unknown as DbExecutor, insert, values };
}
const input = {
  requestId: 'request',
  name: '测试',
  type: '训练营课题' as const,
  status: '进行中' as const,
  goal: '',
  ownerId: 'p1',
  memberIds: ['p1', 'p2'],
};
it('writes server defaults, deduplicates owner, preserves explicit topic marker, records request', async () => {
  const { db, insert, values } = fakeDb();
  const id = await insertProject(
    db,
    input,
    { accountId: 'a', personId: 'p1' },
    '2026-09-04',
    'fp',
  );
  expect(insert.mock.calls.map((c) => c[0])).toEqual([
    projects,
    members,
    memberLogs,
    createRequests,
  ]);
  expect(values.mock.calls[0][0]).toMatchObject({
    id,
    organizationId: 'xe6',
    cohortId: 'b-xe6',
    isTopic: false,
    from: '2026-09-04',
    to: '2026-12-31',
    goal: '目标待补充',
  });
  expect(values.mock.calls[1][0]).toEqual([
    expect.objectContaining({ projectId: id, personId: 'p1', role: 'owner' }),
    expect.objectContaining({ projectId: id, personId: 'p2', role: '成员' }),
  ]);
  expect(values.mock.calls[3][0]).toMatchObject({
    accountId: 'a',
    requestId: 'request',
    fingerprint: 'fp',
    projectId: id,
  });
});
it('does not issue an empty members insert', async () => {
  const { db, insert } = fakeDb();
  await insertProject(
    db,
    { ...input, ownerId: null, memberIds: [], goal: '已有目标' },
    { accountId: 'a', personId: 'p1' },
    '2026-09-04',
    'fp',
  );
  expect(insert.mock.calls.map((c) => c[0])).toEqual([
    projects,
    memberLogs,
    createRequests,
  ]);
});
