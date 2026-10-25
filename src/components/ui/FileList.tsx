import { FileItem, type FileItemProps } from './FileItem';

export type FileListEntry = Omit<FileItemProps, 'onRemove'> & { id: string };

/**
 * 文件列表。`readOnly` 用于保存之后：不再显示移除。没有条目时不渲染。
 * `variant="attach"` 是记录事件时附在输入框下的紧凑列表。
 */
export function FileList({
  entries,
  readOnly = false,
  variant,
  onRemove,
  'aria-label': ariaLabel,
}: {
  entries: readonly FileListEntry[];
  readOnly?: boolean;
  variant?: 'attach';
  onRemove?: (id: string) => void;
  'aria-label'?: string;
}) {
  if (!entries.length) return null;
  return (
    <ul
      className={`n-files${variant === 'attach' ? ' n-attach' : ''}`}
      aria-label={ariaLabel}
    >
      {entries.map(({ id, ...item }) => (
        <FileItem
          key={id}
          {...item}
          onRemove={readOnly || !onRemove ? undefined : () => onRemove(id)}
        />
      ))}
    </ul>
  );
}
