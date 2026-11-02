'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Check } from '@/components/ui/Check';
import { Icon } from '@/components/ui/Icon';
import type { Source, SourceReference } from '@/contracts/sources';
import {
  formatLocation,
  sourceTypeName,
} from '@/features/sources/source-format';
import { type StaffingConclusion, type StaffingRequirement } from '../../view';
import {
  manualNoSources,
  manualReason,
  manualReasonPlaceholder,
  manualSign,
  manualSources,
  manualTitle,
} from '../../copy';

export const MAX_REASON_LENGTH = 1000;

// The four states as text chips; the text carries the meaning, the pressed chip is ink.
const conclusions: readonly { value: StaffingConclusion; label: string }[] = [
  { value: 'supported', label: '支持' },
  { value: 'not_supported', label: '不支持' },
  { value: 'insufficient', label: '资料不足' },
  { value: 'conflict', label: '证据冲突' },
];

export type ManualJudgmentDraft = {
  conclusion: StaffingConclusion;
  rationale: string;
  sources: SourceReference[];
};

function toReference(source: Source): SourceReference {
  return {
    fragmentId: source.fragmentId,
    originalVersionId: source.originalVersionId,
    location: source.location,
  };
}

const sourceKey = (source: Source) =>
  `${source.fragmentId}\u0000${source.originalVersionId}`;

/**
 * Judging one requirement by hand: one of the four states, a reason, and for any state
 * but「资料不足」at least one source. Composed from the judgment attribution pattern
 * (prototype judge.js); this form has no prototype design of its own yet (BOW-925).
 */
export function ManualJudgment({
  requirement,
  personName,
  sources,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  requirement: StaffingRequirement;
  personName: string;
  /** Sources the judge may cite. */
  sources: Source[];
  busy: boolean;
  error: string | null;
  onSubmit: (draft: ManualJudgmentDraft) => void;
  onCancel: () => void;
}) {
  const ids = { title: useId(), reason: useId(), error: useId() };
  const chips = useRef<HTMLDivElement>(null);
  // Opening the form moves focus into it, to the first choice that can be taken.
  useEffect(() => {
    chips.current?.querySelector<HTMLButtonElement>('button:enabled')?.focus();
  }, []);
  const [conclusion, setConclusion] = useState<StaffingConclusion | null>(null);
  const [rationale, setRationale] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const needsSource = conclusion !== null && conclusion !== 'insufficient';
  const chosen = sources.filter((source) => picked.has(sourceKey(source)));
  const ready =
    conclusion !== null &&
    rationale.trim().length > 0 &&
    (!needsSource || chosen.length > 0) &&
    !busy;
  return (
    <div
      className="n-card"
      style={{ boxShadow: 'var(--e-0)', marginTop: 'var(--s-2)' }}
      role="group"
      aria-labelledby={ids.title}
    >
      <div className="n-field__label" id={ids.title}>
        {manualTitle}：{personName} · {requirement.text}
      </div>
      <div
        ref={chips}
        className="n-chips"
        role="group"
        aria-label="判断结论（选一个）"
        style={{ margin: 'var(--s-2) 0 0' }}
      >
        {conclusions.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="n-chip"
            aria-pressed={conclusion === value}
            disabled={
              busy || (value !== 'insufficient' && sources.length === 0)
            }
            onClick={() => setConclusion(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {sources.length === 0 ? (
        <p className="nt-caption">{manualNoSources}</p>
      ) : (
        <fieldset
          style={{ border: 0, padding: 0, margin: 'var(--s-3) 0 0' }}
          disabled={busy}
        >
          <legend className="n-field__label">{manualSources}</legend>
          {sources.map((source) => {
            const key = sourceKey(source);
            return (
              <Check
                key={key}
                checked={picked.has(key)}
                onChange={(event) => {
                  const next = new Set(picked);
                  if (event.target.checked) next.add(key);
                  else next.delete(key);
                  setPicked(next);
                }}
              >
                {sourceTypeName(source.location.kind)} ·{' '}
                {formatLocation(source.location)}：{source.excerpt}
              </Check>
            );
          })}
        </fieldset>
      )}
      <label className="n-field" style={{ marginTop: 'var(--s-3)' }}>
        <span className="n-field__label">{manualReason}</span>
        <textarea
          className="n-textarea"
          id={ids.reason}
          rows={2}
          maxLength={MAX_REASON_LENGTH}
          placeholder={manualReasonPlaceholder}
          value={rationale}
          readOnly={busy}
          aria-describedby={error ? ids.error : undefined}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      {error ? (
        <p id={ids.error} role="alert" className="nt-field-error">
          {error}
        </p>
      ) : null}
      <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
        <button
          className="n-btn n-btn--sm n-btn--ink"
          type="button"
          disabled={!ready}
          onClick={() => {
            if (!conclusion) return;
            onSubmit({
              conclusion,
              rationale: rationale.trim(),
              sources: needsSource ? chosen.map(toReference) : [],
            });
          }}
        >
          <Icon name="check" />
          署名确认
        </button>
        <button
          className="n-btn n-btn--sm n-btn--ghost"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <span className="nt-muted">{manualSign}</span>
      </div>
    </div>
  );
}
