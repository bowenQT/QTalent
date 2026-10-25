'use client';
import { useId } from 'react';
import type { ReactNode } from 'react';
/** Textarea、Select 共用的字段外框：标签、提示与错误。 */
export type FieldFrameProps = {
  label: ReactNode;
  /** 标签旁的小字，例如「必填」。 */
  note?: ReactNode;
  hint?: ReactNode;
  /** 有错误时替换提示，并以 role=alert 播报；外框带 is-error。 */
  error?: ReactNode;
};
export function useFieldIds(id?: string) {
  const generated = useId();
  const controlId = id ?? generated;
  return { controlId, messageId: `${controlId}-message` };
}
export function describedBy(
  existing: string | undefined,
  messageId: string,
  hasMessage: boolean,
) {
  const ids = [existing, hasMessage ? messageId : undefined].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}
export function FieldFrame({
  label,
  note,
  hint,
  error,
  controlId,
  messageId,
  children,
}: FieldFrameProps & {
  controlId: string;
  messageId: string;
  children: ReactNode;
}) {
  return (
    <div className={`n-field${error ? ' is-error' : ''}`}>
      <label className="n-field__label" htmlFor={controlId}>
        {label}
        {note ? (
          <>
            {' '}
            <small>{note}</small>
          </>
        ) : null}
      </label>
      {children}
      {error ? (
        <span
          id={messageId}
          role="alert"
          className="n-field__hint nt-field-error"
        >
          {error}
        </span>
      ) : hint ? (
        <span id={messageId} className="n-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
