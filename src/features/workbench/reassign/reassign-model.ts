import type { reassignEvaluationWorkAction } from '@/server/actions/evaluation-reassignment';
import type { readEvaluationReassignmentsForCurrentUser } from '@/server/queries/evaluation-reassignments';

type Read = Awaited<
  ReturnType<typeof readEvaluationReassignmentsForCurrentUser>
>;
export type ReassignItem = Extract<
  Read,
  { status: 'success' }
>['items'][number];
export type ReassignResult = Awaited<
  ReturnType<typeof reassignEvaluationWorkAction>
>;

const kindLabels: Record<ReassignItem['kind'], string> = {
  confirmation: '确认建议分',
  speaker: '核对说话人',
  unknown_person: '核对未知人员',
  image_scope: '核对图片范围',
  unknown_interviewer: '核对未知面试官',
  unknown_project: '核对课题',
  unknown_interview_candidate: '核对面评候选人',
};

const relationLabels: Record<
  ReassignItem['candidates'][number]['kind'],
  string
> = {
  evaluator: '评价人',
  mentor: '导师',
  assistant: '助教',
  interviewer: '面试官',
  judge: '评委',
};

/** What the handover item is, as its row says it. */
export function itemLabel(item: ReassignItem): string {
  return `${kindLabels[item.kind]}${item.state === 'processing' ? ' · 处理中' : ''}`;
}

export type ReassignGroup = {
  key: string;
  evaluator: { id: string; name: string };
  node: ReassignItem['node'];
  items: ReassignItem[];
};

/** Items per previous evaluator and node, in read order. */
export function groupItems(items: readonly ReassignItem[]): ReassignGroup[] {
  const groups = new Map<string, ReassignGroup>();
  for (const item of items) {
    const key = `${item.previousEvaluator.id}\u0000${item.node.id}`;
    const group = groups.get(key) ?? {
      key,
      evaluator: {
        id: item.previousEvaluator.id,
        name: item.previousEvaluator.displayName ?? '原评价人',
      },
      node: item.node,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export type Candidate = {
  evaluatorId: string;
  displayName: string;
  label: string;
  /** How many of the picked items this person can take over. */
  eligible: number;
};

/**
 * Who can take over the picked items: everyone the read offers for at least one of them.
 * Only someone eligible for all of them can be picked; the server re-checks each item.
 */
export function candidatesFor(picked: readonly ReassignItem[]): Candidate[] {
  const byEvaluator = new Map<
    string,
    { displayName: string; kinds: Set<string>; items: Set<string> }
  >();
  for (const item of picked)
    for (const candidate of item.candidates) {
      const entry = byEvaluator.get(candidate.evaluatorId) ?? {
        displayName: candidate.displayName,
        kinds: new Set<string>(),
        items: new Set<string>(),
      };
      entry.kinds.add(relationLabels[candidate.kind]);
      entry.items.add(item.workItemId);
      byEvaluator.set(candidate.evaluatorId, entry);
    }
  return [...byEvaluator].map(([evaluatorId, entry]) => ({
    evaluatorId,
    displayName: entry.displayName,
    label: [...entry.kinds].join('、'),
    eligible: entry.items.size,
  }));
}

/** The relation an item is handed over through, for the chosen person. */
export function targetRelation(
  item: ReassignItem,
  evaluatorId: string,
): string | null {
  return (
    item.candidates.find((candidate) => candidate.evaluatorId === evaluatorId)
      ?.relationId ?? null
  );
}

/** Why an item was not handed over, said to HR. */
export function changedReason(status: ReassignResult['status']): string {
  if (status === 'forbidden') return '已移出你的分派范围';
  if (status === 'not_found') return '这件事已移出列表';
  if (status === 'validation_error') return '提交内容待刷新';
  return '分派状态已更新';
}
