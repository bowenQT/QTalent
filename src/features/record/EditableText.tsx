'use client';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * 行内可改的文字（原型的 .n-edit）。文字由 value 控制，输入时只回报新值，
 * 不回写 DOM，光标不会跳；值为空时显示灰色占位，聚焦即清空占位。
 * AI 整理出的文字带流光底，用户改过之后去掉。
 */
export function EditableText({
  value,
  label,
  field,
  placeholder,
  editable,
  onChange,
}: {
  value: string;
  label: string;
  field: string;
  placeholder?: string;
  editable: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [focused, setFocused] = useState(false);
  const [edited, setEdited] = useState(false);
  // 原型保存后仍用灰字留着「补充情境」「补充影响」，空着的字段看得出来是空的。
  const showPlaceholder = !focused && value === '' && !!placeholder;
  const shown = showPlaceholder ? placeholder : value;
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && element.textContent !== shown) element.textContent = shown;
  }, [shown]);
  const light = editable && !edited && value !== '';
  return (
    <span
      ref={ref}
      className={`n-edit${light ? ' is-light' : ''}`}
      data-k={field}
      data-empty={showPlaceholder ? '1' : undefined}
      style={showPlaceholder ? { color: 'var(--ink-3)' } : undefined}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      aria-readonly={editable ? undefined : true}
      contentEditable={editable ? 'plaintext-only' : undefined}
      suppressContentEditableWarning
      spellCheck={false}
      tabIndex={editable ? 0 : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onInput={(event) => {
        setEdited(true);
        onChange(event.currentTarget.textContent ?? '');
      }}
    />
  );
}
