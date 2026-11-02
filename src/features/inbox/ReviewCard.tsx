'use client';
import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Icon, type IconName } from '@/components/ui/Icon';
import { notConnected } from './copy';
import {
  KIND_LABEL,
  hueOf,
  placeText,
  question,
  type PageItem,
  type People,
  type Resolution,
} from './view';

type Pick = (resolution: Resolution, choice: string) => void;

const tile: CSSProperties = { '--hue': 220, borderRadius: 6 } as CSSProperties;
const blank: CSSProperties = {
  '--hue': 0,
  background: 'var(--sheet-sunk)',
} as CSSProperties;

/** One choice button, as the prototype's `.n-choice`. */
function Choice({
  id,
  picked,
  disabled,
  mark,
  label,
  note,
  onPick,
}: {
  id: string;
  picked: string | null;
  disabled: boolean;
  mark: ReactNode;
  label: string;
  note?: ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      className={`n-choice${picked === id ? ' is-picked' : ''}`}
      type="button"
      data-v={id}
      disabled={disabled}
      onClick={onPick}
    >
      {mark}
      {label}
      <small>{note}</small>
    </button>
  );
}

const iconMark = (name: IconName, style: CSSProperties = tile) => (
  <span className="n-avatar n-avatar--sm" style={style} aria-hidden="true">
    <Icon name={name} size={12} />
  </span>
);
const unknownMark = (
  <span className="n-avatar n-avatar--sm" style={blank} aria-hidden="true">
    ?
  </span>
);

/** The prototype's search field. Directory lookups have no read yet, so the field
 * stays visible and disabled, and its label says so. */
function Search({
  label,
  style = { margin: 'var(--s-1) 0' },
}: {
  label: string;
  style?: CSSProperties;
}) {
  return (
    <label className="n-field" style={style}>
      <span className="n-field__label">
        {label} · {notConnected.search}
      </span>
      <input className="n-input" autoComplete="off" disabled />
    </label>
  );
}

/**
 * One question at a time: quote where the contract has one, then pick one answer.
 * The card never decides who may answer; the server sent only items this viewer
 * may resolve, with authorized candidates.
 */
export function ReviewCard({
  item,
  people,
  picked,
  busy,
  error,
  onPick,
}: {
  item: PageItem;
  people: People;
  /** The choice in flight, drawn as picked until the page settles. */
  picked: string | null;
  busy: boolean;
  error: string | null;
  onPick: Pick;
}) {
  const head = (
    <span className="n-src n-src--ai">
      <Icon name="spark" />
      待核对 · {KIND_LABEL[item.kind]}
      {item.source ? ` · ${placeText(item.source.location)}` : null}
    </span>
  );
  const later = (label: string) => (
    <Choice
      id="defer"
      picked={picked}
      disabled={busy}
      mark={unknownMark}
      label={label}
      onPick={() => onPick({ action: 'defer' }, 'defer')}
    />
  );
  const person = (personId: string, resolution: Resolution, note?: string) => (
    <Choice
      key={personId}
      id={personId}
      picked={picked}
      disabled={busy}
      mark={<Avatar name={people[personId] ?? '?'} hue={hueOf(personId)} />}
      label={people[personId] ?? '已选的人'}
      note={note}
      onPick={() => onPick(resolution, personId)}
    />
  );

  let body: ReactNode;
  switch (item.kind) {
    case 'speaker':
      body = (
        <>
          <div
            className="n-cite__quote"
            style={{ marginBottom: 'var(--s-3)', fontSize: 'var(--t-sm)' }}
          >
            {item.quote}
          </div>
          <p className="nt-muted" style={{ margin: '0 0 var(--s-2)' }}>
            选完后，这位说话人在这段
            {item.source.location.kind === 'video' ? '录像' : '录音'}
            里说的话都归到这个人。
          </p>
          <div className="n-choices">
            {item.candidates.map((candidate) =>
              person(candidate.personId, {
                action: 'bind',
                personId: candidate.personId,
              }),
            )}
            {later('都不是，稍后处理')}
          </div>
        </>
      );
      break;
    case 'unknown_person':
      body = (
        <div className="n-choices">
          {item.candidates.map((candidate) =>
            person(candidate.personId, {
              action: 'bind_people',
              personIds: [candidate.personId],
            }),
          )}
          <Search label="在名单里找" />
          <Choice
            id="keep_original_only"
            picked={picked}
            disabled={busy}
            mark={iconMark('dash', blank)}
            label="名单外的人"
            note="只保留在原件里"
            onPick={() =>
              onPick({ action: 'keep_original_only' }, 'keep_original_only')
            }
          />
          {later('都不是，稍后处理')}
        </div>
      );
      break;
    case 'image_scope':
      body = (
        <div className="n-choices">
          <Choice
            id="confirm_scope"
            picked={picked}
            disabled
            mark={iconMark('check')}
            label="整理框出的范围"
            note={notConnected.scope}
            onPick={() => undefined}
          />
          <Choice
            id="keep_attachment_only"
            picked={picked}
            disabled={busy}
            mark={iconMark('clip')}
            label="整张只作附件"
            note="只给对整张图有权限的人看"
            onPick={() =>
              onPick({ action: 'keep_attachment_only' }, 'keep_attachment_only')
            }
          />
          {later('稍后处理')}
        </div>
      );
      break;
    case 'unknown_interviewer':
      body = (
        <>
          <Search
            label="在人员目录里找"
            style={{ marginBottom: 'var(--s-2)' }}
          />
          {/* As the prototype: the directory matches, then 稍后处理. The contract's
              candidates stand in for the matches until the search read exists. */}
          <div className="n-choices">
            <div className="n-choices">
              {item.candidates.map((candidate) =>
                person(candidate.personId, {
                  action: 'link_existing_interviewer',
                  personId: candidate.personId,
                }),
              )}
            </div>
            {later('稍后处理')}
          </div>
          <p className="nt-caption" style={{ marginTop: 'var(--s-2)' }}>
            关联到目录里的人以后，面评那一行才能导入。
          </p>
        </>
      );
      break;
  }

  return (
    <article
      className="n-card n-verify"
      data-item={item.itemId}
      id={item.itemId}
      aria-busy={busy}
    >
      {head}
      <p className="n-verify__q" style={{ marginTop: 'var(--s-2)' }}>
        {question(item)}
      </p>
      {body}
      {error ? (
        <p role="alert" className="nt-field-error">
          {error}
        </p>
      ) : null}
    </article>
  );
}
