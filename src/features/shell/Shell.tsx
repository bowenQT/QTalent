import type { ReactNode } from 'react';
import type { ShellData } from '@/contracts/shell';
import { Niu } from '@/components/brand/Niu';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { ToastProvider } from '@/components/ui/Toast';
import { AccountMenu } from './AccountMenu';
import { ShellCrumbs } from './ShellCrumbs';
import { ShellNav } from './ShellNav';
import { ShellTitleProvider } from './ShellTitle';
import { ShellViewport } from './ShellViewport';
import { CommandMenu } from './CommandMenu';
export function Shell({
  data,
  children,
}: {
  data: ShellData;
  children: ReactNode;
}) {
  return (
    <ToastProvider>
      <ShellTitleProvider>
        <div id="app">
          <ShellViewport
            endNavId={data.role === 'mentor' ? 'projects' : undefined}
          />
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
            <ShellNav navigation={data.navigation} isAdmin={data.isAdmin} />
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
              <ShellCrumbs
                navigation={data.navigation}
                isAdmin={data.isAdmin}
              />
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
                当前视角：<b>{data.account.name}</b>（{data.account.roleLabel}）
                · {data.account.scopeLabel}
              </span>
              <span className="n-badge n-badge--demo">演示视角</span>
            </div>
            <main id="main" className="nt-body" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </ShellTitleProvider>
    </ToastProvider>
  );
}
