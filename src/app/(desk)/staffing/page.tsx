import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { HandedSentence } from '@/features/staffing/HandedSentence';
import { LiveStaffing } from '@/features/staffing/LiveStaffing';
import type { ProjectHead } from '@/features/staffing/view';
import { getProjectsPage } from '@/server/queries/projects';
import { getShellPage } from '@/server/queries/shell';
import { readStaffingDemand } from '@/server/queries/staffing-demand';

type Shell = NonNullable<Awaited<ReturnType<typeof getShellPage>>>;
type Params = {
  project?: string;
  demand?: string;
  job?: string;
  draft?: string;
};

/** Find-people is for managers and HR (prototype Y denyText); data reads authorize again. */
function staffs(shell: Shell): boolean {
  return (
    !shell.isAdmin &&
    shell.account.roles.some((role) => role === 'manager' || role === 'hr')
  );
}

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : staffs(shell) ? '找人' : '这一页属于其他视角'} · Niu-Talent`,
  };
}

const toProjects = (
  <div className="nt-row" style={{ justifyContent: 'center' }}>
    <a className="n-btn n-btn--sm" href="/projects">
      打开项目与课题
    </a>
  </div>
);

/** Open projects the viewer may read, to take a workbench sentence into one of them. */
async function chooseProject(accountId: string) {
  const page = await getProjectsPage();
  if (page.status === 'forbidden') return <AccessDenied />;
  const open = page.data.projects.filter(
    (project) => project.status === '筹备中' || project.status === '进行中',
  );
  return (
    <>
      <ShellTitle title="找人" />
      <HandedSentence accountId={accountId} />
      {open.length ? (
        <div className="n-card">
          <ul className="nt-list" aria-label="可以找人的项目">
            {open.map((project) => (
              <li key={project.id} className="nt-row">
                <Link
                  className="nt-plink"
                  href={`/staffing?${new URLSearchParams({ project: project.id, draft: 'work' })}`}
                >
                  <b>{project.name}</b>
                </Link>
                {project.goal ? (
                  <span className="nt-muted">{project.goal}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <State
          title="先建一个项目"
          text="找人需求按项目保存。在项目与课题里新建项目，再从项目卡片点「发起找 owner」接着找人。"
        >
          <div className="nt-row" style={{ justifyContent: 'center' }}>
            <a
              className="n-btn n-btn--sm"
              href={`/projects?${new URLSearchParams({ draft: 'work' })}`}
            >
              打开项目与课题
            </a>
          </div>
        </State>
      )}
    </>
  );
}

/** A project the viewer may read, as the page header shows it; null otherwise. */
async function projectHead(id: string): Promise<ProjectHead | null> {
  const page = await getProjectsPage();
  if (page.status !== 'ok') return null;
  const found = page.data.projects.find((project) => project.id === id);
  return found
    ? { id: found.id, name: found.name, goal: found.goal, status: found.status }
    : null;
}

/**
 * The find-people route. Viewers outside management and HR are stopped here, on the
 * server, before any project or person is read. A demand belongs to a project: the
 * page opens on `project`, with either the demand (`demand`) or the drafting job of a
 * sentence just sent (`job`). The demand card runs on BOW-852; matching (BOW-854) is
 * not on main yet and shows as not connected.
 */
export default async function StaffingPage({
  searchParams,
}: {
  searchParams?: Promise<Params>;
} = {}) {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  if (shell.isAdmin)
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
  if (!staffs(shell))
    return (
      <State
        title="这一页属于其他视角"
        text="找 owner 和项目找人只对管理者和 HR 开放。"
      >
        <div className="nt-row" style={{ justifyContent: 'center' }}>
          <Link className="n-btn n-btn--sm" href="/">
            回到工作台
          </Link>
        </div>
      </State>
    );

  const params = (await searchParams) ?? {};
  // A sentence sent from the workbench waits in session storage until a project is
  // chosen: each choice keeps `draft=work`, so the demand page picks it up.
  if (!params.project && params.draft === 'work')
    return chooseProject(shell.account.id);
  if (!params.project)
    return (
      <>
        <ShellTitle title="找人" />
        <State
          title="选一个项目再找人"
          text="找人需求按项目保存。在项目与课题里新建项目，或从 owner 待定的项目卡片点「发起找 owner」进入。"
        >
          {toProjects}
        </State>
      </>
    );
  const project = await projectHead(params.project);
  if (!project)
    return (
      <>
        <ShellTitle title="找人" />
        <State
          title="项目链接失效"
          text="可能已删除，或链接有误。回到项目列表重新进入。"
        >
          {toProjects}
        </State>
      </>
    );
  const demand = params.demand ? await readStaffingDemand(params.demand) : null;
  if (params.demand && demand?.projectId !== project.id)
    return (
      <>
        <ShellTitle title="找人" />
        <State
          title="需求链接失效"
          text="可能已删除、链接有误，或在你的查看范围之外。从项目重新进入找人。"
        >
          {toProjects}
        </State>
      </>
    );
  return (
    // Keyed by project and account: moving to another project from this page gives a
    // fresh page (ports, sentence, job) instead of carrying the previous one's state.
    <LiveStaffing
      key={`${project.id}:${shell.account.id}`}
      project={project}
      demand={demand}
      resumeJobId={demand ? null : (params.job ?? null)}
      accountId={shell.account.id}
      fromWorkbench={params.draft === 'work'}
    />
  );
}
