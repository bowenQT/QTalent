import { describe, expect, it } from 'vitest';
import type { TraineeView } from '../../view';
import { traineeLine } from './trainee-line';

const base: TraineeView = {
  id: 'p-1',
  name: '演示学员',
  hue: null,
  photo: null,
  topic: '口语搭子 · 一组',
  activity: { status: 'unknown' },
};
const ready = (recordedThisWeek: number, lastRecordedOn: string | null) =>
  ({
    status: 'ready',
    data: { recordedThisWeek, lastRecordedOn },
  }) as const;

describe('traineeLine', () => {
  it('shows "本周待记" only for a known 0, with the last record date', () => {
    expect(traineeLine({ ...base, activity: ready(0, '2026-08-28') })).toBe(
      '口语搭子 · 一组 · 本周待记 · 最近 08-28',
    );
    expect(traineeLine({ ...base, activity: ready(3, '2026-09-03') })).toBe(
      '口语搭子 · 一组 · 本周记了 3 件 · 最近 09-03',
    );
  });

  it('leaves out "最近" when nothing was ever recorded', () => {
    expect(traineeLine({ ...base, activity: ready(0, null) })).toBe(
      '口语搭子 · 一组 · 本周待记',
    );
  });

  it('shows the topic alone when activity is unknown', () => {
    expect(traineeLine(base)).toBe('口语搭子 · 一组');
  });

  it('handles a missing topic', () => {
    expect(
      traineeLine({ ...base, topic: null, activity: ready(1, null) }),
    ).toBe('本周记了 1 件');
    expect(traineeLine({ ...base, topic: null })).toBeNull();
  });
});
