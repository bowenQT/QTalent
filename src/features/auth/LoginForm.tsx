'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { authRequest } from './auth-request';
export function LoginForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const ok = await authRequest('sign-in/email', {
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      });
      if (ok) {
        router.replace('/projects');
        router.refresh();
      } else setError('邮箱或密码有误，请核对后重试。');
    } catch {
      setError('连接中断，请重试。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <form className="nt-grid" onSubmit={submit} aria-busy={busy}>
      <label className="n-field">
        <span className="n-field__label">邮箱</span>
        <input
          className="n-input"
          name="email"
          type="email"
          required
          autoComplete="username"
          disabled={busy}
        />
      </label>
      <label className="n-field">
        <span className="n-field__label">密码</span>
        <input
          className="n-input"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          disabled={busy}
        />
      </label>
      {error ? (
        <p role="alert" className="nt-field-error">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="n-btn--ink" disabled={busy}>
        {busy ? '登录中' : '登录'}
      </Button>
    </form>
  );
}
