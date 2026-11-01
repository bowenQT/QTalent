import { notFound } from 'next/navigation';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { SourceViewer } from '@/features/sources/SourceViewer';
import { sourceReadInputFrom } from '@/features/sources/source-href';
import { fromSource } from '@/features/sources/viewer-model';
import { getShellPage } from '@/server/queries/shell';
import { readSourceForCurrentUser } from '@/server/queries/sources';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// 标签页标题不带原件名：读取在页面里只做一次，被拒时也不会从标题里漏出来。
export const metadata = { title: '原件 · Niu-Talent' };

/**
 * 原件查看页：地址只带片段与原件版本，服务端按当前登录人授权后读取，并记审计。
 * 读取被拒时只渲染状态页，来源内容不进入页面。原件全文（BOW-873 的授权读取）接入前，
 * 查看器显示提取出的原文和「原件待接入」。
 */
export default async function SourcesPage({ searchParams }: Props) {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const input = sourceReadInputFrom(await searchParams);
  if (!input) notFound();
  const result = await readSourceForCurrentUser(input);
  switch (result.status) {
    case 'success': {
      const source = fromSource(result.source);
      return (
        <>
          <ShellTitle title={source.title ?? '原件'} />
          <SourceViewer
            source={source}
            original={{ status: 'not_connected' }}
          />
        </>
      );
    }
    case 'forbidden':
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
    case 'conflict':
      return (
        <State title="原件版本已更新" text="返回上一页，刷新后重新进入。" />
      );
    case 'not_found':
    case 'validation_error':
      notFound();
  }
}
