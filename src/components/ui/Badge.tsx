import type { HTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';
/** 原型已有的徽标变体。yes / no / unknown / conflict 只用于项目要求匹配的四种状态，其余按语义取用，不借作装饰。 */
export type BadgeTone =
  | 'yes'
  | 'no'
  | 'unknown'
  | 'conflict'
  | 'ai'
  | 'demo'
  | 'preset'
  | 'archived'
  | 'ended'
  | 'prep'
  | 'recal'
  | 'seal';
export function Badge({
  tone,
  icon,
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; icon?: IconName }) {
  const classes = ['n-badge', tone ? `n-badge--${tone}` : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <span {...props} className={classes}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}
