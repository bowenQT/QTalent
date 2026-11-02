import { describe, expect, it } from 'vitest';
import {
  materialReferencesFixture as refs,
  materialReviewItemsFixture,
  recordBatchDraftFixture as draft,
} from '@/contracts/materials.fixtures';
import type {
  MaterialBatchReceipt,
  MaterialFileReceipt,
} from '@/contracts/materials';
import type { MaterialReviewResolvedItem } from '@/contracts/material-review';
import {
  extLabel,
  fileState,
  formatLocation,
  heldEntries,
  isEdited,
  leadQuote,
  materialCount,
  materialLabel,
  people,
  resolvedResult,
  reviewQuestion,
  saveInput,
  saveKey,
  skippedEntries,
  suggestedValues,
} from './receipt-model';
import type { ReceiptView } from './types';

const base = { materialId: 'm1', clientFileId: 'c1', filename: '评审表.xlsx' };
const files: MaterialFileReceipt[] = [
  {
    ...base,
    status: 'parsed',
    originalVersionId: 'demo-document-v1',
    parseVersionId: 'p1',
  },
  {
    ...base,
    materialId: 'm2',
    clientFileId: 'c2',
    filename: '录音.m4a',
    status: 'parsed',
    originalVersionId: 'demo-audio-v1',
    parseVersionId: 'p2',
  },
];
const receipt = {
  files,
  textMaterial: { materialId: 'm-text', originalVersionId: 'text-v1' },
  items: materialReviewItemsFixture,
  resolvedItems: [],
} as unknown as MaterialBatchReceipt;

const resolvedBase = {
  batchId: 'demo-batch',
  evaluationNodeId: 'demo-node',
  materialId: 'demo-material',
  originalVersionId: 'demo-document-v1',
  revision: 2,
  source: null,
  state: 'resolved' as const,
  resolvedAt: '2026-09-03T10:00:00.000Z',
  auditId: 'a1',
  undo: { status: 'available' as const },
};
const viewPeople: ReceiptView['people'] = {
  p1: { name: '孟逸尘', hue: 1, photo: null, meta: '', demo: true },
  p2: { name: '沈亦初', hue: 2, photo: null, meta: '', demo: true },
};

describe('出处位置', () => {
  it('按原件形态写段、页、单元格、时间、区域和代码行', () => {
    expect(Object.values(refs).map(formatLocation)).toEqual([
      '第 2 段',
      '第 2 页',
      '演示评审表 B3',
      '第 3 页',
      '00:01–00:03',
      '00:00–00:02',
      '图中区域',
      'src/demo.ts 第 4–6 行',
    ]);
  });

  it('原件名：文件按版本找，文字投递叫「原话」，找不到写「原件」', () => {
    expect(materialLabel(receipt, 'demo-audio-v1')).toBe('录音.m4a');
    expect(materialLabel(receipt, 'text-v1')).toBe('原话');
    expect(materialLabel(receipt, 'gone')).toBe('原件');
    expect(materialLabel({ ...receipt, textMaterial: null }, 'text-v1')).toBe(
      '原件',
    );
  });

  it('格式角标取扩展名，没有扩展名写「文件」', () => {
    expect(extLabel('结营路演.pptx')).toBe('PPTX');
    expect(extLabel('a.jpeg2000')).toBe('JPEG');
    expect(extLabel('README')).toBe('文件');
  });
});

describe('文件状态', () => {
  it('七种终态各有说法；不支持和失败写原因', () => {
    const f = (status: string, extra = {}) =>
      fileState({
        ...base,
        originalVersionId: 'v',
        status,
        ...extra,
      } as MaterialFileReceipt);
    expect(f('processing', { jobId: 'j' })).toMatchObject({
      label: '处理中',
      busy: true,
    });
    expect(f('parsed', { parseVersionId: 'p' })).toMatchObject({
      label: '已解析',
      tone: 'ok',
    });
    expect(f('needs_review', { reviewItemIds: ['i'] }).label).toBe('待核对');
    expect(f('original_only').label).toBe('只保留原件');
    expect(f('attachment_only').label).toBe('只作附件');
    expect(
      f('unsupported', { reason: 'format', message: '转成 JPG 再传' }),
    ).toMatchObject({
      label: '待换文件',
      tone: 'err',
      message: '转成 JPG 再传',
    });
    expect(
      f('failed', {
        code: 'processing_failed',
        message: '读取失败',
        retryable: true,
      }),
    ).toMatchObject({ label: '失败', message: '读取失败' });
  });
});

