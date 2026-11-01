import { AccessDenied } from '@/features/shell/AccessDenied';
import { State } from '@/components/ui/State';
import { Workbench } from '@/features/workbench/Workbench';
import { toWorkbenchView } from '@/features/workbench/view';
import { readEvaluationReassignmentsForCurrentUser } from '@/server/queries/evaluation-reassignments';
import { getShellPage } from '@/server/queries/shell';
import {
  getWorkbenchForCurrentUser,
  WorkbenchNotConnectedError,
} from '@/server/queries/workbench';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '工作台'} · Niu-Talent`,
  };
}

/** Reads the page only after the shell has resolved the session; same as /projects. */
async function readWorkbench() {
  try {
    return await getWorkbenchForCurrentUser();
  } catch (error) {
    // A mixed HR and mentor account has no complete view yet (BOW-837): say so,
    // never show it an empty or a single-role workbench.
    if (error instanceof WorkbenchNotConnectedError) return null;
    throw error;
  }
}

export default async function WorkPage() {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const page = await readWorkbench();
  if (!page)
    return (
      <State
        title="工作台待开通"
        text="你同时是 HR 和导师，两种身份合在一起的工作台开通后会出现在这里。可以先从左侧导航打开其他页面。"
      />
    );
  if (page.status === 'forbidden')
    return (
      <State
        title="这一页属于业务视角"
        text="系统管理员负责账号与权限、北森同步、集成配置和审计日志。"
      >
        <a className="n-btn n-btn--sm" href="/admin">
          打开系统管理
        </a>
      </State>
    );
  const reassignments =
    page.data.role === 'hr'
      ? await readEvaluationReassignmentsForCurrentUser()
      : undefined;
  const view = toWorkbenchView(
    page.data,
    {
      accountId: shell.account.id,
      // getWorkbenchForCurrentUser has validated APP_ENV by now.
      namedExamples: process.env.APP_ENV !== 'production',
    },
    { reassignments },
  );
  return <Workbench view={view} />;
}
