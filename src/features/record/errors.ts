import type {
  JobErrorCode,
  JobFailureStatus,
  JobSnapshot,
} from '@/contracts/jobs';
import type { RecordSaveInput } from '@/contracts/record';
import { copy } from './copy';
import { scoreKey, type ScoreKey } from './types';

export type FailureKind = JobErrorCode | 'cancelled';

/** 失败面板：写发生了什么，并只给当前真正可走的出口。 */
export function failureView(kind: FailureKind) {
  switch (kind) {
    case 'processing_failed':
    case 'dependency_unavailable':
      return { message: copy.failure[kind], reorganize: true, edit: true };
    case 'input_changed':
      return { message: copy.failure[kind], reorganize: true, edit: false };
    case 'cancelled':
      return { message: copy.failure[kind], reorganize: false, edit: true };
  }
}

export function failureKindOf(
  snapshot: Pick<JobSnapshot, 'status' | 'error'>,
): FailureKind {
  if (snapshot.status === 'cancelled') return 'cancelled';
  return snapshot.error?.code ?? 'processing_failed';
}

/** 任务命令（重试）的失败只有状态，没有消息和输入，按状态给通用说法。 */
export function commandFailureMessage(status: JobFailureStatus): string {
  return status === 'conflict'
    ? copy.failure.commandConflict
    : copy.failure.commandFailed;
}

export type SaveProblems = {
  title?: string;
  behavior?: string;
  /** 情境或影响等其他 SBI 字段 */
  sbi?: string;
  scores: Record<ScoreKey, string>;
  /** 无法定位到具体字段的问题 */
  general: boolean;
};

/** 把 validation_error 的 fieldErrors 定位到标题、行为和具体分数行；保留全部输入。 */
export function saveProblems(
  fieldErrors: Record<string, string[]>,
  decisions: RecordSaveInput['decisions'],
): SaveProblems {
  const out: SaveProblems = { scores: {}, general: false };
  for (const path of Object.keys(fieldErrors)) {
    const parts = path.split('.');
    if (parts[0] === 'sbi' && parts[1] === 'title')
      out.title = copy.sbi.titleNeeded;
    else if (parts[0] === 'sbi' && parts[1] === 'behavior')
      out.behavior = copy.sbi.behaviorNeeded;
    else if (parts[0] === 'sbi') out.sbi = copy.sbi.fieldProblem;
    else if (parts[0] === 'decisions') {
      const decision = decisions[Number(parts[1])];
      if (decision)
        out.scores[scoreKey(decision.personId, decision.dimensionId)] =
          copy.sbi.fieldProblem;
      else out.general = true;
    } else out.general = true;
  }
  return out;
}
