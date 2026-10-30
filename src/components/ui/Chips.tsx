'use client';
import type { ReactNode } from 'react';
export type ChipItem = {
  value: string;
  label: ReactNode;
  /** 计数；为 0 时显示与否由调用方决定，不传就不显示。 */
  count?: number;
  disabled?: boolean;
};
/**
 * 筛选项。单选还是多选由调用方决定：点击只回报被点的值，
 * 调用方据此更新 selected（单选换成 [value]，多选做增减）。
 */
export function Chips({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: readonly ChipItem[];
  selected: readonly string[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="n-chips" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className="n-chip"
          aria-pressed={selected.includes(item.value)}
          disabled={item.disabled}
          onClick={() => onSelect(item.value)}
        >
          {item.label}
          {item.count === undefined ? null : <b>{item.count}</b>}
        </button>
      ))}
    </div>
  );
}
/** 标题、页签旁的数字计数。quiet 是次要计数，seal 只用于需要你决定的数量。 */
export function Count({
  tone,
  children,
}: {
  tone?: 'quiet' | 'seal';
  children: ReactNode;
}) {
  return (
    <span className={`n-count${tone ? ` is-${tone}` : ''}`}>{children}</span>
  );
}
