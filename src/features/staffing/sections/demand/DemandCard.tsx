'use client';
import { useId, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { StaffingDemand } from '@/contracts/staffing';
import type { ProjectHead } from '../../view';
import {
  addPlaceholder,
  confirmButton,
  confirmCaption,
  confirmedLine,
  demandBadge,
  demandCaption,
} from '../../copy';
import { formatDay } from '../../format';

export const MAX_REQUIREMENT_LENGTH = 200;

/**
 * The demand card: the AI draft of the requirements, which the viewer edits and then
 * confirms. Rewriting a requirement into its looser form (`.nt-req`) and the role row are
 * not rendered: the contract has neither alternatives nor roles.
 */
export function DemandCard({
  demand,
  project,
  busy,
  error,
  onToggle,
  onAdd,
  onConfirm,
}: {
  demand: StaffingDemand;
  project: ProjectHead;
  busy: boolean;
  error: string | null;
  onToggle: (requirementId: string) => void;
  /** Resolves true once the requirement is on the card, so the field can be cleared. */
  onAdd: (text: string) => Promise<boolean>;
  onConfirm: () => void;
}) {
  const [draft, setDraft] = useState('');
  const errorId = useId();
  async function add() {
    const text = draft.trim();
    if (!text || busy) return;
    if (demand.requirements.some((item) => item.text === text)) {
      setDraft('');
      return;
    }
    // Clear only what was saved; anything typed while saving stays in the field.
    if (await onAdd(text))
      setDraft((current) => (current.trim() === text ? '' : current));
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void add();
    }
  }
  return (
    <article className="n-card" id="needcard" aria-busy={busy}>
      <div
        className="nt-row"
        style={{ justifyContent: 'space-between', marginBottom: 'var(--s-2)' }}
      >
        <h3 className="n-section-title" style={{ margin: 0 }}>
          需求卡
        </h3>
        <span className="n-src n-src--ai">
          <Icon name="spark" />
          {demandBadge}
        </span>
      </div>
      <p className="nt-muted" style={{ margin: '0 0 var(--s-3)' }}>
        来自：「{demand.inputText}」
      </p>
      <dl className="nt-dl" style={{ marginBottom: 'var(--s-3)' }}>
        <dt>项目</dt>
        <dd>
          {project.name} · {project.status}
        </dd>
      </dl>
      <ul className="n-reqs" id="reqs">
        {demand.requirements.map((item) => {
          const required = item.priority === 'required';
          return (
            <li key={item.id}>
              <button
                className={`n-badge ${required ? '' : 'n-badge--demo'}`}
                type="button"
                style={{ border: 0, cursor: 'pointer' }}
                aria-label={`${item.text}：${required ? '必须' : '加分'}，切换为${required ? '加分项' : '必须项'}`}
                disabled={busy}
                onClick={() => onToggle(item.id)}
              >
                {required ? '必须' : '加分'}
              </button>
              <span>{item.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
        <input
          className="n-input"
          id="reqadd"
          style={{ flex: 1, minWidth: '12em', height: 32 }}
          placeholder={addPlaceholder}
          aria-label="补一句要求"
          aria-describedby={error ? errorId : undefined}
          maxLength={MAX_REQUIREMENT_LENGTH}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className="n-btn n-btn--sm"
          type="button"
          id="reqadd-go"
          disabled={busy}
          onClick={() => void add()}
        >
          <Icon name="plus" />
          加上
        </button>
      </div>
      <p className="nt-caption">{demandCaption}</p>
      {error ? (
        <p id={errorId} role="alert" className="nt-field-error">
          {error}
        </p>
      ) : null}
      {demand.status === 'draft' ? (
        <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
          <button
            className="n-btn n-btn--sm n-btn--ink"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            <Icon name="check" />
            {confirmButton}
          </button>
          <span className="nt-muted">{confirmCaption}</span>
        </div>
      ) : (
        <p className="nt-muted" style={{ margin: 'var(--s-3) 0 0' }}>
          {confirmedLine(
            demand.confirmedBy.name,
            formatDay(demand.confirmedAt),
          )}
        </p>
      )}
    </article>
  );
}
