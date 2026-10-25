import type { HTMLAttributes } from 'react';
export function Badge({
  className = '',
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={`n-badge ${className}`} />;
}
