import type { CSSProperties, ReactNode } from 'react';
import { Niu } from '@/components/brand/Niu';
import { Icon, type IconName } from './Icon';
/** 加载、空、失败、无权限分开说，不把未知写成 0。 */
export type StateKind = 'loading' | 'empty' | 'failed' | 'denied';
const niuState = {
  loading: 'searching',
  empty: 'listening',
  failed: 'error',
} as const;
export function State({
  title,
  text,
  kind,
  card = false,
  children,
}: {
  title: string;
  text?: string;
  /** 不传时沿用小犇「需要你确认」的通用状态。 */
  kind?: StateKind;
  /** 放在卡片里时使用（成组的状态样张、栅格里的单元）。 */
  card?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={card ? 'n-card n-state' : 'n-state'}
      role={
        kind === 'loading' ? 'status' : kind === 'failed' ? 'alert' : undefined
      }
    >
      {kind === 'denied' ? (
        <span
          aria-hidden="true"
          className="n-avatar n-avatar--lg"
          style={
            {
              '--hue': 0,
              background: 'var(--sheet-sunk)',
              boxShadow: 'none',
              color: 'var(--ink-3)',
            } as CSSProperties
          }
        >
          <Icon name="lock" size={20} />
        </span>
      ) : (
        <Niu size={56} state={kind ? niuState[kind] : 'confirm'} />
      )}
      <h2 className="n-state__title">{title}</h2>
      {text ? <p className="n-state__text">{text}</p> : null}
      {children ? (
        <div className="nt-row" style={{ justifyContent: 'center' }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
/** 来源或 AI 出问题时：说清哪一步没完成、保留了什么、下一步能做什么。 */
export function Fail({
  icon = 'info',
  title,
  kept,
  actions,
  children,
}: {
  icon?: IconName;
  title: string;
  /** 已保留的内容，例如已保存的原话。 */
  kept?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="n-fail">
      <div className="n-fail__head">
        <Icon name={icon} />
        {title}
      </div>
      {children ? <p>{children}</p> : null}
      {kept ? <div className="n-fail__kept">{kept}</div> : null}
      {actions ? (
        <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
          {actions}
        </div>
      ) : null}
    </div>
  );
}
/** 内容在查看范围之外：只说明范围，不透露内容。 */
export function Lock({ children }: { children: ReactNode }) {
  return (
    <span className="n-lock">
      <Icon name="lock" />
      {children}
    </span>
  );
}
