'use client';
import { Icon } from '@/components/ui/Icon';
import { copy } from './copy';
import { failureView, type FailureKind } from './errors';
import type { Banner } from './record-flow';

/** 提示条：写发生了什么，输入都还在。操作按钮由调用方决定。 */
export function Notice({
  tone = 'plain',
  children,
  actions,
}: {
  tone?: 'plain' | 'deny';
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`n-notice ${tone === 'deny' ? 'is-deny' : 'is-plain'}`}
      role="alert"
      style={{ margin: 'var(--s-3) 0' }}
    >
      <Icon name="info" />
      <div>
        {children}
        {actions ? (
          <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 输入态、待确认态顶部的提示：断网、冲突、权限变化、校验问题。 */
export function BannerNotice({
  banner,
  onRetry,
  onLoadLatest,
  onCopyOut,
  onBack,
}: {
  banner: Banner | null;
  onRetry: () => void;
  onLoadLatest: () => void;
  onCopyOut: () => void;
  onBack: () => void;
}) {
  if (!banner) return null;
  switch (banner.kind) {
    case 'offline':
      return (
        <Notice
          actions={
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost"
              onClick={onRetry}
            >
              {copy.banner.sendRetry}
            </button>
          }
        >
          {banner.scope === 'save' ? copy.offline.save : copy.offline.start}
        </Notice>
      );
    case 'conflict':
      return (
        <Notice
          actions={
            <>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ink"
                onClick={onLoadLatest}
              >
                {copy.actions.loadLatest}
              </button>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={onCopyOut}
              >
                {copy.actions.copyOut}
              </button>
            </>
          }
        >
          <b>{copy.conflict.title}</b>
          <div className="nt-muted">{banner.message}</div>
        </Notice>
      );
    case 'forbidden':
      return (
        <Notice
          tone="deny"
          actions={
            <>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={onBack}
              >
                {copy.actions.back}
              </button>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={onCopyOut}
              >
                {copy.actions.copyInput}
              </button>
            </>
          }
        >
          <b>{copy.forbidden.title}</b>
          <div className="nt-muted">
            {banner.message} {copy.forbidden.text}
          </div>
        </Notice>
      );
    case 'refused':
      return <Notice>{banner.message}</Notice>;
    case 'saveProblems':
      return <Notice>{copy.banner.problems}</Notice>;
    case 'who':
      return null;
  }
}

/** 整理失败或取消：写发生了什么和怎么办，不展示任何整理结果，也不把失败写成资料不足。 */
export function FailurePanel({
  failure,
  canReorganize,
  busy,
  commandMessage,
  onReorganize,
  onEdit,
}: {
  failure: FailureKind;
  canReorganize: boolean;
  busy: boolean;
  commandMessage: string | null;
  onReorganize: () => void;
  onEdit: () => void;
}) {
  const view = failureView(failure);
  return (
    <Notice
      actions={
        <>
          {view.reorganize && canReorganize ? (
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ink"
              disabled={busy}
              onClick={onReorganize}
            >
              {copy.actions.reorganize}
            </button>
          ) : null}
          {view.edit || !canReorganize ? (
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost"
              onClick={onEdit}
            >
              {copy.actions.back}
            </button>
          ) : null}
        </>
      }
    >
      {view.message}
      {commandMessage ? <div className="nt-muted">{commandMessage}</div> : null}
    </Notice>
  );
}
