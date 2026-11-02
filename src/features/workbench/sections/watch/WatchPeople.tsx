'use client';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Chips } from '@/components/ui/Chips';
import { Icon } from '@/components/ui/Icon';
import type { WatchCategory, WatchPerson, WorkbenchView } from '../../view';
import { managerPending, watchCategories, watchEmpty } from '../../copy';
import { PendingCard } from '../../PendingCard';
import { personHref } from '../../send';

// Avatars are not colored per person (v1.5 3.32); the stylesheet's default hue.
const neutralHue = 220;
const label = Object.fromEntries(
  watchCategories.map(([value, text]) => [value, text]),
) as Record<WatchCategory, string>;
const note = Object.fromEntries(
  watchCategories.map(([value, , hint]) => [value, hint]),
) as Record<WatchCategory, string>;

function Row({ person }: { person: WatchPerson }) {
  const href = personHref(person.id);
  return (
    <li className="n-watch__item" data-cat={person.category}>
      <a className="n-watch__ava" href={href} tabIndex={-1} aria-hidden="true">
        <Avatar
          name={person.name}
          hue={person.hue ?? neutralHue}
          photo={person.photo}
          size=""
        />
      </a>
      <div className="n-watch__body">
        <div className="n-watch__who">
          <a className="nt-plink" href={href}>
            <b>{person.name}</b>
          </a>
          <span className="n-watch__meta">
            {person.title}
            {person.fate ? (
              <>
                {' · '}
                <span className={person.fate.open ? 'is-open' : undefined}>
                  {person.fate.text}
                </span>
              </>
            ) : null}
          </span>
        </div>
        <div className="n-watch__why">
          {person.verifiedBy ? (
            <span
              className="n-watch__ai"
              title={`AI 线索，${person.verifiedBy}已核实`}
            >
              AI
            </span>
          ) : null}
          {person.brief}
        </div>
      </div>
      <div className="n-watch__acts">
        <a className="n-watch__go" href={href}>
          查看依据
          <Icon name="chev" />
        </a>
      </div>
    </li>
  );
}

/**
 * 值得关注的人, in the order the read returns them (by trigger time). Under 全部,
 * 需要介入 folds into one line at the top and the other two groups show two each;
 * a single category shows five. No score, rank or quadrant appears here.
 */
function WatchList({ people }: { people: WatchPerson[] }) {
  const [category, setCategory] = useState<WatchCategory | 'all'>('all');
  const [all, setAll] = useState(false);
  const grouped = category === 'all';
  const list = grouped
    ? people
    : people.filter((person) => person.category === category);
  const per = all ? Infinity : grouped ? 2 : 5;
  const acts = grouped
    ? list.filter((person) => person.category === 'act')
    : [];
  const groups = (grouped ? (['top', 'new'] as const) : [category])
    .map(
      (key) => [key, list.filter((person) => person.category === key)] as const,
    )
    .filter(([, members]) => members.length);
  const hidden = groups.reduce(
    (sum, [, members]) => sum + Math.max(0, members.length - per),
    0,
  );
  const pick = (value: string) => {
    setCategory(value as WatchCategory | 'all');
    setAll(false);
  };
  return (
    <article className="n-card n-watch" id="watch" aria-labelledby="watch-h">
      <div className="n-watch__head">
        <h3 className="n-section-title" id="watch-h">
          值得关注的人
          <span className="n-count is-quiet">{people.length} 人</span>
        </h3>
      </div>
      <Chips
        label="按类别筛选"
        selected={[category]}
        onSelect={pick}
        items={[
          { value: 'all', label: '全部' },
          ...watchCategories.map(([value, text]) => ({
            value,
            label: <span title={note[value]}>{text}</span>,
            disabled: !people.some((person) => person.category === value),
          })),
        ]}
      />
      {acts.length ? (
        <p className="n-watch__alert">
          <Icon name="flag" />
          <span>
            <button
              className="n-link"
              type="button"
              onClick={() => pick('act')}
            >
              {acts.length} 人需要介入
            </button>
            ，HR 在跟：
            {acts.map((person, index) => (
              <span key={person.id}>
                {index ? '、' : ''}
                <a className="nt-plink" href={personHref(person.id)}>
                  {person.name}
                </a>
                {person.concern ? `（${person.concern}）` : ''}
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {groups.length ? (
        groups.map(([key, members]) => (
          <section className="n-watch__group" aria-label={label[key]} key={key}>
            {grouped ? (
              <h4 className="n-watch__glabel" title={note[key]}>
                {label[key]}
                <span>{members.length}</span>
              </h4>
            ) : null}
            <ul className="n-watch__list">
              {members.slice(0, per).map((person) => (
                <Row key={person.id} person={person} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="nt-empty">{watchEmpty}</div>
      )}
      {hidden || all ? (
        <div className="n-watch__foot">
          <button
            className="n-link"
            type="button"
            aria-expanded={all}
            onClick={() => setAll(!all)}
          >
            {all ? '收起' : `再看 ${hidden} 人`}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function WatchPeople({ view }: { view: WorkbenchView }) {
  const block = view.manager?.watch;
  if (!block) return null;
  if (block.status !== 'ready')
    return (
      <PendingCard
        className="n-watch"
        id="watch"
        title="值得关注的人"
        text={managerPending.watch}
      />
    );
  return <WatchList people={block.data} />;
}
