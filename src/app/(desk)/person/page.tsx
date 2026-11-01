import { notFound } from 'next/navigation';
import { State } from '@/components/ui/State';
import { Person } from '@/features/person/Person';
import { LivePersonPrint } from '@/features/person-print/LivePersonPrint';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { getShellPage } from '@/server/queries/shell';
import { loadPersonPage, personIdOf } from './person-page';
import { readSource } from './read-source';

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: Props) {
  const shell = await getShellPage();
  if (!shell) return { title: '查看权限已更新 · Niu-Talent' };
  const page = await loadPersonPage(
    personIdOf(await searchParams),
    shell.isAdmin,
  );
  const title =
    page.status === 'ok'
      ? page.data.person.name
      : page.status === 'forbidden'
        ? '这一页属于业务视角'
        : '人员链接失效';
  return { title: `${title} · Niu-Talent` };
}

export default async function PersonPage({ searchParams }: Props) {
  const shell = await getShellPage();
  if (!shell) return <AccessDenied />;
  const page = await loadPersonPage(
    personIdOf(await searchParams),
    shell.isAdmin,
  );
  if (page.status === 'forbidden')
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
  if (page.status === 'not_found') notFound();
  return (
    <>
      <ShellTitle title={page.data.person.name} />
      <Person
        data={page.data}
        loadSource={readSource}
        headActions={
          // 导师变体没有打印入口，页头保持原样；是不是归属 HR，由服务端在打印前复核时判断。
          page.data.role === 'mentor' ? undefined : (
            <LivePersonPrint
              personId={page.data.person.id}
              personName={page.data.person.name}
              canPrint
            />
          )
        }
      />
      {page.data.role === 'mentor' ? (
        // 没有入口也挂上打印稿：直接用浏览器打印时只印一句档案打印对谁开放。
        <LivePersonPrint
          personId={page.data.person.id}
          personName={page.data.person.name}
          canPrint={false}
        />
      ) : null}
    </>
  );
}
