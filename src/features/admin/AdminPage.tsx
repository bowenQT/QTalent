'use client';
import { Badge } from '@/components/ui/Badge';
import { State } from '@/components/ui/State';
import { Tabs } from '@/components/ui/Tabs';
import type { AdminConnections } from '@/contracts/admin-connections';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { Connections, type RetryPort } from './Connections';
import type { AdminTab } from './tabs';
import './admin.css';

// The other four tabs belong to later cards; each says so instead of showing samples.
const later: Record<
  Exclude<AdminTab, 'conn'>,
  { label: string; title: string; text: string }
> = {
  acct: {
    label: '账号与权限',
    title: '账号与权限待接通',
    text: '接通后，这里列出账号、角色和范围；授权变更由系统管理员发起，管理者确认后生效。',
  },
  hr: {
    label: '北森同步',
    title: '北森同步待接通',
    text: '北森开放接口接入后，这里显示同步范围、最近同步和同步异常。',
  },
  intg: {
    label: '集成与设置',
    title: '集成与设置待接通',
    text: '接通后，这里列出外部服务的用途和状态。密钥只在服务端环境变量里配置。',
  },
  audit: {
    label: '审计日志',
    title: '审计日志待接通',
    text: '接通后，这里记录授权变更、查看档案与原件、导出与打印、配置变更。',
  },
};

/** 系统管理: configuration and technical records only, never profiles or originals. */
export function AdminPage({
  tab,
  connections,
  retry,
  demo = false,
}: {
  tab: AdminTab;
  connections: AdminConnections;
  retry: RetryPort | null;
  /** Development samples carry the prototype's 演示 badge. */
  demo?: boolean;
}) {
  const panel = (id: Exclude<AdminTab, 'conn'>) => ({
    id,
    label: later[id].label,
    content: <State title={later[id].title} text={later[id].text} />,
  });
  return (
    <>
      <ShellTitle title="系统管理" />
      <header className="nt-head nt-head--tabs">
        <div>
          <h1>系统管理 {demo ? <Badge tone="demo">演示</Badge> : null}</h1>
          <p>
            管账号与权限、北森同步、集成配置、接入状态和审计日志。系统管理员只看配置和技术记录。
          </p>
        </div>
      </header>
      <div className="nt-admin">
        <Tabs
          label="系统管理"
          defaultValue={tab}
          items={[
            panel('acct'),
            panel('hr'),
            panel('intg'),
            {
              id: 'conn',
              label: '接入状态',
              content: <Connections data={connections} retry={retry} />,
            },
            panel('audit'),
          ]}
        />
      </div>
    </>
  );
}
