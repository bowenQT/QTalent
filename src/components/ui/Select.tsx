'use client';
import type { SelectHTMLAttributes } from 'react';
import {
  FieldFrame,
  describedBy,
  useFieldIds,
  type FieldFrameProps,
} from './FieldFrame';
/** 原生下拉：选项由调用方以 option 传入。 */
export function Select({
  label,
  note,
  hint,
  error,
  id,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & FieldFrameProps) {
  const { controlId, messageId } = useFieldIds(id);
  return (
    <FieldFrame
      label={label}
      note={note}
      hint={hint}
      error={error}
      controlId={controlId}
      messageId={messageId}
    >
      <select
        {...props}
        id={controlId}
        className={`n-select ${className}`.trim()}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy(
          props['aria-describedby'],
          messageId,
          Boolean(error || hint),
        )}
      />
    </FieldFrame>
  );
}
