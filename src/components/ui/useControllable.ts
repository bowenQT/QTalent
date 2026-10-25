'use client';
import { useState } from 'react';
/** 传了 value 就由调用方控制；没传就在组件内部记住选择。 */
export function useControllable<T extends string>(
  value: T | undefined,
  defaultValue: T | undefined,
  onChange?: (next: T) => void,
) {
  const [inner, setInner] = useState<T | undefined>(defaultValue);
  const current = value ?? inner;
  function change(next: T) {
    if (value === undefined) setInner(next);
    onChange?.(next);
  }
  return [current, change] as const;
}
