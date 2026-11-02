import { describe, expect, it } from 'vitest';
import type { RecordDraft } from '@/contracts/record';
import type { RecordJob } from './types';
import {
  initialState,
  inputKey,
  interpretSnapshot,
  isDirty,
  recordReducer,
  type Action,
  type RecordState,
} from './record-flow';
import { doneJob, draft, job, receipt, TEXT } from './record.fixtures';
import { scoreKey } from './types';

const run = (state: RecordState, ...actions: Action[]) =>
  actions.reduce(recordReducer, state);
const op = { key: 'k', id: 'op-1' };
const selectionJob = job({
  status: 'awaiting_manual',
  result: {
    state: 'selection_required',
    draftId: 'draft-1',
    inputVersion: 'v7',
    originalInput: draft.originalInput,
    people: [
      {
        state: 'needs_selection',
        candidates: [
          { id: 'p1', label: '演示甲' },
          { id: 'p2', label: '演示乙' },
        ],
        reason: '这个名字有两位同名同事',
      },
    ],
    project: { state: 'none' },
  },
});

describe('interpretSnapshot', () => {
  it('排队、运行中、部分完成都还在整理', () => {
    for (const status of ['queued', 'running', 'partial'] as const)
      expect(interpretSnapshot(job({ status }))).toEqual({
        kind: 'organizing',
      });
  });

  it('等待人工且有草稿 → 待确认，有选人 → 待选择', () => {
    expect(interpretSnapshot(doneJob)).toEqual({ kind: 'draft', draft });
    expect(interpretSnapshot(selectionJob)).toMatchObject({
      kind: 'selection',
      selection: { draftId: 'draft-1', inputVersion: 'v7' },
    });
  });

  it('失败和取消不渲染任何结果；拿不到结果当作失败', () => {
    expect(
      interpretSnapshot(
        job({
          status: 'failed',
          error: { code: 'dependency_unavailable', message: 'x' },
        }),
      ),
    ).toEqual({ kind: 'failed', failure: 'dependency_unavailable' });
    expect(interpretSnapshot(job({ status: 'cancelled' }))).toEqual({
      kind: 'failed',
      failure: 'cancelled',
    });
    expect(interpretSnapshot(job({ status: 'failed' }))).toEqual({
      kind: 'failed',
      failure: 'processing_failed',
    });
    for (const status of ['awaiting_manual', 'completed'] as const)
      expect(interpretSnapshot(job({ status }))).toEqual({
        kind: 'failed',
        failure: 'processing_failed',
      });
  });
});

describe('initialState', () => {
  it('默认是空白输入，预选的人保留', () => {
    expect(initialState()).toMatchObject({
      phase: 'write',
      text: '',
      personId: null,
    });
    expect(initialState({ personId: 'p1' }).personId).toBe('p1');
  });

  it('带草稿直接进入待确认，原话和人员取自草稿', () => {
    const state = initialState({ draft });
    expect(state).toMatchObject({
      phase: 'review',
      text: TEXT,
      personId: 'p1',
    });
    expect(state.edit?.scores[scoreKey('p1', 'prof')]?.value).toBe(3);
  });

  it('带任务 id 进入整理中', () => {
    expect(initialState({ jobId: 'job-9' })).toMatchObject({
      phase: 'organizing',
      jobId: 'job-9',
    });
  });

  it('草稿里没识别出人时回到输入并提示', () => {
    const none: RecordDraft = { ...draft, people: [{ state: 'none' }] };
    expect(initialState({ draft: none })).toMatchObject({
      phase: 'write',
      draft: null,
      banner: { kind: 'who' },
    });
  });

  it('草稿里有待选择的人时进入待确认并带着选择', () => {
    const pending: RecordDraft = {
      ...draft,
      people: [
        {
          state: 'needs_selection',
          candidates: [{ id: 'p1', label: '演示甲' }],
          reason: '重名',
        },
      ],
    };
    const state = initialState({ draft: pending });
    expect(state.phase).toBe('review');
    expect(state.selection).toMatchObject({
      draftId: 'draft-1',
      inputVersion: '1',
    });
  });
});

