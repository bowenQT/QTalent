import { State } from '@/components/ui/State';
import { People } from '@/features/people/People';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { listPeopleForCurrentUser } from '@/server/queries/people';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  const title = !shell
    ? '查看权限已更新'
    : shell.isAdmin
      ? '这一页属于业务视角'
      : shell.role === 'mentor'
        ? '所带学员'
        : '人才';
  return { title: `${title} · Niu-Talent` };
}

export default async function PeoplePage() {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  // Administrators have no talent role: answer before any name is read.
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
  const data = await listPeopleForCurrentUser();
  return <People data={data} mentor={shell.role === 'mentor'} />;
}
