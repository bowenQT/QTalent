import type { ReactNode } from 'react';
import { Badge } from './Badge';
import { Icon } from './Icon';

/** A dimension score is always one of five levels; there is no total, percentage or rank. */
export const scoreValues = [1, 2, 3, 4, 5] as const;
export type ScoreValue = (typeof scoreValues)[number];

type Base = { dimension: string; note?: ReactNode };
/**
 * `suggested` is the AI proposal and is never styled as confirmed. `insufficient`
 * (involved but lacking behaviour or results) and `absent` (the event does not show this
 * dimension) carry no value at all and stay distinct.
 */
export type ScoreProps = Base &
  (
    | { state: 'suggested'; value: ScoreValue; inline?: boolean }
    | {
        state: 'confirmed' | 'calibrated';
        value: ScoreValue;
        /** Who confirmed or calibrated it, shown in hand-written type; every confirmed score has a scorer. */
        by: string;
        /** The AI proposal this score replaced; differing values show a ghost and a delta. */
        aiOriginal?: ScoreValue;
        inline?: boolean;
        onOpenHistory?: () => void;
      }
    | { state: 'insufficient'; value?: never; inline?: never }
    | { state: 'absent'; value?: never; inline?: never }
  );

const dataState = {
  suggested: 'ai',
  confirmed: 'confirmed',
  calibrated: 'calibrated',
  insufficient: 'unknown',
  absent: 'absent',
} as const;

function assertValue(value: number) {
  if (!scoreValues.includes(value as ScoreValue))
    throw new Error(`Score value must be 1-5, received ${String(value)}`);
}

function Dots({
  value,
  ghost,
  label,
}: {
  value: ScoreValue;
  ghost?: ScoreValue;
  label: string;
}) {
  return (
    <span className="n-score__dots" role="img" aria-label={label}>
      {scoreValues.map((level) => (
        <i
          key={level}
          className={`n-score__dot${level <= value ? ' is-on' : ''}${
            ghost !== undefined && level > value && level <= ghost
              ? ' is-ghost'
              : ''
          }`}
        />
      ))}
    </span>
  );
}

export function Score(props: ScoreProps) {
  const { dimension, note } = props;
  const declared: string = props.state;
  if (!Object.hasOwn(dataState, declared))
    throw new Error(`Unknown score state: ${declared}`);
  if (props.state === 'insufficient' || props.state === 'absent') {
    return (
      <div className="n-score" data-state={dataState[props.state]}>
        <span className="n-score__dim">{dimension}</span>
        {props.state === 'insufficient' ? (
          <Badge className="n-score__empty n-badge--unknown">
            <Icon name="dash" />
            资料不足
          </Badge>
        ) : (
          <Badge className="n-score__empty">未体现</Badge>
        )}
        <span className="n-score__note">{note}</span>
      </div>
    );
  }
  assertValue(props.value);
  const label = `${dimension} ${props.value} 分${props.state === 'suggested' ? '（AI 建议，未确认）' : ''}`;
  if (props.inline) {
    return (
      <span
        className="n-score n-score--inline"
        data-state={dataState[props.state]}
      >
        <Dots value={props.value} label={label} />
      </span>
    );
  }
  if (props.state === 'suggested') {
    return (
      <div className="n-score" data-state="ai">
        <span className="n-score__dim">{dimension}</span>
        <Dots value={props.value} label={label} />
        <span className="n-score__note">
          <Badge className="n-badge--ai">
            <Icon name="spark" />
            AI 建议
          </Badge>
          {note ? <> · {note}</> : null}
        </span>
      </div>
    );
  }
  const { value, aiOriginal, by, onOpenHistory } = props;
  if (!by?.trim())
    throw new Error('A confirmed or calibrated score needs its scorer');
  if (aiOriginal !== undefined) assertValue(aiOriginal);
  const delta = aiOriginal !== undefined ? value - aiOriginal : 0;
  return (
    <div className="n-score" data-state={dataState[props.state]}>
      <span className="n-score__dim">{dimension}</span>
      <Dots
        value={value}
        ghost={
          aiOriginal !== undefined && aiOriginal > value
            ? aiOriginal
            : undefined
        }
        label={label}
      />
      <span className="n-score__note">
        <span className="ink-hand">{by}</span>
        {note ?? (props.state === 'calibrated' ? '校准' : '确认')}
        {delta !== 0 ? (
          <>
            {' · '}
            <span className="n-score__delta">
              {delta > 0 ? `+${delta}` : delta}
            </span>
            {` AI 原为 ${aiOriginal}`}
          </>
        ) : null}
        {onOpenHistory ? (
          <>
            {' '}
            <button type="button" className="n-link" onClick={onOpenHistory}>
              修订历史
            </button>
          </>
        ) : null}
      </span>
    </div>
  );
}