describe('输入与提交', () => {
  it('输入文字和人员，识别提示随输入消失', () => {
    const who = initialState({
      draft: { ...draft, people: [{ state: 'none' }] },
    });
    const next = run(
      who,
      { type: 'text', text: '补上名字' },
      { type: 'person', personId: 'p2' },
    );
    expect(next).toMatchObject({
      text: '补上名字',
      personId: 'p2',
      banner: null,
    });
  });

  it('网络提示不会因输入而消失', () => {
    const state = run(
      initialState(),
      { type: 'submit_begin', op },
      { type: 'submit_offline' },
      { type: 'text', text: 'x' },
    );
    expect(state.banner).toEqual({ kind: 'offline', scope: 'start' });
  });

  it('提交 → 任务入队 → 整理中；断网回到输入并保留内容', () => {
    const typed = run(initialState(), { type: 'text', text: TEXT });
    const submitting = run(typed, { type: 'submit_begin', op });
    expect(submitting).toMatchObject({ phase: 'submitting', startOp: op });
    expect(run(submitting, { type: 'submit_offline' })).toMatchObject({
      phase: 'write',
      text: TEXT,
      banner: { kind: 'offline', scope: 'start' },
    });
    const organizing = run(submitting, {
      type: 'job_begin',
      jobId: 'job-1',
      job: job(),
    });
    expect(organizing).toMatchObject({
      phase: 'organizing',
      jobId: 'job-1',
      failure: null,
    });
  });

  it('被拒绝时回到输入，权限问题单独标出', () => {
    const typed = run(initialState(), { type: 'text', text: TEXT });
    expect(
      run(
        typed,
        { type: 'submit_begin', op },
        { type: 'submit_refused', message: '请稍后' },
      ).banner,
    ).toEqual({ kind: 'refused', message: '请稍后' });
    expect(
      run(
        typed,
        { type: 'submit_begin', op },
        { type: 'submit_refused', message: '权限变了', forbidden: true },
      ).banner,
    ).toEqual({ kind: 'forbidden', message: '权限变了' });
  });
});

describe('任务快照', () => {
  const organizing = run(initialState({ jobId: 'job-1', text: TEXT }), {
    type: 'job',
    job: job({ status: 'running' }),
  });

  it('完成后进入待确认', () => {
    const next = run(organizing, { type: 'job', job: doneJob });
    expect(next).toMatchObject({ phase: 'review', draft });
  });

  it('选人结果进入待选择', () => {
    const next = run(organizing, { type: 'job', job: selectionJob });
    expect(next.phase).toBe('selecting');
    expect(next.selection?.people).toHaveLength(1);
  });

  it('失败留在整理阶段并保留原话，不出现草稿', () => {
    const next = run(organizing, {
      type: 'job',
      job: job({
        status: 'failed',
        error: { code: 'processing_failed', message: 'x' },
      }),
    });
    expect(next).toMatchObject({
      phase: 'organizing',
      failure: 'processing_failed',
      text: TEXT,
      draft: null,
    });
  });

  it('别的任务的快照、提交途中、已在待确认时的快照都被忽略', () => {
    expect(
      run(organizing, {
        type: 'job',
        job: job({ jobId: 'other', status: 'failed' }),
      }),
    ).toBe(organizing);
    const submitting = run(organizing, { type: 'select_begin' });
    expect(run(submitting, { type: 'job', job: doneJob })).toBe(submitting);
    const review = run(organizing, { type: 'job', job: doneJob });
    expect(run(review, { type: 'job', job: job({ status: 'failed' }) })).toBe(
      review,
    );
  });

  it('选定后提交新任务，由新任务接管', () => {
    const selecting = run(organizing, { type: 'job', job: selectionJob });
    const next = run(
      selecting,
      { type: 'select_begin' },
      { type: 'job_begin', jobId: 'job-2', job: job({ jobId: 'job-2' }) },
    );
    expect(next).toMatchObject({
      phase: 'organizing',
      jobId: 'job-2',
      selection: null,
    });
  });

  it('提交选择被拒或断网时仍停在待选择', () => {
    const selecting = run(organizing, { type: 'job', job: selectionJob });
    const refused = run(
      selecting,
      { type: 'select_begin' },
      { type: 'submit_refused', message: '候选已变化' },
    );
    expect(refused.phase).toBe('selecting');
    expect(
      run(selecting, { type: 'select_begin' }, { type: 'submit_offline' })
        .phase,
    ).toBe('selecting');
  });

  it('连接状态只改连接，不丢快照', () => {
    const next = run(organizing, { type: 'connection', connection: 'error' });
    expect(next).toMatchObject({
      connection: 'error',
      job: organizing.job,
      phase: 'organizing',
    });
  });
});

