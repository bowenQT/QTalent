'use client';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import {
  selectFiles,
  type FileSelection,
  type FileSelectionRules,
} from './file-selection';

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

/**
 * 上传区：本身是一个按钮，点击、Enter 与空格都打开文件选择，也可以把文件拖进来，一次可选多个。
 * 组件只做校验与切分，选择结果通过 `onSelect` 交给调用方；加入列表、Toast 提示都由调用方处理。
 */
export function DropZone({
  rules,
  currentCount,
  hint,
  label = '拖入文件，或点这里选择',
  disabled = false,
  onSelect,
}: {
  rules: FileSelectionRules;
  /** 列表里已有的文件数，用来算剩余名额。 */
  currentCount: number;
  /** 可上传的类型与说明。 */
  hint: ReactNode;
  label?: string;
  disabled?: boolean;
  onSelect: (selection: FileSelection) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const accept = rules.extensions.map((ext) => `.${ext}`).join(',');

  function choose(files: readonly File[]) {
    if (files.length) onSelect(selectFiles(files, rules, currentCount));
  }
  // 不可用时也要接住拖入的文件：否则浏览器会直接打开它，离开当前页面。
  function enter(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (disabled) return;
    depth.current += 1;
    setOver(true);
  }
  function hover(event: DragEvent) {
    if (!carriesFiles(event)) return;
    // 不阻止默认行为，浏览器就不允许放下。
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
  }
  function leave() {
    // 经过内部子元素时 enter 与 leave 成对出现，计数归零才算真正离开。
    depth.current = Math.max(depth.current - 1, 0);
    if (depth.current === 0) setOver(false);
  }
  function drop(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (disabled) return;
    depth.current = 0;
    setOver(false);
    choose(Array.from(event.dataTransfer.files));
  }

  return (
    <>
      <button
        type="button"
        className={`n-drop${over ? ' is-over' : ''}`}
        // 不用原生 disabled：禁用的按钮收不到拖放事件，文件会被浏览器直接打开。
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) input.current?.click();
        }}
        onDragEnter={enter}
        onDragOver={hover}
        onDragLeave={leave}
        onDrop={drop}
      >
        <Icon name="upload" />
        <b>{label}</b>
        <small>{hint}</small>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          choose(Array.from(event.currentTarget.files ?? []));
          // 清空后再选同一个文件也会触发 change。
          event.currentTarget.value = '';
        }}
      />
    </>
  );
}
