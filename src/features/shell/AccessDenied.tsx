'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { State } from '@/components/ui/State';
import { Button } from '@/components/ui/Button';
import { authRequest } from '@/features/auth/auth-request';

/** No business shell or account data is needed to leave an expired authorization. */
export function AccessDenied() {
  const router = useRouter();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function signOut() {
    if (pending.current) return;
    pending.current = true;
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
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <State
      title="查看权限已更新"
      text="请联系系统管理员确认查看范围，或切换账号。"
    >
      <Button onClick={() => void signOut()} disabled={busy}>
        {busy ? '正在退出' : '退出并切换账号'}
      </Button>
      {error ? <span role="alert">{error}</span> : null}
    </State>
  );
}