describe('待确认：编辑与保存', () => {
  const review = initialState({ draft });
  const key = scoreKey('p1', 'prof');

  it('改文字、改分、写理由；保存前这些都留在页面状态里', () => {
    const next = run(
      review,
      { type: 'edit_sbi', field: 'title', value: '新标题' },
      { type: 'edit_score', key, value: 5 },
      { type: 'edit_reason', key, reason: '带着大家做' },
    );
    expect(next.edit?.sbi.title).toBe('新标题');
    expect(next.edit?.scores[key]).toEqual({
      value: 5,
      touched: true,
      reason: '带着大家做',
    });
    expect(isDirty(next)).toBe(true);
  });

  it('不存在的分数行、没有草稿时的编辑被忽略', () => {
    const blank = initialState();
    expect(run(blank, { type: 'edit_sbi', field: 'title', value: 'x' })).toBe(
      blank,
    );
    expect(run(review, { type: 'edit_score', key: 'nope', value: 2 })).toBe(
      review,
    );
    expect(run(blank, { type: 'edit_reason', key, reason: 'x' })).toBe(blank);
    expect(run(review, { type: 'edit_reason', key: 'nope', reason: 'x' })).toBe(
      review,
    );
  });

  it('保存中 → 已保存', () => {
    const saved = run(
      review,
      { type: 'save_begin', op },
      { type: 'save_saved', receipt, replayed: false },
    );
    expect(saved).toMatchObject({ phase: 'saved', receipt, replayed: false });
    expect(isDirty(saved)).toBe(false);
    // 已保存后不再接受改分
    expect(run(saved, { type: 'edit_score', key, value: 1 })).toBe(saved);
  });

  it('保存断网、冲突、权限问题都回到待确认并保留全部修改', () => {
    const edited = run(
      review,
      { type: 'edit_sbi', field: 'impact', value: '改过' },
      { type: 'save_begin', op },
    );
    for (const [action, banner] of [
      [{ type: 'save_offline' }, { kind: 'offline', scope: 'save' }],
      [
        { type: 'save_conflict', message: '被改了' },
        { kind: 'conflict', message: '被改了' },
      ],
      [
        { type: 'save_forbidden', message: '没权限了' },
        { kind: 'forbidden', message: '没权限了' },
      ],
    ] as const) {
      const next = run(edited, action);
      expect(next.phase).toBe('review');
      expect(next.edit?.sbi.impact).toBe('改过');
      expect(next.banner).toEqual(banner);
    }
  });

  it('字段问题可定位，再次编辑文字后清除提示', () => {
    const problems = { title: '补充标题后再保存', scores: {}, general: false };
    const flagged = run(review, { type: 'save_problems', problems });
    expect(flagged).toMatchObject({
      problems,
      banner: { kind: 'saveProblems' },
    });
    const cleared = run(flagged, {
      type: 'edit_sbi',
      field: 'title',
      value: '好',
    });
    expect(cleared).toMatchObject({ problems: null, banner: null });
    const keptBanner = run(run(review, { type: 'save_offline' }), {
      type: 'edit_sbi',
      field: 'title',
      value: '好',
    });
    expect(keptBanner.banner).toEqual({ kind: 'offline', scope: 'save' });
  });

  it('save_blocked 只清提示', () => {
    expect(
      run(run(review, { type: 'save_offline' }), { type: 'save_blocked' })
        .banner,
    ).toBeNull();
  });

  it('载入最新版本替换草稿和修改', () => {
    const edited = run(review, {
      type: 'edit_sbi',
      field: 'title',
      value: '我的版本',
    });
    const next = run(edited, {
      type: 'draft_loaded',
      draft: { ...draft, revision: 2, sbi: { ...draft.sbi, title: '最新' } },
    });
    expect(next.edit?.sbi.title).toBe('最新');
    expect(next.draft?.revision).toBe(2);
  });
});

