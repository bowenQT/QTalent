import { describe, expect, it } from 'vitest';
import {
  initialState,
  inputKey,
  isDirty,
  recordReducer,
  type Action,
  type RecordState,
} from './record-flow';
import {
  batch,
  doneBatch,
  draft,
  receipt,
  TEXT,
  twoPeopleDraft,
} from './record.fixtures';
import { scoreKey } from './types';

const run = (state: RecordState, ...actions: Action[]) =>
  actions.reduce(recordReducer, state);
const op = { key: 'k', id: 'op-1' };
const typed = run(
  initialState(),
  { type: 'text', text: TEXT },
  { type: 'person', personId: 'p1' },
);
const organizing = run(
  typed,
  { type: 'submit_begin', op },
  {
    type: 'batch_begin',
    batch: batch(),
  },
);
const review = run(organizing, { type: 'batch', batch: doneBatch });

describe('initialState', () => {
  it('默认是空白输入，预选的人保留', () => {
    expect(initialState({ personId: 'p2' })).toMatchObject({
      phase: 'write',
      text: '',
      personId: 'p2',
      batchId: null,
    });
  });

  it('带批次 id 进入整理中，原话由页面从会话暂存补上', () => {
    expect(initialState({ batchId: 'b-9' })).toMatchObject({
      phase: 'organizing',
      batchId: 'b-9',
      text: '',
    });
  });
});

describe('输入与提交', () => {
  it('输入文字和人员；节点和拒绝提示随输入消失，网络提示保留', () => {
    const node = run(typed, { type: 'node_unresolved', reason: 'multiple' });
    expect(node.banner).toEqual({
      kind: 'node',
      reason: 'multiple',
      picked: true,
    });
    expect(run(node, { type: 'text', text: '改了' }).banner).toBeNull();
    const refused = run(typed, { type: 'submit_refused', message: '不行' });
    expect(run(refused, { type: 'person', personId: null }).banner).toBeNull();
    const offline = run(typed, { type: 'submit_offline' });
    expect(run(offline, { type: 'text', text: 'x' }).banner).toEqual({
      kind: 'offline',
      scope: 'start',
    });
  });

  it('推导节点时还没有 operation_id：沿用上一次的，定下节点后才换', () => {
    const resolving = run(typed, { type: 'submit_begin' });
    expect(resolving).toMatchObject({ phase: 'submitting', startOp: null });
    const kept = run({ ...typed, startOp: op }, { type: 'submit_begin' });
    expect(kept.startOp).toBe(op);
  });

  it('节点不唯一或待接通：回到输入并写明原因，没选人时提示先选', () => {
    for (const reason of [
      'multiple',
      'none',
      'pending',
      'unavailable',
    ] as const) {
      const next = run(
        typed,
        { type: 'submit_begin' },
        { type: 'node_unresolved', reason },
      );
      expect(next).toMatchObject({
        phase: 'write',
        text: TEXT,
        banner: { kind: 'node', reason, picked: true },
      });
    }
    const auto = run(
      initialState({ text: TEXT }),
      { type: 'submit_begin' },
      { type: 'node_unresolved', reason: 'none' },
    );
    expect(auto.banner).toEqual({
      kind: 'node',
      reason: 'none',
      picked: false,
    });
  });

  it('提交 → 批次处理中；断网回到输入并保留内容', () => {
    expect(organizing).toMatchObject({
      phase: 'organizing',
      batchId: 'batch-1',
      startOp: op,
      connection: 'connected',
    });
    const offline = run(
      typed,
      { type: 'submit_begin', op },
      {
        type: 'submit_offline',
      },
    );
    expect(offline).toMatchObject({
      phase: 'write',
      text: TEXT,
      startOp: op,
      banner: { kind: 'offline', scope: 'start' },
    });
  });

  it('被拒绝时回到输入，权限问题单独标出', () => {
    expect(
      run(typed, { type: 'submit_refused', message: '原话为空' }).banner,
    ).toEqual({ kind: 'refused', message: '原话为空' });
    expect(
      run(typed, {
        type: 'submit_refused',
        message: '没有权限',
        forbidden: true,
      }).banner,
    ).toEqual({ kind: 'forbidden', message: '没有权限' });
  });
});

