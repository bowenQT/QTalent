import type { ButtonHTMLAttributes } from 'react';
export function Button({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`n-btn ${className}`} />;
}
