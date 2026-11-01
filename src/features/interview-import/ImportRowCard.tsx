import type { CSSProperties } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ImportScale } from './ImportScale';
import {
  candidateStatusLabel,
  monthDay,
  pagesText,
  stateBadge,
  unreadReasonText,
} from './copy';
import { rowState, type ImportRow } from './model';

/** Where a review item opens (the review list, prototype Y inbox.html#id). */
const reviewHref = (itemId: string) => `/inbox#${itemId}`;

export type RowActions = {
  confirm(ok: boolean): void;
  fill(item: string, value: string): void;
  send(): void;
};

/** One candidate still to settle (prototype Y import.js rowCard). */
export function ImportRowCard({
  row,
  busy,
  flash,
  on,
}: {
  row: ImportRow;
  /** A change to this row is being saved. */
  busy: boolean;
  /** The row was just confirmed. */
  flash: boolean;
  on: RowActions;
}) {
  const state = rowState(row);
  if (state === 'skip' || state === 'dup')
    throw new Error('Skipped rows are listed apart');
  const [label, tone] = stateBadge[state];
  const match = row.match;
  return (
    <article
      className={`n-card n-ivrow${flash ? ' nt-flash' : ''}`}
      data-state={state}
      id={`iv-${row.rowId}`}
    >
      <div className="n-ivrow__head">
        <span className="n-ivrow__page">{pagesText(row.pages)}</span>
        <b className="n-ivrow__name">{row.observedName}</b>
        <span className="nt-muted">
          北森 · {candidateStatusLabel[row.candidateStatus]}
        </span>
        <Badge tone={tone}>{label}</Badge>
      </div>
      {match ? (
        <div className="n-ivrow__match">
          <Avatar name={match.name} hue={match.hue} photo={match.photo} />
          <span>
            人员目录：<b>{match.name}</b>
            <Badge tone="demo">演示</Badge>
            <small>
              {match.org} · {match.title} · {monthDay(match.joinedOn)} 入职
            </small>
          </span>
        </div>
      ) : (
        <div className="n-ivrow__match">
          <span
            aria-hidden="true"
            className="n-avatar n-avatar--sm"
            style={
              { '--hue': 0, background: 'var(--sheet-sunk)' } as CSSProperties
            }
          >
            ?
          </span>
          <span>
            人员目录里查到 0 人
            <small>
              北森状态是{candidateStatusLabel[row.candidateStatus]}
              ；同步后再核对一次
            </small>
          </span>
        </div>
      )}
      <div className="n-ivrow__meta">
        {row.template.name} · {row.template.scale} ·{' '}
        {monthDay(row.interviewedOn)} 面试 ·{' '}
        {row.interviewer.status === 'matched' ? (
          `面试官 ${row.interviewer.name}`
        ) : (
          <>
            面试官「{row.interviewer.observedName}」待核对{' '}
            <a
              className="n-link"
              href={reviewHref(row.interviewer.reviewItemId)}
            >
              去核对
            </a>
          </>
        )}
      </div>
      <ImportScale row={row} />
      {row.scale.map(({ item, selection }) =>
        selection.status === 'unrecognized' ? (
          <div className="n-ivunread" key={item}>
            <figure
              className="n-pdfcrop"
              aria-label={`第 ${selection.page} 页「${item}」一栏的页面图`}
            >
              <figcaption>
                第 {selection.page} 页 · {item}
              </figcaption>
              <div className="n-pdfcrop__opts">
                {selection.options.map((option) => (
                  <span
                    key={option}
                    className={
                      selection.marked.includes(option) ? 'is-on' : undefined
                    }
                  >
                    <i />
                    {option}
                  </span>
                ))}
              </div>
            </figure>
            <label className="n-field">
              <span className="n-field__label">
                「{item}」待补录：{unreadReasonText[selection.reason]}
                ，对照页面图选一个
              </span>
              <select
                className="n-input"
                value={row.filled[item] ?? ''}
                disabled={busy}
                onChange={(event) => on.fill(item, event.target.value)}
              >
                <option value="">选一个</option>
                {selection.options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
          </div>
        ) : null,
      )}
      {row.comment ? (
        <p className="n-ivrow__note">
          <Icon name="quote" size={13} />
          {row.comment}
          {row.redacted ? (
            <small>已隐去 {row.redacted} 处学历类描述</small>
          ) : null}
        </p>
      ) : null}
      <Actions row={row} state={state} busy={busy} on={on} />
    </article>
  );
}

function Actions({
  row,
  state,
  busy,
  on,
}: {
  row: ImportRow;
  state: ReturnType<typeof rowState>;
  busy: boolean;
  on: RowActions;
}) {
  const name = row.match?.name;
  let acts = null;
  if (state === 'confirm')
    acts = (
      <button
        className="n-btn n-btn--sm n-btn--ink"
        type="button"
        disabled={busy}
        onClick={() => on.confirm(true)}
      >
        <Icon name="check" />是{name}
      </button>
    );
  else if (state === 'confirmed')
    acts = (
      <>
        <Badge tone="yes" icon="check">
          已确认是{name}
        </Badge>
        <button
          className="n-link"
          type="button"
          disabled={busy}
          onClick={() => on.confirm(false)}
        >
          改回
        </button>
      </>
    );
  else if (state === 'unknown')
    acts = (
      <button
        className="n-btn n-btn--sm"
        type="button"
        disabled={busy}
        onClick={on.send}
      >
        <Icon name="spark" />
        放进待核对
      </button>
    );
  else if (state === 'sent' && row.reviewItemId)
    acts = (
      <a
        className="n-btn n-btn--sm n-btn--ghost"
        href={reviewHref(row.reviewItemId)}
      >
        查看待核对
      </a>
    );
  else if (state === 'verify' && row.interviewer.status === 'pending')
    acts = (
      <a
        className="n-btn n-btn--sm"
        href={reviewHref(row.interviewer.reviewItemId)}
      >
        关联面试官
      </a>
    );
  return acts ? <div className="n-ivrow__acts">{acts}</div> : null;
}
