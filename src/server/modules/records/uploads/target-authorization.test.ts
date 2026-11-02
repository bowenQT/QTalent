import { expect, it, vi } from 'vitest';
import {
  createUploadTargetAuthorizer,
  type UploadWriteSnapshot,
} from './target-authorization';
import { fixture } from '../../../../../tests/fixtures/upload-fake';

const now = '2026-10-31T12:00:00.000Z';
type Context = {
  account: { id: string; isSystemAdmin: boolean };
  now: string;
  authorizedNodes: string[];
};
function setup() {
  const f = fixture();
  const snapshot: UploadWriteSnapshot<Context> = {
    context: {
      account: { id: 'account', isSystemAdmin: false },
      now,
      authorizedNodes: ['node-1'],
    },
    target: f.request.target,
    complete: true,
    subjects: [{ evaluationNodeId: 'node-1', personId: 'demo-person-1' }],
  };
  const load = vi.fn(async () => snapshot);
  const canWrite = vi.fn(
    (context: Context, subject: { evaluationNodeId: string }) =>
      context.authorizedNodes.includes(subject.evaluationNodeId),
  );
  const authorize = createUploadTargetAuthorizer({
    authorizationNow: () => now,
    loadWriteSnapshot: load,
    canWriteNode: canWrite,
  });
  return { f, snapshot, load, canWrite, authorize };
}
it('passes server-resolved node subjects, current business time and the exact transaction to the write boundary', async () => {
  const f = setup();
  await f.f.options.store.transaction([], async (tx) => {
    expect(await f.authorize('account', f.f.request.target, tx)).toBe(true);
    expect(f.load).toHaveBeenCalledWith('account', f.f.request.target, now, tx);
    expect(f.canWrite).toHaveBeenCalledWith(
      f.snapshot.context,
      f.snapshot.subjects[0],
    );
  });
});
it.each([
  'partial',
  'wrong_account',
  'admin',
  'stale_time',
  'wrong_target',
  'empty',
  'missing_person',
  'duplicate',
  'blank_node',
  'cross_node',
])(
  'denies a %s snapshot without guessing another relation or a node from the person',
  async (kind) => {
    const f = setup();
    if (kind === 'partial') f.snapshot.complete = false;
    if (kind === 'wrong_account') f.snapshot.context.account.id = 'other';
    if (kind === 'admin') f.snapshot.context.account.isSystemAdmin = true;
    if (kind === 'stale_time') f.snapshot.context.now = '2026-01-01T00:00:00Z';
    if (kind === 'wrong_target')
      f.snapshot.target = { kind: 'event', eventId: 'another' };
    if (kind === 'empty') f.snapshot.subjects = [];
    if (kind === 'missing_person') f.snapshot.subjects[0].personId = 'other';
    if (kind === 'duplicate') f.snapshot.subjects.push(f.snapshot.subjects[0]);
    if (kind === 'blank_node') f.snapshot.subjects[0].evaluationNodeId = ' ';
    if (kind === 'cross_node')
      f.snapshot.subjects[0].evaluationNodeId = 'node-2';
    await f.f.options.store.transaction([], async (tx) => {
      expect(await f.authorize('account', f.f.request.target, tx)).toBe(false);
    });
  },
);
it('checks all resolved event participants and fails as soon as any actual node write is denied', async () => {
  const f = setup();
  const target = { kind: 'event' as const, eventId: 'event-1' };
  f.snapshot.target = target;
  f.snapshot.subjects.push({
    evaluationNodeId: 'node-2',
    personId: 'demo-person-2',
  });
  await f.f.options.store.transaction([], async (tx) => {
    expect(await f.authorize('account', target, tx)).toBe(false);
    f.snapshot.context.authorizedNodes.push('node-2');
    expect(await f.authorize('account', target, tx)).toBe(true);
  });
});
it('rejects client authority additions, unassigned/material targets and anonymous calls before loading facts', async () => {
  const f = setup();
  await f.f.options.store.transaction([], async (tx) => {
    for (const value of [
      { ...f.f.request.target, role: 'hr' },
      { kind: 'unassigned', evaluationNodeId: 'node-1' },
      { kind: 'people', personIds: [] },
    ])
      expect(await f.authorize('account', value, tx)).toBe(false);
    expect(await f.authorize('', f.f.request.target, tx)).toBe(false);
  });
  expect(f.load).not.toHaveBeenCalled();
});