describe('待核对', () => {
  it('六类问题都用原件名和位置说清是哪里，不列候选人', () => {
    expect(
      materialReviewItemsFixture.map((item) => reviewQuestion(receipt, item)),
    ).toEqual([
      '录音.m4a 00:01–00:03的说话人是谁',
      '评审表.xlsx提到的人是谁',
      '原件里要整理哪几行',
      '面试官「演示面试官乙」是谁',
      '「演示课题」是哪个课题',
      '原件 第 2 页的候选人是谁',
    ]);
    const named = {
      ...materialReviewItemsFixture[1]!,
      observedName: '小周',
      source: refs.document,
    };
    expect(reviewQuestion(receipt, named as never)).toBe(
      '评审表.xlsx 第 2 段的「小周」指谁',
    );
    const noName = { ...materialReviewItemsFixture[3]!, observedName: null };
    expect(reviewQuestion(receipt, noName as never)).toBe(
      '原件 第 2 页的面试官是谁',
    );
    const project = { ...materialReviewItemsFixture[4]!, observedName: null };
    expect(reviewQuestion(receipt, project as never)).toBe(
      '评审表.xlsx属于哪个课题',
    );
    const candidate = {
      ...materialReviewItemsFixture[5]!,
      observedName: '小林',
    };
    expect(reviewQuestion(receipt, candidate as never)).toBe(
      '候选人「小林」是谁',
    );
  });

  it('已核对的结果按动作写；名单外的人照原型说法', () => {
    const r = (kind: string, resolution: object) =>
      resolvedResult(
        { ...resolvedBase, kind, resolution } as MaterialReviewResolvedItem,
        viewPeople,
      );
    expect(r('speaker', { action: 'bind', personId: 'p1' })).toBe('孟逸尘');
    expect(r('speaker', { action: 'mark_irrelevant' })).toBe('与这次无关');
    expect(r('speaker', { action: 'bind', personId: 'hidden' })).toBeNull();
    expect(
      r('unknown_person', {
        action: 'bind_people',
        personIds: ['p1', 'p2', 'px'],
      }),
    ).toBe('孟逸尘、沈亦初');
    expect(r('unknown_person', { action: 'keep_original_only' })).toBe(
      '名单外的人',
    );
    expect(
      r('image_scope', { action: 'confirm_scope', personIds: ['p1'] }),
    ).toBe('整理范围内的部分');
    expect(r('image_scope', { action: 'keep_attachment_only' })).toBe(
      '只作附件',
    );
    expect(
      r('unknown_interviewer', {
        action: 'link_existing_interviewer',
        personId: 'p2',
      }),
    ).toBe('沈亦初');
    expect(
      r('unknown_project', { action: 'link_existing_project', projectId: 'x' }),
    ).toBeNull();
    expect(r('unknown_project', { action: 'mark_no_project' })).toBe(
      '明确无课题',
    );
    expect(
      r('unknown_interview_candidate', {
        action: 'link_existing_candidate',
        personId: 'p1',
      }),
    ).toBe('孟逸尘');
  });

  it('认人之前的事只列原件里的一处：说话人带引文，未知人员带名字', () => {
    const held = heldEntries(receipt);
    expect(held.map((h) => h.itemId)).toEqual([
      'demo-speaker-review',
      'demo-person-review',
    ]);
    expect(held[0]).toMatchObject({
      who: '「说话人 · 00:01–00:03」',
      quote: '演示：补充了一次边界验证。',
      source: '录音.m4a · 00:01–00:03',
    });
    expect(held[1]).toEqual({
      itemId: 'demo-person-review',
      who: null,
      quote: null,
      source: null,
    });
    const withSource = {
      ...receipt,
      items: [
        { ...materialReviewItemsFixture[0]!, source: null },
        {
          ...materialReviewItemsFixture[1]!,
          observedName: '小周',
          source: refs.document,
        },
      ],
    } as unknown as MaterialBatchReceipt;
    expect(heldEntries(withSource).map((h) => [h.who, h.source])).toEqual([
      [null, null],
      ['「小周」', '评审表.xlsx · 第 2 段'],
    ]);
  });

  it('名单外的人单独列出；其他已核对的不列', () => {
    const skipped = skippedEntries({
      ...receipt,
      resolvedItems: [
        {
          ...resolvedBase,
          kind: 'unknown_person',
          itemId: 's1',
          observedName: '阿泽',
          source: refs.document,
          resolution: { action: 'keep_original_only' },
        },
        {
          ...resolvedBase,
          kind: 'unknown_person',
          itemId: 's2',
          observedName: null,
          resolution: { action: 'keep_original_only' },
        },
        {
          ...resolvedBase,
          kind: 'unknown_person',
          itemId: 's3',
          observedName: null,
          resolution: { action: 'bind_people', personIds: ['p1'] },
        },
      ],
    } as unknown as MaterialBatchReceipt);
    expect(skipped).toEqual([
      { itemId: 's1', who: '「阿泽」', source: '评审表.xlsx · 第 2 段' },
      { itemId: 's2', who: null, source: null },
    ]);
  });
});

