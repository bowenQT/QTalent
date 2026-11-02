import { describe, expect, it } from 'vitest';
import type { RecordBatchDraft } from '@/contracts/record';
import {
  buildSaveInput,
  initEdit,
  isEdited,
  reuseOperationId,
  saveKey,
  suggestedCount,
  untouchedCount,
} from './build-save-input';
import { draft, textRef, twoPeopleDraft } from './record.fixtures';
import { scoreKey } from './types';

const profKey = scoreKey('p1', 'prof');

describe('initEdit', () => {
  it('每条建议分一项，资料不足的行没有可编辑的分', () => {
    const edit = initEdit(draft);
    expect(Object.keys(edit.scores)).toEqual([profKey]);
    expect(edit.scores[profKey]).toEqual({
      value: 3,
      touched: false,
      reason: '',
    });
    expect(edit.sbi).toEqual(draft.sbi);
  });
});

describe('buildSaveInput', () => {
  it('未改的建议分发 confirm，资料不足的行不发决定', () => {
    const result = buildSaveInput(draft, initEdit(draft), 'op-1');
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      operation_id: 'op-1',
      expected_revision: 1,
      draftId: 'draft-1',
      personIds: ['p1'],
      projectId: null,
    });
    expect(result.input.decisions).toEqual([
      { personId: 'p1', dimensionId: 'prof', action: 'confirm' },
    ]);
  });

  it('改了分发 edit 并带理由，值改回建议值则仍是 confirm', () => {
    const edit = initEdit(draft);
    edit.scores[profKey] = { value: 5, touched: true, reason: ' 带着大家做 ' };
    const changed = buildSaveInput(draft, edit, 'op');
    expect(changed.ok && changed.input.decisions).toEqual([
      {
        personId: 'p1',
        dimensionId: 'prof',
        action: 'edit',
        value: 5,
        reason: '带着大家做',
      },
    ]);
    edit.scores[profKey] = { value: 3, touched: true, reason: '' };
    const back = buildSaveInput(draft, edit, 'op');
    expect(back.ok && back.input.decisions[0]?.action).toBe('confirm');
  });

  it('SBI 去掉首尾空白，情境和影响可以为空', () => {
    const edit = initEdit(draft);
    edit.sbi = {
      title: '  标题 ',
      situation: '  ',
      behavior: ' 行为 ',
      impact: '',
    };
    const result = buildSaveInput(draft, edit, 'op');
    expect(result.ok && result.input.sbi).toEqual({
      title: '标题',
      situation: '',
      behavior: '行为',
      impact: '',
    });
  });

  it('标题或行为为空被拒', () => {
    const edit = initEdit(draft);
    edit.sbi = { ...edit.sbi, title: '  ' };
    expect(buildSaveInput(draft, edit, 'op')).toEqual({
      ok: false,
      reason: 'empty_title',
    });
    edit.sbi = { ...draft.sbi, behavior: '' };
    expect(buildSaveInput(draft, edit, 'op')).toEqual({
      ok: false,
      reason: 'empty_behavior',
    });
  });

  it('人和项目以批次草稿为准', () => {
    const result = buildSaveInput(
      { ...draft, projectId: 'proj-1' },
      initEdit(draft),
      'op',
    );
    expect(result.ok && result.input).toMatchObject({
      personIds: ['p1'],
      projectId: 'proj-1',
      expected_revision: 1,
      draftId: 'draft-1',
    });
  });

  it('多人记录各自一项决定，且不重复', () => {
    const doubled: RecordBatchDraft = {
      ...twoPeopleDraft,
      scores: [...twoPeopleDraft.scores, ...twoPeopleDraft.scores],
    };
    const result = buildSaveInput(doubled, initEdit(doubled), 'op');
    expect(result.ok && result.input.personIds).toEqual(['p1', 'p2']);
    expect(
      result.ok &&
        result.input.decisions.map((d) => `${d.personId}:${d.dimensionId}`),
    ).toEqual(['p1:prof', 'p2:prof']);
  });

  it('不属于已确定人员的分数不进入决定', () => {
    const stray: RecordBatchDraft = {
      ...draft,
      scores: [
        ...draft.scores,
        {
          personId: 'p9',
          dimensionId: 'prof',
          state: 'suggested',
          value: 2,
          anchor: { id: 'a', text: 't', ruleVersion: 'v' },
          citations: [{ kind: 'source', quote: '独立', reference: textRef }],
        },
      ],
    };
    const result = buildSaveInput(stray, initEdit(stray), 'op');
    expect(result.ok && result.input.decisions).toHaveLength(1);
  });

  it('契约校验没过时给 invalid（例如编辑出越界的分）', () => {
    const edit = initEdit(draft);
    edit.scores[profKey] = { value: 9, touched: true, reason: '' };
    expect(buildSaveInput(draft, edit, 'op')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('没有建议分的草稿也能保存（只存文字）', () => {
    const plain: RecordBatchDraft = {
      ...draft,
      scores: draft.scores.filter((s) => s.state === 'unknown'),
    };
    const result = buildSaveInput(plain, initEdit(plain), 'op');
    expect(result.ok && result.input.decisions).toEqual([]);
  });
});

describe('counts and dirty state', () => {
  it('未点击的建议分计数，点击后减少', () => {
    const edit = initEdit(draft);
    expect(suggestedCount(draft)).toBe(1);
    expect(untouchedCount(draft, edit)).toBe(1);
    edit.scores[profKey] = { value: 3, touched: true, reason: '' };
    expect(untouchedCount(draft, edit)).toBe(0);
  });

  it('文字、分数或理由有改动才算改过', () => {
    const edit = initEdit(draft);
    expect(isEdited(draft, edit)).toBe(false);
    for (const field of ['title', 'situation', 'behavior', 'impact'] as const)
      expect(
        isEdited(draft, { ...edit, sbi: { ...edit.sbi, [field]: 'x' } }),
      ).toBe(true);
    expect(
      isEdited(draft, {
        ...edit,
        scores: { [profKey]: { value: 3, touched: true, reason: '' } },
      }),
    ).toBe(true);
    expect(
      isEdited(draft, {
        ...edit,
        scores: { [profKey]: { value: 3, touched: false, reason: '写了' } },
      }),
    ).toBe(true);
  });
});

describe('operation id', () => {
  it('同一内容复用，内容变了换新', () => {
    let n = 0;
    const make = () => `id-${++n}`;
    const first = reuseOperationId(null, 'a', make);
    expect(first).toEqual({ key: 'a', id: 'id-1' });
    expect(reuseOperationId(first, 'a', make)).toBe(first);
    expect(reuseOperationId(first, 'b', make)).toEqual({
      key: 'b',
      id: 'id-2',
    });
  });

  it('保存签名不含 operation_id，内容变化签名随之变化', () => {
    const edit = initEdit(draft);
    const built = buildSaveInput(draft, edit, 'op-a');
    const other = buildSaveInput(draft, edit, 'op-b');
    if (!built.ok || !other.ok) throw new Error('unexpected');
    const strip = ({ operation_id: _o, ...rest }: typeof built.input) => {
      void _o;
      return rest;
    };
    expect(saveKey(strip(built.input))).toBe(saveKey(strip(other.input)));
    edit.sbi = { ...edit.sbi, title: '换个标题' };
    const changed = buildSaveInput(draft, edit, 'op-a');
    if (!changed.ok) throw new Error('unexpected');
    expect(saveKey(strip(changed.input))).not.toBe(saveKey(strip(built.input)));
  });
});
