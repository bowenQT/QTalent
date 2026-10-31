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
      record: false,
      findPeople: true,
    });
    expect(toWorkbenchView(hr, options).entries).toEqual({
      record: false,
      findPeople: false,
    });
    expect(
      toWorkbenchView({ ...hr, entries: ['record', 'find_people'] }, options)
        .entries,
    ).toEqual({ record: true, findPeople: true });
  });

  it('never lets a mentor find people', () => {
    const forged = {
      ...mentor,
      entries: ['record', 'find_people'],
    } as Workbench;
    expect(toWorkbenchView(forged, options).entries.findPeople).toBe(false);
  });

  it('passes the greeting and account, and leaves unknown values unknown', () => {
    const view = toWorkbenchView(manager, options);
    expect(view).toMatchObject({
      role: 'manager',
      displayName: '演示管理者',
      asOf: null,
      accountId: 'test-account',
      namedExamples: false,
    });
    expect(view.trainees).toBeUndefined();
  });

  it('projects trainees to the row fields only, activity unknown, never 0', () => {
    const view = toWorkbenchView(mentor, options);
    expect(view.trainees).toEqual({
      status: 'ready',
      data: [
        {
          id: 'test-person-001',
          name: '演示测试甲',
          hue: null,
          photo: null,
          topic: null,
          activity: { status: 'unknown' },
        },
      ],
    });
    // Summary, capability and project details never reach the view.
    expect(JSON.stringify(view)).not.toMatch(/合成|anchor|summary|capability/);
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
