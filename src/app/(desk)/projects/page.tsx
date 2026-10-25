import { AccessDenied } from '@/features/shell/AccessDenied';
import { getProjectsPage } from '@/server/queries/projects';
import { getShellPage } from '@/server/queries/shell';
import { Projects } from '@/features/projects/Projects';
import { State } from '@/components/ui/State';
export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '项目与课题'} · Niu-Talent`,
  };
}
export default async function ProjectsPage() {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const result = await getProjectsPage();
  if (result.status === 'forbidden')
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
  return <Projects data={result.data} mentor={shell.role === 'mentor'} />;
}
