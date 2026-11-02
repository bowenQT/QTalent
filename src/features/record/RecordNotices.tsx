'use client';
import { Icon } from '@/components/ui/Icon';
import { copy } from './copy';
import type { HandoffReason } from './batch-route';
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
    case 'saveUnavailable':
      return (
        <Notice
          actions={
            <>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={onRetry}
              >
                {copy.banner.sendRetry}
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
          {copy.saveUnavailable}
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
    case 'node': {
      const text =
        banner.reason === 'pending' || banner.reason === 'unavailable'
          ? copy.node[banner.reason]
          : banner.picked
            ? copy.node[banner.reason]
            : copy.node.pickPerson;
      return (
        <Notice>
          <b>{text.title}</b>
          <div className="nt-muted">{text.text}</div>
        </Notice>
      );
    }
  }
}

/** 整理结果交给回执页：一句话说为什么，链接到这个批次的回执。 */
export function HandoffPanel({
  reason,
  href,
  onEdit,
  onCopyOut,
}: {
  reason: HandoffReason;
  href: string;
  onEdit: () => void;
  /** 只在原话还在本页时给（刷新后会话暂存没了就没有原话可复制）。 */
  onCopyOut: (() => void) | null;
}) {
  const text = copy.handoff[reason];
  return (
    <Notice
      actions={
        <>
          <a className="n-btn n-btn--sm n-btn--ink" href={href}>
            {copy.handoff.open}
          </a>
          {/* 已确认的事再改原话会重复记一次，只给查看 */}
          {reason !== 'confirmed' ? (
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost"
              onClick={onEdit}
            >
              {copy.actions.back}
            </button>
          ) : null}
          {onCopyOut ? (
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost"
              onClick={onCopyOut}
            >
              {copy.actions.copyOut}
            </button>
          ) : null}
        </>
      }
    >
      <b>{text.title}</b>
      <div className="nt-muted">{text.text}</div>
      <div className="nt-muted">{copy.handoff.pending}</div>
    </Notice>
  );
}

/** 整理失败：写发生了什么和怎么办，不展示任何整理结果，也不把失败写成资料不足。 */
export function FailurePanel({
  failure,
  canReorganize,
  onReorganize,
  onEdit,
}: {
  failure: FailureKind;
  /** 回执说可以重试、原话也还在时，才给「重新整理」（新的 operation_id）。 */
  canReorganize: boolean;
  onReorganize: () => void;
  onEdit: () => void;
}) {
  const view = failureView(failure, canReorganize);
  return (
    <Notice
      actions={
        <>
          {view.reorganize ? (
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ink"
              onClick={onReorganize}
            >
              {copy.actions.reorganize}
            </button>
          ) : null}
          <button
            type="button"
            className="n-btn n-btn--sm n-btn--ghost"
            onClick={onEdit}
          >
            {copy.actions.back}
          </button>
        </>
      }
    >
      {view.message}
    </Notice>
  );
}
