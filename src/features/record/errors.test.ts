import { describe, expect, it } from 'vitest';
import {
  commandFailureMessage,
  failureKindOf,
  failureView,
  saveProblems,
} from './errors';
import { copy } from './copy';

describe('failureView', () => {
  it('每类失败说明发生了什么，并只给真正可走的出口', () => {
    expect(failureView('processing_failed')).toEqual({
      message: copy.failure.processing_failed,
      reorganize: true,
      edit: true,
    });
    expect(failureView('dependency_unavailable')).toMatchObject({
      reorganize: true,
      edit: true,
    });
    expect(failureView('input_changed')).toMatchObject({
      reorganize: true,
      edit: false,
    });
    expect(failureView('cancelled')).toMatchObject({
      reorganize: false,
      edit: true,
    });
  });
});

describe('failureKindOf', () => {
  it('取消优先，其次取任务给出的错误码，缺省为整理中断', () => {
    expect(failureKindOf({ status: 'cancelled', error: null })).toBe(
      'cancelled',
    );
    expect(
      failureKindOf({
        status: 'failed',
        error: { code: 'input_changed', message: 'x' },
      }),
    ).toBe('input_changed');
    expect(failureKindOf({ status: 'failed', error: null })).toBe(
      'processing_failed',
    );
  });
});

describe('commandFailureMessage', () => {
  it('冲突和其他失败各一句，都不带内部细节', () => {
    expect(commandFailureMessage('conflict')).toBe(
      copy.failure.commandConflict,
    );
    for (const status of [
      'unauthenticated',
      'forbidden',
      'not_found',
      'validation_error',
      'unavailable',
    ] as const)
      expect(commandFailureMessage(status)).toBe(copy.failure.commandFailed);
  });
});

describe('saveProblems', () => {
  const decisions = [
    { personId: 'p1', dimensionId: 'prof', action: 'confirm' as const },
  ];

  it('定位到标题、行为和其他 SBI 字段', () => {
    const problems = saveProblems(
      {
        'sbi.title': ['x'],
        'sbi.behavior': ['x'],
        'sbi.impact': ['x'],
      },
      decisions,
    );
    expect(problems).toEqual({
      title: copy.sbi.titleNeeded,
      behavior: copy.sbi.behaviorNeeded,
      sbi: copy.sbi.fieldProblem,
      scores: {},
      general: false,
    });
  });

  it('定位到具体分数行；越界的下标和未知字段算整体问题', () => {
    const problems = saveProblems(
      { 'decisions.0.reason': ['x'], 'decisions.7.value': ['x'], other: ['x'] },
      decisions,
    );
    expect(problems.scores).toEqual({
      'p1\u0000prof': copy.sbi.fieldProblem,
    });
    expect(problems.general).toBe(true);
  });
});
