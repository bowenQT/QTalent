import type { TraineeView } from '../../view';

/** `2026-08-28` → `08-28` (prototype NT.md). */
const monthDay = (date: string) => date.slice(5);

/**
 * Second line of a trainee row: topic, then this week's own records. "本周待记" only
 * when the count is known to be 0; an unknown count shows the topic alone.
 */
export function traineeLine({ topic, activity }: TraineeView): string | null {
  const parts = topic ? [topic] : [];
  if (activity.status === 'ready') {
    const { recordedThisWeek, lastRecordedOn } = activity.data;
    const week = recordedThisWeek
      ? `本周记了 ${recordedThisWeek} 件`
      : '本周待记';
    parts.push(
      lastRecordedOn ? `${week} · 最近 ${monthDay(lastRecordedOn)}` : week,
    );
  }
  return parts.length ? parts.join(' · ') : null;
}
