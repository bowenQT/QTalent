'use client';
import { Icon } from '@/components/ui/Icon';
import { Trail, type TrailStep } from '@/components/ui/Trail';
import { copy } from './copy';
import type { FailureKind } from './errors';
import type { Connection } from './record-flow';
import type { RecordJob } from './types';

const STEPS = copy.trail.steps.length;

/** 任务进度 → 已完成几步。没有进度时为 0：不编造分步进度。 */
export function completedSteps(
  progress: { completed: number; total: number } | null,
): number {
  if (!progress || progress.total <= 0) return 0;
  return Math.min(
    STEPS,
    Math.max(0, Math.floor((progress.completed / progress.total) * STEPS)),
  );
}

/** 轨迹只反映任务快照：完成、进行中、待做、失败；失败时写明原话已保留。 */
export function trailSteps(
  job: Pick<RecordJob, 'status' | 'progress'> | null,
  failure: FailureKind | null,
  complete = false,
): TrailStep[] {
  const done = complete ? STEPS : completedSteps(job?.progress ?? null);
  return copy.trail.steps.map((label, index) => {
    const id = `step-${index + 1}`;
    if (index < done) return { id, label, state: 'done' };
    if (index === done) {
      if (failure)
        return { id, label, state: 'failed', detail: copy.trail.kept };
      return {
        id,
        label,
        state: 'active',
        detail:
          index === 0 && (!job || job.status === 'queued')
            ? copy.trail.queued
            : undefined,
      };
    }
    return { id, label, state: 'pending' };
  });
}

/** 整理轨迹，以及连接中断时的提示（内容保留，恢复后自动消失）。 */
export function OrganizeProgress({
  job,
  failure,
  connection,
  complete = false,
}: {
  job: RecordJob | null;
  failure: FailureKind | null;
  connection: Connection;
  complete?: boolean;
}) {
  return (
    <div style={{ margin: 'var(--s-3) 0' }}>
      {connection === 'error' ? (
        <div className="n-notice is-plain" role="status">
          <Icon name="info" />
          <div>{copy.connection.lost}</div>
        </div>
      ) : null}
      <Trail
        title={copy.trail.title}
        steps={trailSteps(job, failure, complete)}
      />
    </div>
  );
}
