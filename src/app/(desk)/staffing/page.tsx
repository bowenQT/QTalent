import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

type Shell = NonNullable<Awaited<ReturnType<typeof getShellPage>>>;

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

/**
 * The find-people route. Viewers outside management and HR are stopped here, on the
 * server, before any project or person is read. The live document
 * (src/features/staffing) connects once the demand read (BOW-852) and matching read
 * (BOW-854) are on main; until then the page says so instead of showing sample data.
 */
export default async function StaffingPage() {
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
  return (
    <>
      <ShellTitle title="找人" />
      <State
        title="找人待接通"
        text="需求卡和候选人核对接通后，会在这里按项目出现。现在可以先在项目与课题里查看项目。"
      >
        <div className="nt-row" style={{ justifyContent: 'center' }}>
          <a className="n-btn n-btn--sm" href="/projects">
            打开项目与课题
          </a>
        </div>
      </State>
    </>
  );
}
