import { State } from '@/components/ui/State';
import { AdminPage } from '@/features/admin/AdminPage';
import { adminTabOf } from '@/features/admin/tabs';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getAdminConnectionsPage } from '@/server/queries/admin';
import { getShellPage } from '@/server/queries/shell';

type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '系统管理' : '这一页只给系统管理员'} · Niu-Talent`,
  };
}

/**
 * /admin[?tab=acct|hr|intg|conn|audit]. Only 接入状态 is in this slice (BOW-916); it
 * opens by default, and the other tabs say 待接通. Retry stays off until the jobs
 * command is wired for entry tasks.
 */
export default async function AdminRoute({
  searchParams,
}: {
  searchParams: Search;
}) {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const result = await getAdminConnectionsPage();
  if (result.status === 'forbidden')
    return (
      <>
        <ShellTitle title="系统管理" />
        <State
          title="这一页只给系统管理员"
          text="系统管理包括账号与权限、北森同步、集成配置、接入状态和审计日志。需要查看时请联系系统管理员。"
        >
          <a className="n-btn n-btn--sm" href="/work">
            回到工作台
          </a>
        </State>
      </>
    );
  const { tab } = await searchParams;
  return (
    <AdminPage tab={adminTabOf(tab)} connections={result.data} retry={null} />
  );
}
