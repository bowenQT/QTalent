import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '回执'} · Niu-Talent`,
  };
}

/**
 * 回执页（`/receipt?id=…`），企业微信和 Claude Code 里的回执链接都回到这里确认。能不能看、
 * 看到哪些事由回执读取在服务端判断；读取（BOW-845 #185）、逐件保存与撤销（BOW-846 #289）、
 * 深链核验（BOW-903 #271）还不在 main，所以页面写「回执待接通」，不读取任何材料。
 * 页面本身跑在开发样张 /dev/receipt 上，接通后这里只把动作绑到 `ReceiptPage`。
 */
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
  return (
    <>
      <ShellTitle title="回执" />
      {typeof id === 'string' && id.trim() ? (
        <State
          title="回执待接通"
          text="接通后，在这里看这次交的材料读到了什么，一件一件确认或改分，5 秒内可以撤销。"
        >
          <Link className="n-btn n-btn--sm" href="/">
            回到工作台
          </Link>
        </State>
      ) : (
        <State
          title="回执链接失效"
          text="可能已删除，或链接有误。回到工作台，从「进行中的任务」重新进入。"
        >
          <Link className="n-btn n-btn--sm" href="/">
            回到工作台
          </Link>
        </State>
      )}
    </>
  );
}
