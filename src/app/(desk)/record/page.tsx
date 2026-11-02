import Link from 'next/link';
import { State } from '@/components/ui/State';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getRecordPageData } from '@/server/queries/record-page';
import { getShellPage } from '@/server/queries/shell';
import { LiveRecord } from './LiveRecord';

export async function generateMetadata() {
  const shell = await getShellPage();
  return {
    title: `${!shell ? '查看权限已更新' : shell.isAdmin ? '这一页属于业务视角' : '记一件事'} · Niu-Talent`,
  };
}

type Params = { person?: string; draft?: string; batch?: string };

const toWork = (
  <Link className="n-btn n-btn--sm" href="/">
    回到工作台
  </Link>
);

/**
 * The record route (`/record`, with `?person=`, `?draft=work`, `?batch=`). Whom the
 * account may record is BOW-845's page read on the server; the page never decides
 * by role. Writing goes into a BOW-897 material batch; one arranged event is confirmed
 * here and saved through BOW-846, more than one goes to the receipt page.
 */
export default async function RecordRoute({
  searchParams,
}: {
  searchParams?: Promise<Params>;
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
  const data = await getRecordPageData();
  if (data.status !== 'ok')
    return (
      <>
        <ShellTitle title="记一件事" />
        {data.status === 'forbidden' ? (
          <State
            title="加入评价节点后，就能在这里记一件事"
            text="评价节点由 HR 在人才项目里安排；现在可以先回工作台。"
          >
            {toWork}
          </State>
        ) : (
          <State title="记一件事暂时打不开" text="刷新页面再试。">
            {toWork}
          </State>
        )}
      </>
    );
  const params = (await searchParams) ?? {};
  return (
    <>
      <ShellTitle title="记一件事" />
      <LiveRecord
        key={shell.account.id}
        accountId={shell.account.id}
        accountName={shell.account.name}
        roleLabel={shell.account.roleLabel}
        people={data.people}
        projects={data.projects.map((project) => ({
          ...project,
          kind: 'project' as const,
        }))}
        dimensions={data.dimensions}
        entry={{
          personId: params.person ?? null,
          handoff: params.draft === 'work',
          batchId: params.batch,
        }}
      />
    </>
  );
}
