'use client';
import { Icon } from '@/components/ui/Icon';
import { Trail, type TrailStep } from '@/components/ui/Trail';
import { copy } from './copy';
import type { FailureKind } from './errors';
import type { Connection } from './record-flow';

const STEPS = copy.trail.steps.length;

/**
 * 轨迹只反映批次状态：897 回执只说处理中或已结束，不带分步进度，所以处理中停在第一步，
 * 不编造进度；结束后全部完成。失败时写明原话已保留。
 */
export function trailSteps(
  processing: boolean,
  failure: FailureKind | null,
  complete = false,
): TrailStep[] {
  const done = complete && !failure ? STEPS : 0;
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
        detail: processing ? copy.trail.queued : undefined,
      };
    }
    return { id, label, state: 'pending' };
  });
}

/** 整理轨迹，以及连接中断时的提示（内容保留，恢复后自动消失）。 */
export function OrganizeProgress({
  processing,
  failure,
  connection,
  complete = false,
}: {
  processing: boolean;
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
        steps={trailSteps(processing, failure, complete)}
      />
    </div>
  );
}
