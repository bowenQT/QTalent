import { isEnumKey } from './enum';
import { Icon, type IconName } from './Icon';

/** The five provenance classes; they are stored and shown apart (AGENTS 产品不变量). */
export const srcKinds = ['fact', 'self', 'obs', 'ai', 'human'] as const;
export type SrcKind = (typeof srcKinds)[number];

const meta: Record<
  SrcKind,
  { icon: IconName; label: string; alternatives: readonly string[] }
> = {
  fact: { icon: 'doc', label: '原始事实', alternatives: ['历史资料'] },
  self: { icon: 'quote', label: '本人自述', alternatives: [] },
  obs: { icon: 'eye', label: '管理观察', alternatives: [] },
  ai: {
    icon: 'spark',
    label: 'AI 推断',
    alternatives: ['AI 建议', 'AI 草拟', 'AI 摘要', 'AI 回答', 'AI 假设'],
  },
  human: { icon: 'pen', label: '人工结论', alternatives: [] },
};

/** Names the prototype gives AI output by what it did; all remain the AI class. */
export type AiLabel =
  'AI 推断' | 'AI 建议' | 'AI 草拟' | 'AI 摘要' | 'AI 回答' | 'AI 假设';

export type SrcProps =
  | { kind: 'fact'; label?: '原始事实' | '历史资料' }
  | { kind: 'ai'; label?: AiLabel }
  | { kind: 'self' | 'obs' | 'human'; label?: never };

/** The visible name may vary only inside the same class (a history source is still a fact). */
export function Src({ kind, label }: SrcProps) {
  if (!isEnumKey(meta, kind))
    throw new Error(`Unknown source kind: ${String(kind)}`);
  const entry = meta[kind];
  if (
    label !== undefined &&
    label !== entry.label &&
    !entry.alternatives.includes(label)
  )
    throw new Error(`Label ${label} does not belong to source kind ${kind}`);
  return (
    <span className={`n-src n-src--${kind}`}>
      <Icon name={entry.icon} />
      {label ?? entry.label}
    </span>
  );
}