describe('回到输入', () => {
  it('改原话保留原话、人员和附件，丢弃草稿', () => {
    const review = run(
      initialState({
        draft: {
          ...draft,
          originalInput: { ...draft.originalInput, attachmentIds: ['att-1'] },
        },
      }),
      { type: 'edit_sbi', field: 'title', value: '改' },
    );
    const back = run(review, { type: 'back_to_write' });
    expect(back).toMatchObject({
      phase: 'write',
      text: TEXT,
      personId: 'p1',
      attachmentIds: ['att-1'],
      draft: null,
      edit: null,
      jobId: null,
    });
  });

  it('撤销成功后照原型回到待确认：草稿、修改和本页的原话都在，保存的 operation_id 作废', () => {
    const saved = run(
      initialState({
        draft: {
          ...draft,
          originalInput: { ...draft.originalInput, attachmentIds: ['att-2'] },
        },
      }),
      { type: 'save_begin', op },
      { type: 'save_saved', receipt, replayed: false },
    );
    // 846 的撤销回执不带原输入：原话、人员和附件用本页保存时的内容
    const undone = run(saved, { type: 'undone' });
    expect(undone).toMatchObject({
      phase: 'review',
      text: TEXT,
      personId: 'p1',
      attachmentIds: ['att-2'],
      receipt: null,
      saveOp: null,
      draft: saved.draft,
      edit: saved.edit,
    });
  });

  it('没有草稿时撤销回到输入', () => {
    const undone = run(initialState({ text: '原话' }), { type: 'undone' });
    expect(undone).toMatchObject({ phase: 'write', text: '原话' });
  });
});

describe('inputKey 与 isDirty', () => {
  it('内容相同的输入签名相同，内容变了签名变化', () => {
    const a = { text: ' 原话 ', personId: null, attachmentIds: [] };
    expect(inputKey(a)).toBe(inputKey({ ...a, text: '原话' }));
    expect(inputKey(a)).not.toBe(inputKey({ ...a, personId: 'p1' }));
    expect(inputKey(a)).not.toBe(inputKey({ ...a, attachmentIds: ['x'] }));
  });

  it('各阶段的未保存状态', () => {
    const write = initialState();
    expect(isDirty(write)).toBe(false);
    expect(isDirty(run(write, { type: 'text', text: ' ' }))).toBe(false);
    expect(isDirty(run(write, { type: 'text', text: '写了' }))).toBe(true);
    expect(isDirty(run(write, { type: 'submit_begin', op }))).toBe(true);
    const review = initialState({ draft });
    expect(isDirty(review)).toBe(false);
    expect(isDirty(run(review, { type: 'save_begin', op }))).toBe(true);
    expect(isDirty(initialState({ jobId: 'job-1' }))).toBe(false);
  });
});

