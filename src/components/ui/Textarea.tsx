'use client';
import type { TextareaHTMLAttributes } from 'react';
import {
  FieldFrame,
  describedBy,
  useFieldIds,
  type FieldFrameProps,
} from './FieldFrame';
export function Textarea({
  label,
  note,
  hint,
  error,
  id,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldFrameProps) {
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
      <textarea
        {...props}
        id={controlId}
        className={`n-textarea ${className}`.trim()}
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