describe('一件事的确认', () => {
  it('标题下的引文取第一条建议分的原话；按原件版本数合成', () => {
    expect(leadQuote(draft)?.quote).toBe('完成合成任务并记录验证步骤');
    expect(leadQuote({ ...draft, scores: [draft.scores[1]!] })).toBeNull();
    expect(materialCount(draft)).toBe(1);
    expect(
      materialCount({ ...draft, sourceReferences: [refs.document, refs.pdf] }),
    ).toBe(2);
  });

  it('没改分是确认，改了是改分带理由，资料不足原样带原因', () => {
    const values = suggestedValues(draft);
    expect(values).toEqual({ 'demo-person:demo-professionalism': 3 });
    expect(isEdited(draft, values)).toBe(false);
    expect(saveInput(draft, values, '', 'op-1')).toEqual({
      operation_id: 'op-1',
      expected_revision: 1,
      draftId: 'demo-event-draft-a',
      personIds: ['demo-person'],
      projectId: null,
      sbi: draft.sbi,
      decisions: [
        {
          personId: 'demo-person',
          dimensionId: 'demo-professionalism',
          action: 'confirm',
        },
        {
          personId: 'demo-person',
          dimensionId: 'demo-potential',
          action: 'unknown',
          reason: '资料不足',
        },
      ],
    });
    const edited = { 'demo-person:demo-professionalism': 4 } as const;
    expect(isEdited(draft, edited)).toBe(true);
    expect(isEdited(draft, {})).toBe(false);
    expect(saveInput(draft, edited, '两人合作', 'op-2').decisions[0]).toEqual({
      personId: 'demo-person',
      dimensionId: 'demo-professionalism',
      action: 'edit',
      value: 4,
      reason: '两人合作',
    });
    expect(saveInput(draft, {}, '', 'op-3').decisions[0]!.action).toBe(
      'confirm',
    );
  });

  it('同样的内容得到同一个重发键，与 operation_id 无关', () => {
    const values = suggestedValues(draft);
    expect(saveKey(saveInput(draft, values, '', 'a'))).toBe(
      saveKey(saveInput(draft, values, '', 'b')),
    );
    expect(
      saveKey(
        saveInput(draft, { 'demo-person:demo-professionalism': 5 }, 'x', 'a'),
      ),
    ).not.toBe(saveKey(saveInput(draft, values, '', 'a')));
  });

  it('人名按顺序连起来，读不到的人不写', () => {
    expect(
      people({ people: viewPeople } as ReceiptView, ['p2', 'p1', 'px']),
    ).toBe('沈亦初、孟逸尘');
  });
});
