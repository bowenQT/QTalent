'use client';
import { useCallback, useEffect, useState } from 'react';
import type { Person } from '@/contracts/person';
import { Badge } from '@/components/ui/Badge';
import { Src } from '@/components/ui/Src';
import { formatLocation } from '@/features/sources/source-format';
import { SourceCite, type LoadSource } from '@/features/sources/SourceCite';
import { BlockState } from './BlockState';
import { PersonEventCard } from './PersonEventCard';
import {
  monthDay,
  timelineMonths,
  type KeyEvent,
  type TimelineEntry,
} from './person-view';

const PREFIX = '#ev-';
/** 条目上写的出处位置；基线来源没有原文位置时只留角标，不把「快照字段」写给用户。 */
function placeText(entry: TimelineEntry) {
  const location = entry.sources[0].location;
  return location.kind === 'snapshot_field' && !location.originalLocation
    ? null
    : formatLocation(location);
}
const cardId = (id: string) => `tl-card-${id}`;

function KeyEventMeta({ event }: { event: KeyEvent }) {
  const count = event.sources.length;
  return (
    <>
      <Src kind="obs" />
      {event.recorderName}
      {count > 1 ? (
        <>
          {' · '}
          <b style={{ color: 'var(--ink-2)' }}>{count} 个来源</b>
          （同一件事，只计一次）
        </>
      ) : null}
      {event.participants
        ? ` · 多人事件 · ${event.participants
            .map((person) =>
              person.role ? `${person.name}（${person.role}）` : person.name,
            )
            .join('、')} · 各自按本人行为打分`
        : null}
      {event.projectName ? ` · ${event.projectName}` : null}
    </>
  );
}

function Entry({
  entry,
  open,
  onToggle,
  loadSource,
}: {
  entry: TimelineEntry;
  open: boolean;
  onToggle: (id: string) => void;
  loadSource: LoadSource;
}) {
  const dot =
    entry.kind === 'history'
      ? ' is-hist'
      : entry.kind === 'self_report'
        ? ' is-self'
        : '';
  const restricted =
    entry.kind === 'history' && entry.category === 'performance';
  const cite = (
    <SourceCite source={entry.sources[0]} index={1} loadSource={loadSource} />
  );
  return (
    <li className="n-tl__item" id={`ev-${entry.id}`}>
      <span className="n-tl__date">{monthDay(entry.occurredOn)}</span>
      <span className={`n-tl__dot${dot}`}></span>
      <div className="n-tl__body">
        <div className="n-tl__title">
          {entry.kind === 'key_event' ? (
            <>
              <button
                className="nt-tl-open"
                type="button"
                aria-expanded={open}
                aria-controls={cardId(entry.id)}
                onClick={() => onToggle(entry.id)}
              >
                {entry.title}
              </button>
              {entry.pendingScoreCount ? (
                <>
                  {' '}
                  <Badge tone="ai" icon="spark">
                    {entry.pendingScoreCount} 项待确认
                  </Badge>
                </>
              ) : null}
              {entry.scores.some((score) => score.state === 'conflict') ? (
                <>
                  {' '}
                  <Badge tone="conflict" icon="split">
                    待校准
                  </Badge>
                </>
              ) : null}
            </>
          ) : (
            entry.title
          )}
        </div>
        <div className="n-tl__meta">
          {entry.kind === 'key_event' ? (
            <KeyEventMeta event={entry} />
          ) : entry.kind === 'self_report' ? (
            <>
              <Src kind="self" />
              {placeText(entry)}
              {cite}
            </>
          ) : restricted ? (
            <>
              <Badge icon="lock">管理受限</Badge>
              <Badge>含评价成分</Badge>不当作客观事实{cite}
            </>
          ) : (
            <>
              <Src kind="fact" label="历史资料" />
              {placeText(entry)}
              {cite}
            </>
          )}
        </div>
        {entry.kind === 'history' ? (
          <>
            <div className="n-scale">
              {entry.scale.map(([key, value], index) => (
                <span key={index}>
                  {key} {value}
                </span>
              ))}
            </div>
            {restricted ? null : (
              <div className="n-tl__note">
                保留原量表，AI 打分时可以引用其中的文字评价。
              </div>
            )}
          </>
        ) : null}
        {entry.kind === 'key_event' ? (
          <div className="nt-tl-card" id={cardId(entry.id)} hidden={!open}>
            <PersonEventCard event={entry} loadSource={loadSource} />
          </div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * 时间线：按事件真实发生的日期倒序、按月分组。地址带 `#ev-…` 进入，或站内点到某条事件
 * 的链接时，先展开那一条，再把焦点交给它的展开按钮。
 */
export function Timeline({
  timeline,
  asOf,
  loadSource,
}: {
  timeline: Person['timeline'];
  asOf: string;
  loadSource: LoadSource;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // 要展开并滚到的条目；展开提交之后再滚动、聚焦，不依赖动画帧（后台标签页不触发）。
  const [target, setTarget] = useState<{ id: string; focus: boolean } | null>(
    null,
  );
  const reveal = useCallback((hash: string, focus: boolean) => {
    if (!hash.startsWith(PREFIX)) return;
    const id = decodeURIComponent(hash.slice(PREFIX.length));
    if (!document.getElementById(`ev-${id}`)?.querySelector('.nt-tl-open'))
      return;
    setOpen((current) => new Set(current).add(id));
    setTarget({ id, focus });
  }, []);
  useEffect(() => {
    if (!target) return;
    const item = document.getElementById(`ev-${target.id}`);
    item?.scrollIntoView({ block: 'start', behavior: 'auto' });
    if (target.focus)
      item
        ?.querySelector<HTMLButtonElement>('.nt-tl-open')
        ?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    // 进入页面时地址已带 `#ev-…`：放到下一轮任务里展开，不在 effect 里同步改状态。
    const initial = setTimeout(() => reveal(window.location.hash, false));
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.(
        `a[href^="${PREFIX}"]`,
      );
      if (link) reveal(link.getAttribute('href') ?? '', true);
    };
    const onHash = () => reveal(window.location.hash, false);
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    return () => {
      clearTimeout(initial);
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
    };
  }, [reveal]);

  const entries = timeline.status === 'ready' ? timeline.data : [];
  const keyEvents = entries.filter((entry) => entry.kind === 'key_event');
  return (
    <article className="n-card" id="timeline">
      <h3 className="n-section-title">
        时间线
        <small
          className="nt-muted"
          style={{ fontWeight: 400, marginLeft: 'auto' }}
        >
          {keyEvents.length} 条关键事件 · 按事件真实发生的时间
        </small>
      </h3>
      {timeline.status === 'ready' ? (
        <ol className="n-tl">
          {timelineMonths(entries, asOf).flatMap((month) => [
            <li key={`m-${month.label}`} className="n-tl__month">
              {month.label}
            </li>,
            ...month.entries.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                open={open.has(entry.id)}
                onToggle={toggle}
                loadSource={loadSource}
              />
            )),
          ])}
        </ol>
      ) : (
        <BlockState block={timeline} empty="记录后的事件会出现在这里" />
      )}
    </article>
  );
}
