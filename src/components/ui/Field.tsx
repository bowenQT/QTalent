import type { InputHTMLAttributes } from 'react';
export function Field({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="n-field">
      <span className="n-field__label">{label}</span>
      <input {...props} className="n-input" />
    </label>
  );
}
