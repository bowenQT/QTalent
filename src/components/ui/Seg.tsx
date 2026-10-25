'use client';
import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useControllable } from './useControllable';
export type SegItem<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};
/**
 * 分段控件：互斥的视图切换。样式表以 aria-pressed 表达选中，所以结构沿用原型的
 * 按钮组；单选与方向键移动由这里保证，选中项是唯一的 Tab 停靠点。
 */
export function Seg<T extends string>({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  size = '',
}: {
  label: string;
  items: readonly SegItem<T>[];
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  size?: 'md' | '';
}) {
  const [current, change] = useControllable(value, defaultValue, onValueChange);
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const tabStop = items.some((item) => item.value === current && !item.disabled)
    ? current
    : items.find((item) => !item.disabled)?.value;
  function move(event: KeyboardEvent, from: number) {
    const enabled = items.filter((item) => !item.disabled);
    const position = enabled.indexOf(items[from]);
    let target: SegItem<T> | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      target = enabled[(position + 1) % enabled.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
      target = enabled[(position - 1 + enabled.length) % enabled.length];
    else if (event.key === 'Home') target = enabled[0];
    else if (event.key === 'End') target = enabled[enabled.length - 1];
    if (!target) return;
    event.preventDefault();
    change(target.value);
    refs.current.get(target.value)?.focus();
  }
  return (
    <div
      className={`n-seg${size ? ` n-seg--${size}` : ''}`}
      role="group"
      aria-label={label}
    >
      {items.map((item, index) => (
        <button
          key={item.value}
          ref={(node) => {
            if (node) refs.current.set(item.value, node);
            else refs.current.delete(item.value);
          }}
          type="button"
          aria-pressed={item.value === current}
          tabIndex={item.value === tabStop ? 0 : -1}
          disabled={item.disabled}
          onClick={() => change(item.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
