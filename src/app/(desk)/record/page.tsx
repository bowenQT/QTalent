import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '记一件事'} · Niu-Talent`,
  };
}

/**
 * The record route (`/record`, with `?person=`, `?draft=work`, `?draftId=`, `?job=`).
 * Managers, HR and mentors record (spec 2026-10-26); whom each may record is the page
 * read's answer, on the server. That read and the arranging actions (BOW-845 #185) and
 * save and undo (BOW-846 #289) are not on main, so the page shows recording as not
 * connected and reads nothing; the page itself runs on the development sample
 * /dev/record. Once they land, this page binds them to `RecordPage` and nothing else.
 */
export default async function RecordRoute() {
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
      <ShellTitle title="记一件事" />
      <State
        title="记一件事待接通"
        text="接通后，在这里写原话，整理成关键事件，确认或改分后保存，5 秒内可以撤销。"
      >
        <Link className="n-btn n-btn--sm" href="/">
          回到工作台
        </Link>
      </State>
    </>
  );
}
