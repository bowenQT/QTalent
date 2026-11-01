import { describe, expect, it } from 'vitest';
import type { MaterialFileReceipt } from '@/contracts/materials';
import type { MaterialReviewResolvedItem } from '@/contracts/material-review';
import {
  sampleLookup,
  sampleReceipts,
} from '@/app/dev/design-system/receipt/samples';
import { answer, fileLine, question, receiptView, where } from './receipt-view';

describe('receipt view', () => {
  it('leaves people, events and reviews uncounted while files are still read', () => {
    const view = receiptView(sampleReceipts.processing, sampleLookup);
    expect(view.state).toEqual(['processing', '处理中']);
    expect(view.stillReading).toBe(true);
    expect(view.summary).toMatchObject({
      files: 3,
      processing: 2,
      people: null,
      events: null,
      reviews: null,
      awaiting: 0,
    });
    expect(view.hidden).toBe(true);
    expect(view.files.map((file) => file.busy)).toEqual([true, true, false]);
  });

  it('resolves names, questions, answers and held drafts from one snapshot', () => {
    const view = receiptView(sampleReceipts.review, sampleLookup);
    expect(view.title).toBe('本次投递 · 3 个文件');
    expect(view.state).toEqual(['verify', '待核对']);
    expect(view.summary).toMatchObject({
      people: 1,
      events: 4,
      reviews: 1,
      awaiting: 3,
      confirmed: 1,
    });
    expect(view.reviews).toEqual([
      {
        key: 'r-person',
        kind: '未知人员',
        question: '「小周」指谁',
        result: null,
      },
      {
        key: 'r-speaker',
        kind: '说话人',
        question: '「第二天就拿了两个方案过来」是谁说的',
        result: '演示学员甲',
      },
      {
        key: 'r-outsider',
        kind: '未知人员',
        question: '「阿泽」指谁',
        result: '名单外的人',
      },
    ]);
    expect(
      view.drafts.map((draft) => [draft.key, draft.held !== null]),
    ).toEqual([
      ['d-ownership', false],
      ['d-docs', true],
      ['d-docs-again', true],
    ]);
    expect(view.drafts[0]).toMatchObject({
      people: ['演示学员甲'],
      quote: { where: '录音 03:12–03:28' },
      scores: [
        { dimension: '主动担当', state: 'suggested', value: 4 },
        { dimension: '潜力', state: 'unknown', reason: '资料不足' },
      ],
    });
    expect(view.people).toEqual([
      { id: 'demo-p1', name: '演示学员甲', meta: '演示 · 一组' },
    ]);
  });

  it('counts a finished batch, its stopped files and a zero honestly', () => {
    const view = receiptView(sampleReceipts.done, sampleLookup);
    expect(view.state).toEqual(['done', '已完成']);
    expect(view.summary).toMatchObject({
      failed: 1,
      unsupported: 1,
      events: 2,
      reviews: 0,
      awaiting: 0,
    });
    expect(view.drafts).toEqual([]);
  });

  it('names a text-only delivery, a failed batch and unknown lookups plainly', () => {
    const failed = receiptView(
      {
        ...sampleReceipts.done,
        status: 'failed',
        files: [],
        counts: {
          ...sampleReceipts.done.counts,
          files: { ...sampleReceipts.done.counts.files, total: 0 },
        },
        error: {
          code: 'processing_failed',
          message: '整理服务没有响应',
          retryable: true,
        },
      },
      { person: () => null, dimension: () => null, project: () => null },
    );
    expect(failed.title).toBe('本次投递 · 一段文字');
    expect(failed.state).toEqual(['failed', '整理失败']);
    expect(failed.error).toBe('整理服务没有响应');
    expect(failed.people).toEqual([]);
    const draft = receiptView(sampleReceipts.review, {
      ...sampleLookup,
      person: () => null,
      dimension: () => null,
    }).drafts[0];
    expect(draft.people).toEqual([]);
    expect(draft.scores[0].dimension).toBe('维度');
  });
});

