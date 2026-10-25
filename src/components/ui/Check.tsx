import type { InputHTMLAttributes, ReactNode } from 'react';
/** 原生复选框：标签文字包在 label 里，整行可点。 */
export function Check({
  children,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> & {
  children: ReactNode;
}) {
  return (
    <label className={`n-check ${className}`.trim()}>
      <input {...props} type="checkbox" />
      {children}
    </label>
  );
}
