import { AccessDenied } from '@/features/shell/AccessDenied';
import { State } from '@/components/ui/State';
import { Reassign } from '@/features/workbench/reassign/Reassign';
import { readEvaluationReassignmentsForCurrentUser } from '@/server/queries/evaluation-reassignments';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '重新分派'} · Niu-Talent`,
  };
}

export default async function ReassignPage() {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const result = await readEvaluationReassignmentsForCurrentUser();
  if (result.status === 'forbidden')
    return (
      <State kind="denied" title="重新分派由 HR 处理">
        <a className="n-btn n-btn--sm" href="/work">
          回到工作台
        </a>
      </State>
    );
  return <Reassign items={result.items} />;
}
