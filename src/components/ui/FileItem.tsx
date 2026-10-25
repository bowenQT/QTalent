import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { Progress } from './Progress';

export type FileItemStatus =
  'uploading' | 'processing' | 'parsed' | 'unsupported' | 'failed';

export type FileItemProps = {
  name: string;
  /** 左侧格式角标，例如 `DOCX`，可用 `extLabel(name)` 得到。 */
  ext: string;
  status: FileItemStatus;
  /** 上传中的字节进度，0–100；解析或转写中显示不定进度。 */
  progress?: number;
  /** 状态说明。已解析时写明能定位到页、段或时间点；不支持与失败时写原因和下一步。 */
  message: string;
  /** 已解析、不支持、失败时放在说明前的醒目小标题，例如「已解析」。 */
  headline?: string;
  /** 行尾的操作，例如「确认事件」。给了它就不再显示移除按钮。 */
  action?: ReactNode;
  /** 给了才显示移除按钮；保存后只读的列表不要传。 */
  onRemove?: () => void;
};

/**
 * 文件条目。进度刷新时 React 只更新这一行里变化的部分，行尾按钮的元素保持不变，
 * 键盘焦点因此留在「移除」上。
 */
export function FileItem({
  name,
  ext,
  status,
  progress,
  message,
  headline,
  action,
  onRemove,
}: FileItemProps) {
  const tone =
    status === 'parsed'
      ? 'ok'
      : status === 'unsupported' || status === 'failed'
        ? 'err'
        : null;
  return (
    <li className="n-file" data-status={status}>
      <span className="n-file__ext">{ext}</span>
      <div style={{ minWidth: 0 }}>
        <div className="n-file__name" title={name}>
          {name}
        </div>
        <div className="n-file__state">
          {tone && headline ? (
            <>
              <span className={tone}>{headline}</span> · {message}
            </>
          ) : tone ? (
            <span className={tone}>{message}</span>
          ) : (
            message
          )}
        </div>
        {status === 'uploading' ? (
          <Progress value={progress ?? 0} label={`${name} 上传进度`} />
        ) : status === 'processing' ? (
          <Progress label={`${name} 处理进度`} />
        ) : null}
      </div>
      {action ??
        (onRemove ? (
          <Button
            className="n-btn--ghost n-btn--icon n-file__rm"
            aria-label={`移除附件「${name}」`}
            onClick={onRemove}
          >
            <Icon name="x" />
          </Button>
        ) : null)}
    </li>
  );
}