describe('边界：不丢输入、不覆盖新状态、不重放旧整理', () => {
  const key = scoreKey('p1', 'prof');

  it('保存中和已保存时改分、改理由、改文字都被忽略，已保存显示的是提交的值', () => {
    const saving = run(
      initialState({ draft }),
      { type: 'edit_score', key, value: 4 },
      { type: 'save_begin', op },
    );
    const during = run(
      saving,
      { type: 'edit_score', key, value: 1 },
      { type: 'edit_reason', key, reason: '保存中写的' },
      { type: 'edit_sbi', field: 'title', value: '保存中改的' },
    );
    expect(during.edit).toBe(saving.edit);
    const saved = run(during, {
      type: 'save_saved',
      receipt,
      replayed: false,
    });
    expect(saved.edit?.scores[key]?.value).toBe(4);
    expect(run(saved, { type: 'edit_score', key, value: 2 })).toBe(saved);
  });

  it('迟到的「载入最新版本」：读取期间又改过就不覆盖，没改过照常替换', () => {
    const review = initialState({ draft });
    const basis = review.edit;
    const edited = run(review, {
      type: 'edit_sbi',
      field: 'title',
      value: '读取期间新写的',
    });
    const latest = {
      ...draft,
      revision: 2,
      sbi: { ...draft.sbi, title: '最新' },
    };
    expect(run(edited, { type: 'draft_loaded', draft: latest, basis })).toBe(
      edited,
    );
    expect(
      run(review, { type: 'draft_loaded', draft: latest, basis }).edit?.sbi
        .title,
    ).toBe('最新');
  });

  it('重试成功后，上一轮读取迟到的失败快照不覆盖新状态', () => {
    const failed = run(initialState({ jobId: 'job-1', text: TEXT }), {
      type: 'job',
      job: job({
        status: 'failed',
        revision: 4,
        error: { code: 'processing_failed', message: 'x' },
      }),
    });
    const retried = run(failed, {
      type: 'job',
      job: job({ status: 'running', revision: 5 }),
    });
    expect(retried).toMatchObject({ phase: 'organizing', failure: null });
    const stale = run(retried, {
      type: 'job',
      job: job({
        status: 'failed',
        revision: 4,
        error: { code: 'processing_failed', message: 'x' },
      }),
    });
    expect(stale).toBe(retried);
  });

  it('刷新后从任务恢复到待选择：原话、人员、附件取自任务记下的原始输入', () => {
    const restored = run(initialState({ jobId: 'job-1' }), {
      type: 'job',
      job: job({
        ...selectionJob,
        result: {
          ...(selectionJob.result as object),
          originalInput: {
            ...draft.originalInput,
            text: '刷新前写的原话',
            attachmentIds: ['att-9'],
          },
        } as RecordJob['result'],
      }),
    });
    expect(restored).toMatchObject({
      phase: 'selecting',
      text: '刷新前写的原话',
      attachmentIds: ['att-9'],
    });
    // 选人时断网再回到输入，原话仍在
    const back = run(
      restored,
      { type: 'select_begin' },
      { type: 'submit_offline' },
    );
    expect(back.banner).toEqual({ kind: 'offline', scope: 'select' });
    expect(run(back, { type: 'back_to_write' }).text).toBe('刷新前写的原话');
  });

  it('取消或撤销后回到输入，不再沿用那次整理的 operation_id；断网未送达时仍复用', () => {
    const offline = run(
      initialState({ text: TEXT }),
      { type: 'submit_begin', op },
      { type: 'submit_offline' },
    );
    expect(offline.startOp).toBe(op);
    const review = run(
      offline,
      { type: 'submit_begin', op },
      { type: 'job_begin', jobId: 'job-1', job: doneJob },
    );
    expect(run(review, { type: 'back_to_write' }).startOp).toBeNull();
    const undone = run(
      review,
      { type: 'save_begin', op: { key: 's', id: 'save-op' } },
      { type: 'save_saved', receipt, replayed: false },
      { type: 'undone' },
    );
    expect(undone.startOp).toBeNull();
  });
});
