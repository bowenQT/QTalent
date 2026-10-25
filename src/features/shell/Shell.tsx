import type { ReactNode } from 'react';
import type { ShellData, NavigationId } from '@/contracts/shell';
import { Niu } from '@/components/brand/Niu';
import { Avatar } from '@/components/ui/Avatar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { AccountMenu } from './AccountMenu';
import { ShellViewport } from './ShellViewport';
import { CommandMenu } from './CommandMenu';
const icons: Record<NavigationId, IconName> = {
  work: 'home',
  people: 'users',
  review: 'layers',
  queue: 'check2',
  programs: 'book',
  projects: 'folder',
  rules: 'grid',
  judge: 'swap',
  tags: 'tag',
  admin: 'lock',
};
export function Shell({
  data,
  children,
}: {
  data: ShellData;
  children: ReactNode;
}) {
  const groups = [
    ...new Set(
      data.navigation
        .map((item) => item.group)
        .filter((group): group is string => group !== null),
    ),
  ];
  const title = data.isAdmin ? '这一页属于业务视角' : '项目与课题';
  const item = (entry: ShellData['navigation'][number]) => (
    <a
      className="n-navitem"
      key={entry.id}
      data-nav={entry.id}
      href={entry.href}
      aria-current={entry.id === 'projects' ? 'page' : undefined}
    >
      <Icon name={icons[entry.id]} />
      {entry.label}
    </a>
  );
  return (
    <div id="app">
      <ShellViewport />
      <a className="nt-skip" href="#main">
        跳到正文
      </a>
      <aside className="nt-side" aria-label="主导航">
        <a
          className="n-shell__brand nt-brand"
          href={data.isAdmin ? '/admin' : '/work'}
        >
          <Niu />
          <span>
            Niu-Talent<small>人才识别、追踪与盘点</small>
          </span>
        </a>
        <nav className="nt-nav">
          {data.navigation.filter((entry) => !entry.group).map(item)}
          {groups.map((group) => (
            <div
              className="nt-nav__grp"
              key={group}
              role="group"
              aria-label={group}
            >
              <span className="nt-nav__h" aria-hidden="true">
                {group}
              </span>
              {data.navigation
                .filter((entry) => entry.group === group)
                .map(item)}
            </div>
          ))}
        </nav>
        <div className="nt-side__foot">
          <a href="/review-guide">
            <Icon name="book" />
            评审导览
          </a>
          <a href="/m">
            <Icon name="phone" />
            手机版
          </a>
        </div>
      </aside>
      <div className="nt-main">
        <header className="nt-top">
          <nav className="nt-crumbs" aria-label="位置">
            <b>{title}</b>
          </nav>
          {data.canSearch ? (
            <CommandMenu
              navigation={data.navigation}
              compact={data.role === 'manager'}
            />
          ) : (
            <span style={{ marginLeft: 'auto' }} />
          )}
          <AccountMenu account={data.account} />
          <span className="n-menuwrap">
            <a
              className="n-btn n-btn--ghost n-btn--icon"
              href="/m"
              aria-label="打开手机版"
            >
              <Icon name="more" />
            </a>
          </span>
        </header>
        <div className="nt-who">
          <Avatar name={data.account.name} hue={data.account.hue} />
          <span>
            当前视角：<b>{data.account.name}</b>（{data.account.roleLabel}） ·{' '}
            {data.account.scopeLabel}
          </span>
          <span className="n-badge n-badge--demo">演示视角</span>
        </div>
        <main id="main" className="nt-body" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
