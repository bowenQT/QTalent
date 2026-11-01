import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/Badge';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// The tab title never carries batch content, so a refused read leaks nothing there.
export const metadata = { title: '回执 · Niu-Talent' };

/**
 * 回执页：一次投递读到了什么（BOW-861，原型 receipt.html）。批次读取（BOW-873 与
 * 897 的批次用例）接通前，页面只说明待接入，不画计数、文件和事件；系统管理员看不到
 * 业务内容。接通后服务端按当前登录人授权读取 `materialBatchReadResultSchema`，
 * 再用 `receiptView` 解好姓名交给 `Receipt`。
 */
export default async function ReceiptPage({ searchParams }: Props) {
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
  const { batch } = await searchParams;
  if (typeof batch !== 'string' || !batch.trim()) notFound();
  return (
    <>
      <ShellTitle title="回执" />
      <header className="nt-head">
        <div>
          <h1>回执</h1>
        </div>
      </header>
      <div className="n-card">
        <p className="nt-row" style={{ margin: 0, gap: 'var(--s-2)' }}>
          <Badge tone="prep">待接入</Badge>
          批次读取接通后，这里显示这次投递读到了什么：文件、涉及的人、整理出的事和待核对。
        </p>
      </div>
    </>
  );
}
