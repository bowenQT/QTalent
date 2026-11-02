import { describe, expect, it } from 'vitest';
import type { Workbench } from '@/contracts/workbench';
import { workbenchSchema } from '@/contracts/workbench';
import { fixtures } from '../../../tests/fixtures/p0-contracts';
import { toWorkbenchView } from './view';
import { suggestionsFor } from './copy';

const options = { accountId: 'test-account', namedExamples: false };
const [manager, hr, mentor] = fixtures.workbench;

describe('toWorkbenchView', () => {
  it('reads actions only from entries', () => {
    expect(toWorkbenchView(manager, options).entries).toEqual({
      record: true,
      findPeople: true,
    });
    expect(toWorkbenchView(hr, options).entries).toEqual({
      record: true,
      findPeople: true,
    });
    expect(toWorkbenchView({ ...hr, entries: [] }, options).entries).toEqual({
      record: false,
      findPeople: false,
    });
    expect(
      toWorkbenchView({ ...manager, entries: ['find_people'] }, options)
        .entries,
    ).toEqual({ record: false, findPeople: true });
  });

  it('never lets a mentor find people', () => {
    const forged = {
      ...mentor,
      entries: ['record', 'find_people'],
    } as Workbench;
    expect(toWorkbenchView(forged, options).entries.findPeople).toBe(false);
  });

  it('passes the greeting, business day and account; export is not connected', () => {
    const view = toWorkbenchView(manager, options);
    expect(view).toEqual({
      role: 'manager',
      displayName: '演示管理者',
      asOf: '2026-09-04',
      entries: { record: true, findPeople: true },
      accountId: 'test-account',
      namedExamples: false,
      exportable: { status: 'not_connected' },
    });
  });

  it('projects trainees to the row fields; unknown activity stays unknown', () => {
    const view = toWorkbenchView(mentor, options);
    expect(view.trainees).toEqual({
      status: 'ready',
      data: [
        {
          id: 'test-person-001',
          name: '演示测试甲',
          hue: 220,
          photo: null,
          topic: '演示课题',
          activity: {
            status: 'ready',
            data: { recordedThisWeek: 2, lastRecordedOn: '2026-09-03' },
          },
        },
        {
          id: 'test-person-201',
          name: '演示学员乙',
          hue: 40,
          photo: 'test-avatar-01',
          topic: null,
          activity: {
            status: 'ready',
            data: { recordedThisWeek: 0, lastRecordedOn: null },
          },
        },
        {
          id: 'test-person-202',
          name: '演示学员丙',
          hue: 300,
          photo: null,
          topic: '演示课题',
          activity: { status: 'unknown' },
        },
      ],
    });
    expect(view.todos).toBeUndefined();
    // The unknown reason is internal wording; the row shows the topic alone.
    expect(JSON.stringify(view)).not.toMatch(/reason|anchor|summary/);
  });

  it('gives HR the reassignment read and leaves the other to-do groups not connected', () => {
    const evaluator = (id: string, displayName: string | null) => ({
      previousEvaluator: { id, displayName },
    });
    const view = toWorkbenchView(hr, options, {
      reassignments: {
        status: 'success',
        items: [
          evaluator('e-1', '演示原评价人'),
          evaluator('e-2', null),
          evaluator('e-1', '演示原评价人'),
        ],
      },
    });
    expect(view.todos).toEqual({
      verify: { status: 'not_connected' },
      conclusion: { status: 'not_connected' },
      reassign: {
        status: 'ready',
        data: { items: 3, evaluators: ['演示原评价人', null] },
      },
    });
    for (const extras of [
      {},
      { reassignments: { status: 'forbidden' } },
    ] as const)
      expect(toWorkbenchView(hr, options, extras).todos?.reassign).toEqual({
        status: 'not_connected',
      });
    // Only HR reads reassignments, whatever is passed.
    expect(
      toWorkbenchView(manager, options, {
        reassignments: { status: 'success', items: [] },
      }).todos,
    ).toBeUndefined();
  });

  it('keeps empty, insufficient and unknown trainee blocks as they are', () => {
    for (const trainees of [
      { status: 'empty' as const },
      { status: 'insufficient_evidence' as const, reason: '缺记录' },
      { status: 'unknown' as const, reason: '读取未完成' },
    ]) {
      const data = workbenchSchema.parse({ ...mentor, trainees });
      expect(toWorkbenchView(data, options).trainees).toEqual(trainees);
    }
  });
});

describe('suggestionsFor', () => {
  it('drops examples naming demo people in production, keeps the manager ones', () => {
    expect(suggestionsFor('hr', false)).toEqual([]);
    expect(suggestionsFor('mentor', false)).toEqual([]);
    expect(suggestionsFor('manager', false)).toHaveLength(2);
    expect(suggestionsFor('hr', true)).toEqual([
      '谷嘉树这周把 CI 覆盖率补到了 80%，还写了一份排障手册',
    ]);
    expect(suggestionsFor('mentor', true)).toHaveLength(2);
  });
});
