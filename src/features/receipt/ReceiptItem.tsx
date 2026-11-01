'use client';
import { useId, useRef, useState } from 'react';
import type { RecordBatchDraft } from '@/contracts/record';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Cite, type CiteSourceKind } from '@/components/ui/Cite';
import { Icon } from '@/components/ui/Icon';
import { Score, scoreValues, type ScoreValue } from '@/components/ui/Score';
import { Src } from '@/components/ui/Src';
import type { MaterialSourceReference } from '@/contracts/sources';
import { copy } from './copy';
import {
  draftScoreKey,
  formatLocation,
  isEdited,
  leadQuote,
  materialCount,
  materialLabel,
  sourceLine,
  suggestedValues,
  type EditValues,
} from './receipt-model';
import type { ReceiptView } from './types';

const citeKind: Record<
  MaterialSourceReference['location']['kind'],
  CiteSourceKind
> = {
  document: 'paragraph',
  pdf: 'page',
  presentation: 'page',
  spreadsheet: 'cell',
  recording: 'timestamp',
  video: 'timestamp',
  image: 'paragraph',
  code: 'paragraph',
};

/** 本页刚确认过的一件事：保留确认时的内容，供已确认卡片展示署名和改分。 */
export type ConfirmedDraft = {
  draft: RecordBatchDraft;
  values: EditValues;
  by: string;
  /** 确认日期，MM-DD。 */
  on: string;
};

export type ItemProblem = { message: string; reload: boolean };

type Props = {
  view: ReceiptView;
  draft: RecordBatchDraft;
  /** mine：当前查看人确认；others：等别人确认；confirmed：本页刚确认过。 */
  mode: 'mine' | 'others' | 'confirmed';
  confirmed?: ConfirmedDraft;
  busy: boolean;
  problem: ItemProblem | null;
  onConfirm: (values: EditValues, reason: string) => void;
  onReload: () => void;
};

function Who({ view, personIds }: { view: ReceiptView; personIds: string[] }) {
  return personIds.map((id) => {
    const person = view.people[id];
    if (!person) return null;
    return (
      <span key={id} style={{ display: 'contents' }}>
        <Avatar name={person.name} hue={person.hue} photo={person.photo} />
        <b>{person.name}</b>
        {person.demo ? <Badge tone="demo">{copy.demo}</Badge> : null}
      </span>
    );
  });
}

