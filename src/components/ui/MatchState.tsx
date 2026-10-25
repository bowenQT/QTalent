import { Badge } from './Badge';
import { isEnumKey } from './enum';
import { Icon, type IconName } from './Icon';

/** Requirement matching uses exactly these four states; colour never carries meaning alone. */
export const matchStates = ['yes', 'no', 'unknown', 'conflict'] as const;
export type MatchStateValue = (typeof matchStates)[number];

const meta: Record<MatchStateValue, { icon: IconName; label: string }> = {
  yes: { icon: 'check', label: '支持' },
  no: { icon: 'x', label: '不支持' },
  unknown: { icon: 'dash', label: '资料不足' },
  conflict: { icon: 'split', label: '证据冲突' },
};

export function MatchState({ state }: { state: MatchStateValue }) {
  if (!isEnumKey(meta, state))
    throw new Error(`Unknown match state: ${String(state)}`);
  return (
    <Badge className={`n-badge--${state}`}>
      <Icon name={meta[state].icon} />
      {meta[state].label}
    </Badge>
  );
}
