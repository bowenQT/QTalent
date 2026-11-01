import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

type Shell = NonNullable<Awaited<ReturnType<typeof getShellPage>>>;

/** Interview imports are HR's (prototype Y import.html `allow`). */
const imports = (shell: Shell) =>
  !shell.isAdmin && shell.account.roles.includes('hr');

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : imports(shell) ? '面评导入' : '面评导入由 HR 处理'} · Niu-Talent`,
  };
}

const toWork = (
  <Link className="n-btn n-btn--sm" href="/">
    回到工作台
  </Link>
);

/**
 * The interview import preview route (`/import?id=…`). Viewers other than HR stop here,
 * on the server, before anything about the import is read. The preview read and the row
 * changes behind it (BOW-906) are not on main, so HR sees the preview as not connected;
 * the page itself runs on the development sample /dev/import.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams?: Promise<{ id?: string }>;
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
  if (!imports(shell))
    return (
      <State title="面评导入由 HR 处理" text="回到工作台，继续处理你的事。">
        {toWork}
      </State>
    );
  const { id } = (await searchParams) ?? {};
  return (
    <>
      <ShellTitle title="面评导入" />
      {id ? (
        <State
          title="面评预览待接通"
          text="接通后，这份面评按候选人逐行列在这里，逐行确认是谁以后导入。"
        >
          {toWork}
        </State>
      ) : (
        <State
          title="导入链接失效"
          text="可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。"
        >
          {toWork}
        </State>
      )}
    </>
  );
}
