import { describe, expect, it } from 'vitest';
import {
  batchState,
  confirmRow,
  fillItem,
  rowState,
  sendToReview,
  summarize,
  unreadItems,
  type ImportRow,
} from './model';

const unread = {
  status: 'unrecognized',
  reason: 'multiple_selections',
  page: 3,
  options: ['A', 'B', 'C', 'D'],
  marked: ['A', 'B'],
} as const;

const base: ImportRow = {
  rowId: 'r1',
  pages: { from: 1, to: 1 },
  observedName: '测试候选人',
  candidateStatus: 'hired',
  template: { name: '测试评价表', scale: 'A–D' },
  interviewedOn: '2026-05-08',
  match: {
    personId: 'p-1',
    name: '测试候选人',
    hue: 10,
    photo: null,
    org: '测试组',
    title: '测试方向',
    joinedOn: '2026-07-06',
  },
  interviewer: { status: 'matched', name: '测试面试官' },
  scale: [
    { item: '技术深度', selection: { status: 'recognized', value: 'B' } },
    {
      item: '管理能力',
      selection: {
        status: 'not_applicable',
        reason: 'non_management_position',
      },
    },
  ],
  result: '通过',
  comment: null,
  redacted: 0,
  duplicate: null,
  reviewItemId: null,
  confirmed: false,
  filled: {},
};
const withUnread: ImportRow = {
  ...base,
  scale: [...base.scale, { item: '系统设计', selection: unread }],
};

describe('rowState', () => {
  it('skips every application that did not end in a hire, even with a directory match', () => {
    for (const status of [
      'rejected',
      'offer_pending',
      'offer_declined',
    ] as const)
      expect(rowState({ ...base, candidateStatus: status })).toBe('skip');
  });

  it('marks an interview an earlier import already holds', () => {
    expect(rowState({ ...base, duplicate: { importedOn: '2026-08-20' } })).toBe(
      'dup',
    );
  });

  it('waits to identify a hire nobody in the directory matches, then shows it sent', () => {
    expect(rowState({ ...base, match: null })).toBe('unknown');
    expect(rowState({ ...base, match: null, reviewItemId: 'i-1' })).toBe(
      'sent',
    );
  });

  it('waits for the interviewer before a missing score, and for both before confirming', () => {
    const pending = {
      ...withUnread,
      interviewer: {
        status: 'pending',
        observedName: 'Kevin',
        reviewItemId: 'i-int',
      },
      confirmed: true,
    } as const;
    expect(rowState(pending)).toBe('verify');
    expect(rowState({ ...withUnread, confirmed: true })).toBe('unread');
    expect(
      rowState({ ...withUnread, filled: { 系统设计: 'A' }, confirmed: true }),
    ).toBe('confirmed');
    expect(rowState(base)).toBe('confirm');
  });

  it('lists only unread items HR has not filled in', () => {
    expect(unreadItems(withUnread).map((x) => x.item)).toEqual(['系统设计']);
    expect(unreadItems({ ...withUnread, filled: { 系统设计: 'B' } })).toEqual(
      [],
    );
  });
});

describe('summarize and batchState', () => {
  const rows: ImportRow[] = [
    base,
    { ...base, rowId: 'r2', confirmed: true },
    { ...withUnread, rowId: 'r3' },
    {
      ...base,
      rowId: 'r4',
      interviewer: {
        status: 'pending',
        observedName: 'Kevin',
        reviewItemId: 'i-int',
      },
    },
    { ...base, rowId: 'r5', match: null },
    { ...base, rowId: 'r6', match: null, reviewItemId: 'i-6' },
    { ...base, rowId: 'r7', candidateStatus: 'rejected' },
    { ...base, rowId: 'r8', duplicate: { importedOn: '2026-08-20' } },
  ];

  it('counts each state; sent rows stay importable and out of the waiting counts', () => {
    expect(summarize(rows)).toEqual({
      live: 6,
      confirm: 1,
      confirmed: 1,
      verify: 1,
      unread: 1,
      unknown: 1,
      skipped: 2,
    });
  });

  it('waits for row by row confirmation until every row is skipped', () => {
    expect(batchState(rows)).toEqual({ s: 'confirm', label: '待逐行确认' });
    expect(batchState(rows.slice(6))).toEqual({
      s: 'skipped',
      label: '全部跳过',
    });
  });
});

describe('row changes', () => {
  it('confirms a ready row and takes it back; other rows stay as they are', () => {
    const confirmed = confirmRow(base, true);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmRow(confirmed, true)).toBe(confirmed);
    expect(confirmRow(confirmed, false).confirmed).toBe(false);
    expect(confirmRow(base, false)).toBe(base);
    expect(confirmRow(withUnread, true)).toBe(withUnread);
    const skippedRow = { ...base, candidateStatus: 'rejected' } as const;
    expect(confirmRow(skippedRow, true)).toBe(skippedRow);
  });

  it('fills an unread item with one of its options; clearing it takes back the confirmation', () => {
    const filled = fillItem(withUnread, '系统设计', 'A');
    expect(filled.filled).toEqual({ 系统设计: 'A' });
    const confirmed = confirmRow(filled, true);
    const cleared = fillItem(confirmed, '系统设计', '');
    expect(cleared.filled).toEqual({});
    expect(cleared.confirmed).toBe(false);
    expect(fillItem(confirmed, '系统设计', 'B')).toMatchObject({
      filled: { 系统设计: 'B' },
      confirmed: true,
    });
  });

  it('refuses values outside the options, read items and skipped rows', () => {
    expect(fillItem(withUnread, '系统设计', 'E')).toBe(withUnread);
    expect(fillItem(withUnread, '技术深度', 'A')).toBe(withUnread);
    expect(fillItem(withUnread, '没有这一项', 'A')).toBe(withUnread);
    const dup = { ...withUnread, duplicate: { importedOn: '2026-08-20' } };
    expect(fillItem(dup, '系统设计', 'A')).toBe(dup);
  });

  it('sends only a row waiting to be identified, once', () => {
    const unknown = { ...base, match: null };
    const sent = sendToReview(unknown, 'i-1');
    expect(sent.reviewItemId).toBe('i-1');
    expect(sendToReview(sent, 'i-2')).toBe(sent);
    expect(sendToReview(base, 'i-3')).toBe(base);
  });
});