/** 回执里的一件事：证据摘录、出处和 AI 建议分；只能一件一件确认或改分，没有「全部确认」。 */
export function ReceiptItem({
  view,
  draft,
  mode,
  confirmed,
  busy,
  problem,
  onConfirm,
  onReload,
}: Props) {
  const { receipt } = view;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<EditValues>(() =>
    suggestedValues(draft),
  );
  const [reason, setReason] = useState('');
  const [whyMissing, setWhyMissing] = useState(false);
  const why = useRef<HTMLTextAreaElement>(null);
  const firstSelect = useRef<HTMLSelectElement>(null);
  const whyId = useId();
  const quote = leadQuote(draft);
  const count = materialCount(draft);
  const shown = mode === 'confirmed' && confirmed ? confirmed.values : null;
  const cites = draft.sourceReferences.flatMap((ref) => {
    const citation = draft.scores
      .flatMap((score) => (score.state === 'suggested' ? score.citations : []))
      .find((c) => JSON.stringify(c.reference) === JSON.stringify(ref));
    return citation ? [{ ref, quote: citation.quote }] : [];
  });

  const save = () => {
    const edited = isEdited(draft, values);
    if (edited && !reason.trim()) {
      setWhyMissing(true);
      why.current?.focus();
      return;
    }
    onConfirm(values, edited ? reason.trim() : '');
  };

  let foot;
  if (mode === 'confirmed')
    foot = (
      <div className="n-rcpt__foot">
        <span className="n-block__sig">{confirmed?.by}</span>
        <span className="nt-muted">
          {confirmed
            ? copy.confirm.confirmedOn(confirmed.on)
            : copy.confirm.confirmedShort}
        </span>
      </div>
    );
  else if (mode === 'others')
    foot = (
      <div className="n-rcpt__foot">
        <span className="nt-muted">
          {copy.confirm.waitFor(
            view.confirmers[draft.draftId]?.name ?? '评价人',
          )}
        </span>
      </div>
    );
  else if (editing)
    foot = (
      <div className="n-rcpt__edit">
        {draft.scores.map((score, i) => {
          const dim = view.dimensions[score.dimensionId] ?? score.dimensionId;
          if (score.state === 'unknown')
            return (
              <div className="n-rcpt__editrow" key={draftScoreKey(score)}>
                <span>{dim}</span>
                <b>{copy.confirm.insufficient}</b>
                <small>{score.reason}</small>
              </div>
            );
          const key = draftScoreKey(score);
          return (
            <label className="n-rcpt__editrow" key={key}>
              <span>{dim}</span>
              <select
                ref={i === 0 ? firstSelect : undefined}
                className="n-input"
                aria-label={copy.edit.scoreLabel(dim)}
                value={values[key]}
                disabled={busy}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [key]: Number(e.target.value) as ScoreValue,
                  }))
                }
              >
                {scoreValues.map((v) => (
                  <option key={v} value={v}>
                    {copy.edit.option(v)}
                  </option>
                ))}
              </select>
              <small>{copy.edit.aiSuggest(score.value)}</small>
            </label>
          );
        })}
        <label className={`n-field${whyMissing ? ' is-error' : ''}`}>
          <span className="n-field__label" id={whyId}>
            {copy.edit.why}
          </span>
          <textarea
            ref={why}
            className="n-textarea"
            rows={2}
            value={reason}
            disabled={busy}
            aria-invalid={whyMissing || undefined}
            placeholder={
              whyMissing ? copy.edit.whyRequired : copy.edit.whyPlaceholder
            }
            onChange={(e) => {
              setReason(e.target.value);
              if (e.target.value.trim()) setWhyMissing(false);
            }}
          />
        </label>
        <div className="nt-row">
          <button
            className="n-btn n-btn--sm n-btn--ink"
            type="button"
            disabled={busy}
            onClick={save}
          >
            {copy.edit.save}
          </button>
          <button
            className="n-btn n-btn--sm n-btn--ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setValues(suggestedValues(draft));
              setReason('');
              setWhyMissing(false);
            }}
          >
            {copy.edit.cancel}
          </button>
        </div>
      </div>
    );
  else
    foot = (
      <div className="n-rcpt__foot">
        <button
          className="n-btn n-btn--sm n-btn--ink"
          type="button"
          disabled={busy}
          onClick={() => onConfirm(suggestedValues(draft), '')}
        >
          <Icon name="check" />
          {copy.confirm.ok}
        </button>
        <button
          className="n-btn n-btn--sm n-btn--ghost"
          type="button"
          disabled={busy}
          onClick={() => {
            setEditing(true);
            requestAnimationFrame(() => firstSelect.current?.focus());
          }}
        >
          <Icon name="pen" />
          {copy.confirm.edit}
        </button>
        <span className="nt-muted">{copy.confirm.okHint}</span>
      </div>
    );

  return (
    <article
      className="n-card n-rcpt"
      data-state={mode === 'confirmed' ? 'confirmed' : 'ai'}
      id={`rc-${draft.draftId}`}
      tabIndex={-1}
      aria-busy={busy || undefined}
    >
      <div className="n-rcpt__head">
        <Who view={view} personIds={draft.personIds} />
        {count > 1 ? (
          <Badge icon="layers">{copy.confirm.merged(count)}</Badge>
        ) : null}
      </div>
      <h4 className="n-rcpt__title">
        {draft.sbi.title}
        {cites.map(({ ref, quote: text }, i) => (
          <Cite
            key={`${ref.fragmentId}:${ref.originalVersionId}`}
            index={i + 1}
            markLabel={materialLabel(receipt, ref.originalVersionId)}
            access="granted"
            quote={text}
            source={{
              kind: citeKind[ref.location.kind],
              title: materialLabel(receipt, ref.originalVersionId),
              location: formatLocation(ref),
            }}
          />
        ))}
      </h4>
      {quote ? (
        <p className="n-cite__quote n-rcpt__quote">
          {quote.quote}
          <small>{sourceLine(receipt, quote.reference)}</small>
        </p>
      ) : null}
      <div className="n-rcpt__scores">
        {draft.scores.map((score) => {
          const dim = view.dimensions[score.dimensionId] ?? score.dimensionId;
          if (score.state === 'unknown')
            return (
              <div className="n-rcpt__score" key={draftScoreKey(score)}>
                <span className="n-score__dim">{dim}</span>
                <Badge className="n-badge--unknown" icon="dash">
                  {copy.confirm.insufficient}
                </Badge>
                <small>{score.reason}</small>
              </div>
            );
          const ai = score.value as ScoreValue;
          const value = shown?.[draftScoreKey(score)] ?? ai;
          const note = copy.confirm.anchorNote(ai, score.anchor.text);
          return (
            <div className="n-rcpt__score" key={draftScoreKey(score)}>
              <span className="n-score__dim">{dim}</span>
              {shown ? (
                <Score
                  inline
                  state="confirmed"
                  dimension={dim}
                  value={value}
                  by={confirmed!.by}
                />
              ) : (
                <Score inline state="suggested" dimension={dim} value={ai} />
              )}
              <b>{value}</b>
              {shown ? (
                value !== ai ? (
                  <small>{copy.confirm.aiOriginal(ai)}</small>
                ) : null
              ) : (
                <Src kind="ai" label="AI 建议" />
              )}
              <small>{note}</small>
            </div>
          );
        })}
      </div>
      {problem ? (
        <p className="n-field__err" role="alert">
          {problem.message}
          {problem.reload ? (
            <>
              {' '}
              <button type="button" className="n-link" onClick={onReload}>
                {copy.problem.reload}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {foot}
    </article>
  );
}

/** 还没认出是谁的一处，或已标为名单外的人：只给原件里的这一处，不显示标题和建议分。 */
export function HeldItem({
  state,
  who,
  quote,
  source,
}: {
  state: 'held' | 'skipped';
  who: string | null;
  quote: string | null;
  source: string | null;
}) {
  return (
    <article className="n-card n-rcpt" data-state={state}>
      <div className="n-rcpt__head">
        <span
          className="n-avatar n-avatar--sm"
          style={{ background: 'var(--sheet-sunk)' }}
        >
          ?
        </span>
        <b>{who ?? copy.review.title}</b>
        <Badge icon="user">
          {state === 'held' ? copy.confirm.held : copy.confirm.skipped}
        </Badge>
      </div>
      {quote || source ? (
        <p className="n-cite__quote n-rcpt__quote">
          {quote}
          {source ? <small>{source}</small> : null}
        </p>
      ) : null}
      <div className="n-rcpt__foot">
        <span className="nt-muted">
          {state === 'held'
            ? copy.confirm.heldNote(who ?? copy.confirm.heldWho)
            : copy.confirm.skippedNote}
        </span>
        {state === 'held' ? <Badge>{copy.review.pending}</Badge> : null}
      </div>
    </article>
  );
}
