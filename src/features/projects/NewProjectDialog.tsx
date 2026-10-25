'use client';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { PersonOption } from '@/contracts/projects';
import { createProjectAction } from '@/server/actions/projects';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { submissionFromForm } from './project-state';
export function NewProjectDialog({
  people,
  onClose,
  onCreated,
}: {
  people: PersonOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const requestId = useRef<string | null>(null);
  const submitting = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    requestId.current ??= crypto.randomUUID();
    const input = submissionFromForm(new FormData(form), requestId.current);
    if (!input.name) {
      setFieldErrors({ name: ['请先填写「项目名称」'] });
      form.querySelector<HTMLInputElement>('[name="name"]')?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const result = await createProjectAction(input);
      if (result.status === 'success') {
        onCreated();
        router.refresh();
        onClose();
      } else if (result.status === 'validation_error') {
        setFieldErrors(result.fieldErrors);
        const first = Object.keys(result.fieldErrors)[0];
        // Wait for React to re-enable controls after the submission settles.
        requestAnimationFrame(() => {
          const element = first ? form.elements.namedItem(first) : null;
          if (element instanceof HTMLElement) element.focus();
        });
      } else {
        setError(
          result.status === 'forbidden'
            ? '查看范围已更新，请刷新页面后重试。'
            : result.status === 'conflict'
              ? '内容已更新，请刷新页面后重试。'
              : '人员资料已更新，请重新选择。',
        );
      }
    } catch {
      // Preserve both the form and request ID: an interrupted response may already have committed.
      setError('连接中断，请重试。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const fieldError = (name: string) =>
    fieldErrors[name]?.length ? (
      <span id={`error-${name}`} role="alert" className="nt-field-error">
        {fieldErrors[name]?.join('；')}
      </span>
    ) : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="新建项目"
      busy={busy}
    >
      <form ref={formRef} onSubmit={submit} noValidate aria-busy={busy}>
        <div className="nt-dlg-body">
          <div className="nt-grid" style={{ gap: 'var(--s-3)' }}>
            <label className={`n-field${fieldErrors.name ? ' is-error' : ''}`}>
              <span className="n-field__label">项目名称</span>
              <input
                className="n-input"
                name="name"
                placeholder="比如：控制台新手引导改版"
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'error-name' : undefined}
                disabled={busy}
              />
              {fieldError('name')}
            </label>
            <div className="nt-cols" style={{ gap: 'var(--s-3)' }}>
              <label className="n-field">
                <span className="n-field__label">类型</span>
                <select className="n-select" name="type" disabled={busy}>
                  {['业务项目', '专项', '黑客松', '训练营课题'].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                {fieldError('type')}
              </label>
              <label className="n-field">
                <span className="n-field__label">状态</span>
                <select
                  className="n-select"
                  name="status"
                  defaultValue="进行中"
                  disabled={busy}
                >
                  <option>筹备中</option>
                  <option>进行中</option>
                </select>
                {fieldError('status')}
              </label>
            </div>
            <label className="n-field">
              <span className="n-field__label">
                目标 <small>一句话</small>
              </span>
              <input
                className="n-input"
                name="goal"
                placeholder="比如：让新客户第一次登录就能找到要用的产品"
                disabled={busy}
              />
              {fieldError('goal')}
            </label>
            <label className="n-field">
              <span className="n-field__label">
                owner <small>可以先空着，之后发起找 owner</small>
              </span>
              <select className="n-select" name="ownerId" disabled={busy}>
                <option value="">待定</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.orgName}
                  </option>
                ))}
              </select>
              {fieldError('ownerId')}
            </label>
            <fieldset
              className="n-field"
              style={{ border: 0, padding: 0, margin: 0 }}
              disabled={busy}
            >
              <legend className="n-field__label" style={{ marginBottom: 6 }}>
                成员 <small>可以多选；已在别的项目里的人也能加</small>
              </legend>
              <div
                style={{
                  maxHeight: 180,
                  overflow: 'auto',
                  display: 'grid',
                  gap: 4,
                  padding: 'var(--s-2)',
                  borderRadius: 'var(--r-field)',
                  background: 'var(--sheet-sunk)',
                }}
              >
                {people.map((person) => (
                  <label className="n-check" key={person.id}>
                    <input type="checkbox" name="memberIds" value={person.id} />
                    {person.name}
                    <span className="nt-muted">
                      {person.orgName}
                      {person.currentProjectCount
                        ? ` · 在 ${person.currentProjectCount} 个项目`
                        : ''}
                    </span>
                  </label>
                ))}
              </div>
              {fieldError('memberIds')}
            </fieldset>
          </div>
        </div>
        {error ? (
          <p role="alert" className="n-dialog__hint">
            {error}
          </p>
        ) : null}
        <div className="n-dialog__bar">
          <Button className="n-btn--ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button type="submit" className="n-btn--ink" disabled={busy}>
            {busy ? '创建中' : '创建'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
