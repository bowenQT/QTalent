'use client';
import type { KeyboardEvent } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import type { LoadSource } from '@/features/sources/SourceCite';
import { InputQuotes, SourceMarks } from './CitationMarks';
import { copy } from './copy';
import type { QuoteRange } from './RawInput';
import type { RecordScore } from './types';

const LEVELS = [1, 2, 3, 4, 5] as const;

export type ScoreRowProps = {
  dimension: string;
  score: RecordScore;
  /** 用户当前选的分；建议分未点击前等于建议值，资料不足的行为 null。 */
  value: number | null;
  /** 用户已点击确认（保存后所有建议分都视为已确认）。 */
  confirmed: boolean;
  reason: string;
  readOnly: boolean;
  /** 锚点没读到时不能改分，建议分仍可保存时一并确认。 */
  pickDisabled: boolean;
  problem?: string;
  loadSource: LoadSource;
  onPick: (value: number) => void;
  onReason: (reason: string) => void;
  /** 悬停或聚焦某一分时右栏显示对应锚点；离开时传 null。 */
  onPreview: (value: number | null) => void;
  onJumpInput: (range: QuoteRange) => void;
};

/**
 * 一条维度分。建议分是 AI 的提议（data-state="ai"），点击后才是用户确认的分；
 * 资料不足的行不出分也不可点。
 */
export function ScoreRow(props: ScoreRowProps) {
  const { dimension, score, value, confirmed, readOnly } = props;
  if (score.state === 'unknown') {
    return (
      <div className="n-score" data-state="unknown">
        <span className="n-score__dim">{dimension}</span>
        <Badge className="n-score__empty n-badge--unknown">
          <Icon name="dash" />
          {copy.score.insufficient}
        </Badge>
        <span className="n-score__note">{score.reason}</span>
      </div>
    );
  }
  const current = value ?? score.value;
  const edited = confirmed && current !== score.value;
  const delta = current - score.value;
  const locked = readOnly || props.pickDisabled;
  const pick = (next: number) => {
    if (!locked) props.onPick(Math.min(5, Math.max(1, next)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const move: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowUp: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current - 1,
      Home: 1,
      End: 5,
    };
    const next = move[event.key];
    if (next === undefined) return;
    event.preventDefault();
    pick(next);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('button')
      [Math.min(5, Math.max(1, next)) - 1]?.focus();
  };
  const reasonVisible = readOnly ? edited && !!props.reason : edited;
  return (
    <div className="n-score" data-state={confirmed ? 'confirmed' : 'ai'}>
      <span className="n-score__dim">{dimension}</span>
      <span
        className="n-score__dots"
        role="radiogroup"
        aria-label={copy.score.groupLabel(dimension)}
      >
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-label={copy.score.pointLabel(level)}
            aria-checked={confirmed && level === current}
            aria-disabled={locked || undefined}
            tabIndex={level === current ? 0 : -1}
            className={`n-score__dot${level <= current ? ' is-on' : ''}${
              edited && level <= score.value && level > current
                ? ' is-ghost'
                : ''
            }`}
            onClick={() => pick(level)}
            onKeyDown={onKeyDown}
            onMouseEnter={() => props.onPreview(level)}
            onMouseLeave={() => props.onPreview(null)}
            onFocus={() => props.onPreview(level)}
            onBlur={() => props.onPreview(null)}
          />
        ))}
      </span>
      <span className="n-score__note">
        {confirmed ? (
          edited ? (
            <>
              <span className="n-score__delta">{copy.score.delta(delta)}</span>
              {copy.score.aiWas(score.value)}
            </>
          ) : (
            copy.score.confirmed
          )
        ) : (
          // 确认前照原型写锚点和原话引用；确认后只写「已确认」，引文仍在「原话」里。
          <span>
            {copy.score.anchorNote(score.value)}
            <InputQuotes
              citations={score.citations}
              onJumpInput={props.onJumpInput}
            />
          </span>
        )}
        <SourceMarks
          citations={score.citations}
          loadSource={props.loadSource}
        />
      </span>
      {reasonVisible ? (
        <input
          className="n-score__why"
          aria-label={copy.score.whyLabel(dimension)}
          placeholder={
            Math.abs(current - score.value) >= 2
              ? copy.score.whyReview(current)
              : copy.score.whyOptional(current)
          }
          value={props.reason}
          readOnly={readOnly}
          onChange={(event) => props.onReason(event.target.value)}
        />
      ) : null}
      {props.problem ? (
        <span className="nt-field-error" role="alert">
          {props.problem}
        </span>
      ) : null}
    </div>
  );
}
