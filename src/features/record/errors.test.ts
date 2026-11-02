import { describe, expect, it } from 'vitest';
import { failureView, saveProblems } from './errors';
import { copy } from './copy';

describe('failureView', () => {
  it('写发生了什么；只有回执说可以重试时才给重新整理', () => {
    expect(failureView('processing_failed', true)).toEqual({
      message: copy.failure.processing_failed,
      reorganize: true,
    });
    expect(failureView('all_materials_unusable', false)).toEqual({
      message: copy.failure.all_materials_unusable,
      reorganize: false,
    });
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
