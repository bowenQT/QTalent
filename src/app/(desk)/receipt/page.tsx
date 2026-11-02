import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { readReceiptForCurrentUser } from '@/server/queries/receipt-page';
import { getShellPage } from '@/server/queries/shell';
import { LiveReceipt } from './LiveReceipt';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '回执'} · Niu-Talent`,
  };
}

/**
 * 回执页（`/receipt?id=…`），企业微信和 Claude Code 里的回执链接都回到这里确认。能不能看、
 * 看到哪些事由 897 的批次读取在服务端判断（BOW-845）；这里只补标题、提交人、人名和每件事
 * 由谁确认。确认按 846 一件一件保存，5 秒内可以撤销。
 */
const toWork = (
  <Link className="n-btn n-btn--sm" href="/">
    回到工作台
  </Link>
);

export default async function ReceiptRoute({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
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
  const { id } = await searchParams;
  const batchId = typeof id === 'string' ? id.trim() : '';
  const read = batchId ? await readReceiptForCurrentUser({ batchId }) : null;
  return (
    <>
      <ShellTitle title="回执" />
      {read?.status === 'success' ? (
        <LiveReceipt
          batchId={batchId}
          initial={read.view}
          viewerName={read.viewerName}
        />
      ) : read?.status === 'unavailable' ? (
        <State
          title="回执读取中断"
          text="这次读取中断了，材料和已确认的事都还在。稍后刷新再看。"
        >
          {toWork}
        </State>
      ) : read?.status === 'forbidden' ? (
        <State
          title="查看权限已更新"
          text="查看范围可能调整过了。回到工作台，从「进行中的任务」进入。"
        >
          {toWork}
        </State>
      ) : (
        <State
          title="回执链接失效"
          text="可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。"
        >
          {toWork}
        </State>
      )}
    </>
  );
}
