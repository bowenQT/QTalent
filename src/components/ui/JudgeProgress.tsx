import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { isEnumKey } from './enum';
import { Icon, type IconName } from './Icon';

/**
 * How far one candidate's judgement has got. These four neutral labels never state a
 * conclusion and borrow no match colour; the conclusion is a MatchState once it exists.
 */
export const judgeProgressStates = [
  'queued',
  'judging',
  'review',
  'failed',
] as const;
export type JudgeProgressState = (typeof judgeProgressStates)[number];

const meta: Record<JudgeProgressState, { icon: IconName; label: string }> = {
  queued: { icon: 'clock', label: '排队中' },
  judging: { icon: 'pulse', label: '判断中' },
  review: { icon: 'info', label: '待人工判断' },
  failed: { icon: 'x', label: '失败' },
};

function assertState(state: unknown) {
  if (!isEnumKey(meta, state))
    throw new Error(`Unknown judge progress state: ${String(state)}`);
}

/** Icon plus text, so the state never rests on colour or motion alone. */
export function JudgeProgressBadge({ state }: { state: JudgeProgressState }) {
  assertState(state);
  return (
    <Badge className="n-badge--proc" data-state={state}>
      <Icon name={meta[state].icon} />
      {meta[state].label}
    </Badge>
  );
}

type RowProps = {
  /** Who or what is being judged, e.g. a candidate name. */
  subject: string;
  /** One line on where it stands and what happens next. */
  note: string;
};

export type JudgeProgressProps = RowProps &
  (
    | { state: 'queued' | 'judging' | 'review'; retry?: never }
    | {
        state: 'failed';
        /** The caller owns the retry: its wording and what it triggers. */
        retry?: { label: string; onRetry: () => void; disabled?: boolean };
      }
  );

/** One row of the progress list; render rows inside {@link JudgeProgressList}. */
export function JudgeProgress({
  state,
  subject,
  note,
  retry,
}: JudgeProgressProps) {
  assertState(state);
  return (
    <li>
      <JudgeProgressBadge state={state} />
      <span>
        {subject}
        <br />
        <small className="n-proc__note">{note}</small>
        {state === 'failed' && retry ? (
          <>
            <br />
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost n-proc__retry"
              disabled={retry.disabled}
              onClick={retry.onRetry}
            >
              {retry.label}
            </button>
          </>
        ) : null}
      </span>
    </li>
  );
}

export function JudgeProgressList({ children }: { children: ReactNode }) {
  return (
    <ul className="n-reqs n-reqs--proc" style={{ marginTop: 0 }}>
      {children}
    </ul>
  );
}
