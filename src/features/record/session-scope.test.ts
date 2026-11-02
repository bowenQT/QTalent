// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { clearSessionDrafts, sessionDraftEpoch } from '@/lib/session-drafts';
import { inputStashKey } from './record-handoff';
import { createSessionScope } from './session-scope';
import type { RecordActions } from './types';

const settled = vi.fn();
const track = (promise: Promise<unknown>) =>
  promise.then(
    (value) => settled('resolved', value),
    (error: unknown) => settled('rejected', error),
  );
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function actions(over: Partial<RecordActions> = {}) {
  return {
    resolveNode: null,
    submit: vi.fn(async () => 'submitted'),
    readBatch: vi.fn(),
    save: vi.fn(),
    undo: vi.fn(),
    loadSource: vi.fn(),
    ...over,
  } as unknown as RecordActions;
}

beforeEach(() => {
  settled.mockReset();
  window.sessionStorage.clear();
});

it('passes results through while the session is the same', async () => {
  const scope = createSessionScope(
    'acc-1',
    sessionDraftEpoch(),
    actions(),
    vi.fn(),
  );
  expect(scope.actions.resolveNode).toBeNull();
  await track(scope.actions.submit({} as never));
  expect(settled).toHaveBeenCalledWith('resolved', 'submitted');
});

it('drops results and does not start new calls after the session ends', async () => {
  let finish: (value: string) => void = () => undefined;
  const submit = vi.fn(
    () => new Promise<string>((resolve) => (finish = resolve)),
  );
  const scope = createSessionScope(
    'acc-1',
    sessionDraftEpoch(),
    actions({ submit: submit as never }),
    vi.fn(),
  );
  void track(scope.actions.submit({} as never));
  clearSessionDrafts();
  finish('late');
  await flush();
  expect(settled).not.toHaveBeenCalled();
  void track(scope.actions.submit({} as never));
  await flush();
  expect(submit).toHaveBeenCalledTimes(1);
  expect(scope.live()).toBe(false);
});

it('turns a synchronous throw into a rejection while live', async () => {
  const scope = createSessionScope(
    'acc-1',
    sessionDraftEpoch(),
    actions({
      submit: (() => {
        throw new Error('sync');
      }) as never,
    }),
    vi.fn(),
  );
  await track(scope.actions.submit({} as never));
  expect(settled).toHaveBeenCalledWith('rejected', expect.any(Error));
});

it('reads and writes only this account’s drafts, and nothing once ended', () => {
  const scope = createSessionScope(
    'acc-1',
    sessionDraftEpoch(),
    actions(),
    vi.fn(),
  );
  scope.drafts.stashInput({ text: '甲的原话', personId: null });
  expect(scope.drafts.restoreInput()?.text).toBe('甲的原话');
  clearSessionDrafts();
  window.sessionStorage.setItem(inputStashKey('acc-1'), 'kept');
  scope.drafts.stashInput({ text: '旧原话', personId: null });
  scope.drafts.clearInput();
  scope.drafts.stashBatchInput('b', { text: '旧', personId: null });
  scope.drafts.clearBatch();
  expect(scope.drafts.restoreInput()).toBeNull();
  expect(scope.drafts.restoreBatchInput('b')).toBeNull();
  expect(scope.drafts.takeHandoff()).toBeNull();
  expect(window.sessionStorage.getItem(inputStashKey('acc-1'))).toBe('kept');
});
