import type { HTMLAttributes } from 'react';
/** 纯容器：只提供卡片底座，不含业务字段。 */
export function Card({
  as: Tag = 'div',
  className = '',
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'article' | 'section' | 'aside';
}) {
  return <Tag {...props} className={`n-card ${className}`.trim()} />;
}