describe('file lines', () => {
  it('give every receipt file status its own words', () => {
    const base = { materialId: 'm', clientFileId: 'c', filename: 'a.docx' };
    const statuses: MaterialFileReceipt[] = [
      { ...base, status: 'processing', originalVersionId: 'v', jobId: 'j' },
      {
        ...base,
        status: 'parsed',
        originalVersionId: 'v',
        parseVersionId: 'p',
      },
      {
        ...base,
        status: 'needs_review',
        originalVersionId: 'v',
        reviewItemIds: ['a', 'b'],
      },
      {
        ...base,
        status: 'unsupported',
        originalVersionId: null,
        reason: 'scanned',
        message: '扫描件',
      },
      {
        ...base,
        status: 'failed',
        originalVersionId: 'v',
        code: 'processing_failed',
        message: '整理中断',
        retryable: true,
      },
      { ...base, status: 'original_only', originalVersionId: 'v' },
      { ...base, status: 'attachment_only', originalVersionId: 'v' },
    ];
    expect(
      statuses.map(
        (file) => `${fileLine(file).label} · ${fileLine(file).meta}`,
      ),
    ).toEqual([
      '解析中 · 读取文字和位置',
      '已解析 · 可以定位到原文',
      '待核对 · 2 处',
      '待换文件 · 扫描件',
      '处理中断 · 整理中断',
      '只保留原件 · 原件已保存',
      '只作附件 · 只给对整份材料有权限的人看',
    ]);
  });
});

describe('locations, questions and answers', () => {
  it('say where every kind of cited piece sits', () => {
    expect(
      [
        { kind: 'document', paragraph: '3' },
        { kind: 'document', page: 2, paragraph: '1' },
        { kind: 'pdf', page: 4, textRange: { start: 0, end: 3 } },
        { kind: 'spreadsheet', sheet: '表', cell: 'B2' },
        { kind: 'presentation', slide: 5 },
        { kind: 'recording', startMs: 61_000, endMs: 62_000 },
        { kind: 'video', startMs: 0, endMs: 1_000 },
        { kind: 'image', region: { left: 0, top: 0, right: 1, bottom: 1 } },
        {
          kind: 'code',
          repository: 'r',
          commit: 'a'.repeat(40),
          path: 'src/a.ts',
          startLine: 1,
          endLine: 2,
        },
      ].map((location) => where(location as Parameters<typeof where>[0])),
    ).toEqual([
      '第 3 段',
      '第 2 页 · 第 1 段',
      'PDF 第 4 页',
      '「表」B2',
      '演示文稿第 5 页',
      '录音 01:01–01:02',
      '视频 00:00–00:01',
      '截图框选区域',
      'src/a.ts 第 1–2 行',
    ]);
  });

  it('ask each kind of question, leaving a missing name out', () => {
    expect(
      [
        { kind: 'speaker', quote: null },
        { kind: 'unknown_person', observedName: null },
        { kind: 'image_scope' },
        { kind: 'unknown_project', observedName: '课题甲' },
        { kind: 'unknown_project', observedName: null },
        { kind: 'unknown_interviewer', observedName: 'Kevin' },
        { kind: 'unknown_interviewer', observedName: null },
        { kind: 'unknown_interview_candidate', observedName: '候选人甲' },
        { kind: 'unknown_interview_candidate', observedName: null },
      ].map((item) => question(item as Parameters<typeof question>[0])),
    ).toEqual([
      '这段话是谁说的',
      '材料里提到的这位是谁',
      '截图里要整理哪几行',
      '「课题甲」是哪个课题',
      '这件事属于哪个课题',
      '面试官「Kevin」是谁',
      '面试官是谁',
      '候选人「候选人甲」是谁',
      '候选人是谁',
    ]);
  });

  it('answer every resolution, without naming someone the viewer cannot see', () => {
    const lookup = { ...sampleLookup, person: () => null, project: () => null };
    const answers = [
      { action: 'bind', personId: 'x' },
      { action: 'bind_people', personIds: ['x'] },
      { action: 'link_existing_interviewer', personId: 'x' },
      { action: 'link_existing_candidate', personId: 'x' },
      { action: 'link_existing_project', projectId: 'x' },
      { action: 'mark_irrelevant' },
      { action: 'keep_original_only' },
      {
        action: 'confirm_scope',
        region: { left: 0, top: 0, right: 1, bottom: 1 },
      },
      { action: 'keep_attachment_only' },
      { action: 'mark_no_project' },
    ].map((resolution) =>
      answer({ resolution } as unknown as MaterialReviewResolvedItem, lookup),
    );
    expect(answers).toEqual([
      '已核对',
      '已核对',
      '已核对',
      '已核对',
      '已核对',
      '与这次评价无关',
      '名单外的人',
      '整理范围内的部分',
      '只作附件',
      '明确无课题',
    ]);
    expect(
      answer(
        {
          resolution: {
            action: 'bind_people',
            personIds: ['demo-p1', 'demo-p2'],
          },
        } as unknown as MaterialReviewResolvedItem,
        sampleLookup,
      ),
    ).toBe('演示学员甲、演示学员乙');
    expect(
      answer(
        {
          resolution: {
            action: 'link_existing_project',
            projectId: 'demo-project',
          },
        } as unknown as MaterialReviewResolvedItem,
        sampleLookup,
      ),
    ).toBe('演示课题甲');
  });
});
