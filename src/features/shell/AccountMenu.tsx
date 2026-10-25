'use client';
import * as Menu from '@radix-ui/react-dropdown-menu';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ShellData } from '@/contracts/shell';
import { Avatar } from '@/components/ui/Avatar';
import { Icon } from '@/components/ui/Icon';
import { authRequest } from '@/features/auth/auth-request';
export function AccountMenu({ account }: { account: ShellData['account'] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (await authRequest('sign-out')) {
        router.replace('/login');
        router.refresh();
      } else setError('退出失败，请重试。');
    } catch {
      setError('连接中断，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="n-menuwrap">
      <Menu.Root>
        <Menu.Trigger asChild>
          <button
            className="n-rolepick"
            type="button"
            aria-label={`账号：${account.name}，${account.roleLabel}`}
            disabled={busy}
          >
            <Avatar name={account.name} hue={account.hue} />
            <small>当前账号</small>
            {account.roleLabel}
            <Icon name="chev" />
          </button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="n-menu" align="end" sideOffset={6}>
            <Menu.Label style={{ padding: '7px var(--s-3)' }}>
              {account.name}
              <small className="nt-muted" style={{ display: 'block' }}>
                {account.email}
              </small>
            </Menu.Label>
            <Menu.Separator />
            <Menu.Item asChild onSelect={() => void signOut()}>
              <button type="button" disabled={busy}>
                切换账号
              </button>
            </Menu.Item>
            <Menu.Item asChild onSelect={() => void signOut()}>
              <button type="button" disabled={busy}>
                退出登录
              </button>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {error ? (
        <span role="alert" className="nt-field-error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
