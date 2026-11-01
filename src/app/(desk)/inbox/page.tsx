import { State } from '@/components/ui/State';
import { notConnected, lede } from '@/features/inbox/copy';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '待核对'} · Niu-Talent`,
  };
}

/**
 * 待核对. The review items have no cross-batch read yet (BOW-860 / 905 / 906 are not
 * on main), so the page says so instead of showing sample items. Once a read exists,
 * it renders `features/inbox/Inbox` with live ports, as `/dev/inbox` does with
 * in-memory ones.
 */
export default async function InboxPage() {
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
  return (
    <>
      <ShellTitle title="待核对" />
      <header className="nt-head">
        <div>
          <h1>待核对</h1>
          <p>{lede}</p>
        </div>
      </header>
      <State {...notConnected.page} kind="empty" />
    </>
  );
}
