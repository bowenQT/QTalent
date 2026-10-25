import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Progress } from './Progress';

export type TaskState =
  | 'uploading'
  | 'queued'
  | 'transcribing'
  | 'shaping'
  | 'partial'
  | 'done'
  | 'failed';

/** 七个状态的图标与固定文字。页面负责把业务阶段映射到这七个状态。 */
export const taskStates: Record<TaskState, { icon: IconName; label: string }> =
  {
    uploading: { icon: 'upload', label: '上传中' },
    queued: { icon: 'clock', label: '已提交，排队中' },
    transcribing: { icon: 'wave', label: '转写中' },
    shaping: { icon: 'spark', label: '整理中' },
    partial: { icon: 'split', label: '部分待核对' },
    done: { icon: 'check', label: '已完成' },
    failed: { icon: 'x', label: '整理失败' },
  };

export type TaskProgress = number | 'indeterminate' | 'none';

export type TaskRowProps = {
  state: TaskState;
  name: string;
  /** 状态文字后的说明，例如「182 MB 中的 113 MB · 上传时请保持页面打开」。 */
  note: ReactNode;
  /** 名称后的小标，例如「演示」。 */
  badge?: ReactNode;
  /**
   * 进度条。默认：上传中是确定进度（数字，0–100），转写中和整理中是不定进度，其余没有。
   * 传 `none` 不显示，传数字或 `indeterminate` 覆盖默认。
   */
  progress?: TaskProgress;
  /** 为真才显示「取消」；组件不判断任务处在哪个阶段。 */
  canCancel?: boolean;
  onCancel?: () => void;
  /** 为真才显示「重试整理」。 */
  canRetry?: boolean;
  onRetry?: () => void;
  /** 其他操作，例如「去核对」「查看」，由调用方给。 */
  actions?: ReactNode;
};

function barFor(state: TaskState, progress: TaskProgress | undefined) {
  if (progress !== undefined) return progress;
  if (state === 'uploading') return 0;
  return state === 'transcribing' || state === 'shaping'
    ? 'indeterminate'
    : 'none';
}

/** 长任务行。 */
export function TaskRow({
  state,
  name,
  note,
  badge,
  progress,
  canCancel = false,
  onCancel,
  canRetry = false,
  onRetry,
  actions,
}: TaskRowProps) {
  const { icon, label } = taskStates[state];
  const bar = barFor(state, progress);
  return (
    <div className="n-task" data-state={state}>
      <span className="n-task__icon">
        <Icon name={icon} />
      </span>
      <div>
        <div className="n-task__name">
          {name}
          {badge}
        </div>
        <div className="n-task__state">
          <b>{label}</b> · {note}
        </div>
        {bar === 'none' ? null : bar === 'indeterminate' ? (
          <Progress label={`${name} 处理进度`} />
        ) : (
          <Progress value={bar} label={`${name} 上传进度`} />
        )}
      </div>
      {canCancel || canRetry || actions ? (
        <div className="n-task__acts">
          {canCancel ? (
            <Button className="n-btn--sm n-btn--ghost" onClick={onCancel}>
              取消
            </Button>
          ) : null}
          {actions}
          {canRetry ? (
            <Button className="n-btn--sm" onClick={onRetry}>
              <Icon name="retry" />
              重试整理
            </Button>
          ) : null}
        </div>
      ) : (
        <div />
      )}
    </div>
  );
}
