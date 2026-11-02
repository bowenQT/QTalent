import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getInterviewImportPreview } from '@/server/queries/interview-import';
import { getShellPage } from '@/server/queries/shell';
import { LiveImport } from './LiveImport';

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
 * on the server, before anything about the import is read. HR sees the stored batch,
 * rows filtered by the current HR grant, and confirms who each row is (BOW-906).
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
  const read = id ? await getInterviewImportPreview(id) : null;
  if (read?.status === 'ok')
    return (
      <>
        <ShellTitle title="面评导入" />
        <LiveImport preview={read.preview} />
      </>
    );
  return (
    <>
      <ShellTitle title="面评导入" />
      {read?.status === 'forbidden' ? (
        <State
          title="查看权限已更新"
          text="这份面评已不在你的处理范围内。回到工作台，继续处理你的事。"
        >
          {toWork}
        </State>
      ) : read?.status === 'unavailable' ? (
        <State
          title="面评暂时打不开"
          text="读取没有成功，内容没有变化。稍后刷新再试。"
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
