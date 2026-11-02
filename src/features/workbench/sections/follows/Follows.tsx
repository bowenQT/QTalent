'use client';
import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Seg } from '@/components/ui/Seg';
import type { FollowsView, WorkbenchView } from '../../view';
import { followUpdatesEmpty, followsEmpty, managerPending } from '../../copy';
import { PendingCard } from '../../PendingCard';
import { personHref } from '../../send';

const neutralHue = 220;
/** `2026-09-02` → `09-02`, as in the prototype. */
const monthDay = (on: string) => on.slice(5);

function FollowList({ follows }: { follows: FollowsView }) {
  const [mode, setMode] = useState<'feed' | 'list'>('feed');
  const { people, updates } = follows;
  return (
    <article
      className="n-card n-follows"
      id="follows"
      aria-labelledby="follows-h"
    >
      <div className="n-follows__head">
        <h3 className="n-section-title" id="follows-h">
          我的关注
          <span className="n-count is-quiet">{people.length} 人</span>
        </h3>
        {people.length ? (
          <Seg
            label="查看方式"
            value={mode}
            onValueChange={setMode}
            items={[
              { value: 'feed', label: '动态' },
              { value: 'list', label: '名单' },
            ]}
          />
        ) : null}
      </div>
      {!people.length ? (
        <div className="nt-empty">{followsEmpty}</div>
      ) : mode === 'list' ? (
        <ul className="n-follows__list">
          {people.map((person) => (
            <li key={person.id}>
              <a href={personHref(person.id)}>
                <Avatar
                  name={person.name}
                  hue={person.hue ?? neutralHue}
                  photo={person.photo}
                />
                <span>
                  <b>{person.name}</b>
                  <small>
                    {monthDay(person.followedOn)} 关注
                    {person.latest ? ` · 最近：${person.latest}` : ''}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : updates.length ? (
        <ol className="n-feed">
          {updates.map((update) => (
            <li key={`${update.personId}-${update.on}-${update.text}`}>
              <a href={personHref(update.personId)}>
                <Avatar
                  name={update.name}
                  hue={update.hue ?? neutralHue}
                  photo={update.photo}
                />
                <span>
                  <b>{update.name}</b> {update.text}
                  <small>
                    {monthDay(update.on)} · {update.kind}
                    {update.by ? ` · ${update.by}` : ''}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <div className="nt-empty">{followUpdatesEmpty}</div>
      )}
    </article>
  );
}

/** 我的关注: the viewer's own list, updates newest first; only the viewer sees it. */
export function Follows({ view }: { view: WorkbenchView }) {
  const block = view.manager?.follows;
  if (!block) return null;
  if (block.status !== 'ready')
    return (
      <PendingCard
        className="n-follows"
        id="follows"
        title="我的关注"
        text={managerPending.follows}
      />
    );
  return <FollowList follows={block.data} />;
}
