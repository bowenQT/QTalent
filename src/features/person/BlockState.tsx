import { Badge } from '@/components/ui/Badge';

export type NotReady =
  | { status: 'empty' }
  | { status: 'insufficient_evidence'; reason: string }
  | { status: 'unknown'; reason: string };

/**
 * 一块内容没有可展示的数据时的说法。资料不足、未知都写出原因，不出分、不写成 0；
 * 空状态用这一块自己的肯定句。
 */
export function BlockState({
  block,
  empty,
}: {
  block: NotReady;
  empty: string;
}) {
  if (block.status === 'empty') return <div className="nt-empty">{empty}</div>;
  return (
    <p className="nt-caption">
      {block.status === 'insufficient_evidence' ? (
        <Badge tone="unknown" icon="dash">
          资料不足
        </Badge>
      ) : (
        <Badge tone="unknown" icon="dash">
          未知
        </Badge>
      )}{' '}
      <span className="nt-muted">{block.reason}</span>
    </p>
  );
}
