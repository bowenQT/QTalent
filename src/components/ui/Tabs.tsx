'use client';
import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Link from 'next/link';
import { Count } from './Chips';
import { useControllable } from './useControllable';
export type TabItem = {
  id: string;
  label: ReactNode;
  /** 页签旁的数字；不传就不显示。 */
  count?: number;
  content: ReactNode;
};
/** 同一对象不同视图的页签。左右方向键循环切换，Home / End 到首尾，切换即选中。 */
export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
}: {
  label: string;
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
}) {
  const base = useId();
  const [current, change] = useControllable(
    value,
    defaultValue ?? items[0]?.id,
    onValueChange,
  );
  const selected = items.some((item) => item.id === current)
    ? current
    : items[0]?.id;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  function move(event: KeyboardEvent, from: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (from + 1) % items.length;
    else if (event.key === 'ArrowLeft')
      next = (from - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    change(items[next].id);
    refs.current.get(items[next].id)?.focus();
  }
  return (
    <>
      <div className="n-tabs" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${item.id}`}
            aria-selected={item.id === selected}
            aria-controls={`${base}-panel-${item.id}`}
            tabIndex={item.id === selected ? 0 : -1}
            onClick={() => change(item.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {item.label}
            {item.count === undefined ? null : <Count>{item.count}</Count>}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          className="n-tabpanel"
          role="tabpanel"
          id={`${base}-panel-${item.id}`}
          aria-labelledby={`${base}-tab-${item.id}`}
          hidden={item.id !== selected}
        >
          {item.content}
        </div>
      ))}
    </>
  );
}
export type TabLink = { href: string; label: ReactNode; current?: boolean };
/** 导航型子页签：每个页签是一个页面，用链接加 aria-current="page" 表达当前页。 */
export function TabNav({
  label,
  items,
}: {
  label: string;
  items: readonly TabLink[];
}) {
  return (
    <nav className="n-tabs nt-subtabs" aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