describe('批次进度', () => {
  it('只有一件事：在本页待确认，原话仍是本页的输入', () => {
    expect(review).toMatchObject({
      phase: 'review',
      draft,
      text: TEXT,
      handoff: null,
    });
    expect(review.edit?.sbi.title).toBe(draft.sbi.title);
  });

  it('多件事、有核对项、整理不出事、已确认：转到回执页并写明原因', () => {
    for (const [receipt, reason] of [
      [
        batch({ drafts: [draft, { ...twoPeopleDraft, draftId: 'd-2' }] }),
        'many',
      ],
      [batch({ drafts: [], review: true }), 'review'],
      [batch({ drafts: [] }), 'none'],
      [batch({ drafts: [], confirmed: 1 }), 'confirmed'],
    ] as const) {
      const next = run(organizing, { type: 'batch', batch: receipt });
      expect(next).toMatchObject({
        phase: 'handoff',
        handoff: reason,
        draft: null,
      });
    }
  });

  it('失败留在整理阶段并保留原话，按回执写是否可以重试', () => {
    const failed = run(organizing, {
      type: 'batch',
      batch: batch({ status: 'failed', retryable: false, revision: 2 }),
    });
    expect(failed).toMatchObject({
      phase: 'organizing',
      text: TEXT,
      draft: null,
      failure: { kind: 'processing_failed', retryable: false },
    });
  });

  it('处理中的回执保持整理中；别的批次、迟到的旧修订、已在待确认时都被忽略', () => {
    const later = run(organizing, {
      type: 'batch',
      batch: batch({ status: 'processing', revision: 4 }),
    });
    expect(later.batch?.revision).toBe(4);
    expect(
      run(later, {
        type: 'batch',
        batch: batch({ drafts: [draft], revision: 2 }),
      }),
    ).toBe(later);
    expect(
      run(organizing, { type: 'batch', batch: batch({ batchId: 'other' }) }),
    ).toBe(organizing);
    expect(run(review, { type: 'batch', batch: doneBatch })).toBe(review);
  });

  it('连接状态只改连接，不丢回执', () => {
    const lost = run(organizing, { type: 'connection', connection: 'error' });
    expect(lost).toMatchObject({
      connection: 'error',
      batch: organizing.batch,
    });
  });
});

describe('待确认：编辑与保存', () => {
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

  it('迟到的「载入最新版本」：读取期间又改过就不覆盖，没改过照常替换', () => {
    const basis = review.edit;
    const edited = run(review, {
      type: 'edit_sbi',
      field: 'title',
      value: '读取期间写的',
    });
    const latest = { ...draft, revision: 2 };
    expect(run(edited, { type: 'draft_loaded', draft: latest, basis })).toBe(
      edited,
    );
    expect(
      run(review, { type: 'draft_loaded', draft: latest, basis }).draft,
    ).toBe(latest);
  });
});

describe('回到输入与撤销', () => {
  it('改原话保留原话和人员，丢弃草稿和批次', () => {
    const back = run(
      review,
      { type: 'edit_sbi', field: 'title', value: '改' },
      { type: 'back_to_write' },
    );
    expect(back).toMatchObject({
      phase: 'write',
      text: TEXT,
      personId: 'p1',
      draft: null,
      edit: null,
      batchId: null,
      startOp: null,
    });
  });

  it('撤销成功后照原型回到待确认：草稿、修改和本页的原话都在，保存的 operation_id 作废', () => {
    const saved = run(
      review,
      { type: 'edit_sbi', field: 'impact', value: '改过' },
      { type: 'save_begin', op },
      { type: 'save_saved', receipt, replayed: false },
    );
    // 846 的撤销回执不带原输入：原话和人员用本页保存时的内容
    const undone = run(saved, { type: 'undone' });
    expect(undone).toMatchObject({
      phase: 'review',
      text: TEXT,
      personId: 'p1',
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
    const a = { text: ' 原话 ', personId: null };
    expect(inputKey(a)).toBe(inputKey({ ...a, text: '原话' }));
    expect(inputKey(a)).not.toBe(inputKey({ ...a, personId: 'p1' }));
  });

  it('各阶段的未保存状态', () => {
    expect(isDirty(initialState())).toBe(false);
    expect(isDirty(typed)).toBe(true);
    expect(isDirty(run(typed, { type: 'submit_begin' }))).toBe(true);
    expect(isDirty(organizing)).toBe(false);
    expect(isDirty(review)).toBe(false);
    expect(isDirty(run(review, { type: 'save_begin', op }))).toBe(true);
  });
});
