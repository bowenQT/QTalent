import type { IconName } from '@/components/ui/Icon';
import type {
  ConclusionItem,
  ReassignSummary,
  TodosView,
  VerifyItem,
} from '../../view';

export type TodoRow = {
  key: string;
  badge: string;
  badgeClass?: string;
  icon?: IconName;
  title: string;
  sub: string;
  due: string;
  href: string;
};

export type TodoGroup = {
  key: keyof TodosView;
  label: string;
  rows: TodoRow[];
};

export const reassignHref = '/work/reassign';

// Row wording follows prototype/y/app/js/store.js and intake.js (todos).
const verifyRow = (item: VerifyItem): TodoRow => ({
  key: item.id,
  badge: '待核对',
  badgeClass: 'n-badge--ai',
  icon: 'spark',
  title: item.question,
  sub: `${item.source} · ${item.location}${item.deferred ? ' · 已选稍后处理' : ''}`,
  due: item.deferred ? '稍后' : '今天',
  href: item.href,
});

const conclusionRow = (item: ConclusionItem): TodoRow => ({
  key: item.id,
  badge: '节点结论',
  badgeClass: 'n-badge--seal',
  title: `${item.nodeName} · ${item.personName}的结论待你确认`,
  sub: item.waitingJudges.length
    ? `等${item.waitingJudges.join('、')}确认本人评分`
    : '评委都已确认本人评分',
  due: '本人确认',
  href: item.href,
});

/** One row for all handover work, as in the prototype; the page lists the items. */
function reassignRows({ items, evaluators }: ReassignSummary): TodoRow[] {
  if (!items) return [];
  const who =
    evaluators.length === 1
      ? (evaluators[0] ?? '原评价人')
      : `${evaluators.length} 位评价人`;
  return [
    {
      key: 'reassign',
      badge: '待重新分派',
      title: `${who}的评价关系已结束：${items} 件事待接手`,
      sub: '选接手人',
      due: '',
      href: reassignHref,
    },
  ];
}

/**
 * Groups in prototype order (workbench.js GROUPS), only the connected ones with rows.
 * `complete` is false while any group is not connected: the total is then unknown.
 */
export function todoGroups(todos: TodosView): {
  groups: TodoGroup[];
  complete: boolean;
} {
  const groups: TodoGroup[] = [];
  if (todos.verify.status === 'ready')
    groups.push({
      key: 'verify',
      label: '待核对',
      rows: todos.verify.data.map(verifyRow),
    });
  if (todos.conclusion.status === 'ready')
    groups.push({
      key: 'conclusion',
      label: '节点结论',
      rows: todos.conclusion.data.map(conclusionRow),
    });
  if (todos.reassign.status === 'ready')
    groups.push({
      key: 'reassign',
      label: '待重新分派',
      rows: reassignRows(todos.reassign.data),
    });
  const complete = Object.values(todos).every(
    (group) => group.status === 'ready',
  );
  return { groups: groups.filter((group) => group.rows.length), complete };
}

/** Whether the card has anything to say: rows, or a known "all done". */
export function showsTodos(todos: TodosView | undefined): boolean {
  if (!todos) return false;
  const { groups, complete } = todoGroups(todos);
  return groups.length > 0 || complete;
}
