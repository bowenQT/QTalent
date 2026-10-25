'use client';
import { Fragment, useId, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { scoreValues, type ScoreValue } from './Score';

export type SpectrumEvent = {
  value: ScoreValue;
  dateLabel: string;
  by: string;
  title: string;
  /** Optional link to the event on the person's timeline. */
  href?: string;
  calibrated?: boolean;
  /** Within the last three months; older events are muted. */
  recent: boolean;
};

/** Event counts per score value, split into earlier and the last three months. */
export type SpectrumBins = Partial<
  Record<ScoreValue, { earlier: number; recent: number }>
>;

export type SpectrumDimension = { id: string; name: string } & (
  | {
      state: 'scored';
      bins: SpectrumBins;
      /** The events listed when the row opens; usually a recent subset of all counted events. */
      events: readonly SpectrumEvent[];
    }
  | {
      state: 'insufficient';
      /** What is still needed, e.g. 还没有受挫后如何反应的事件. */
      missing: string;
    }
);

export type SpectrumGroup = {
  title: string;
  dimensions: readonly SpectrumDimension[];
};

const position = (value: number) => ((value - 1) / 4) * 100;

function summarize(bins: SpectrumBins) {
  let count = 0;
  let sum = 0;
  for (const value of scoreValues) {
    const bin = bins[value];
    if (!bin) continue;
    const all = bin.earlier + bin.recent;
    count += all;
    sum += value * all;
  }
  if (count === 0)
    throw new Error('A scored dimension needs at least one counted event');
  return { count, mean: sum / count };
}

function ScoredRow({
  dimension,
  bins,
  events,
  open,
  onToggle,
}: {
  dimension: SpectrumDimension;
  bins: SpectrumBins;
  events: readonly SpectrumEvent[];
  open: boolean;
  onToggle: () => void;
}) {
  const listId = useId();
  const { count, mean } = summarize(bins);
  return (
    <>
      <button
        type="button"
        className="n-spectrum__row"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${dimension.name}，均值 ${mean.toFixed(1)}，${count} 条事件，点开查看`}
        onClick={onToggle}
      >
        <span className="n-spectrum__dim">
          <Icon name="chev" />
          {dimension.name}
        </span>
        <span className="n-spectrum__track" aria-hidden="true">
          {scoreValues.map((value) => (
            <i
              key={value}
              className="n-spectrum__tick"
              style={{ left: `${position(value)}%` }}
            />
          ))}
          {scoreValues.map((value) => {
            const bin = bins[value];
            const all = bin ? bin.earlier + bin.recent : 0;
            if (!bin || all === 0) return null;
            const outer = Math.min(30, 10 + 6 * Math.sqrt(all - 1));
            const inner = bin.recent
              ? Math.max(6, outer * Math.sqrt(bin.recent / all))
              : 0;
            return (
              <Fragment key={value}>
                <span
                  className="n-spectrum__bin"
                  style={{
                    left: `${position(value)}%`,
                    width: outer,
                    height: outer,
                  }}
                  title={`${value} 分：${all} 条，其中近 3 个月 ${bin.recent} 条`}
                >
                  <i style={{ width: inner, height: inner }} />
                </span>
                {all > 1 ? (
                  <em
                    className="n-spectrum__count"
                    style={{ left: `${position(value)}%` }}
                  >
                    {all}
                  </em>
                ) : null}
              </Fragment>
            );
          })}
          <i
            className="n-spectrum__mean"
            style={{ left: `${position(mean)}%` }}
          />
        </span>
        <span className="n-spectrum__stat">
          <b>{mean.toFixed(1)}</b>
          <span className="cnt">
            {count} 条{count < 2 ? ' · 证据少' : ''}
          </span>
        </span>
      </button>
      <ul className="n-spectrum__list" id={listId} hidden={!open}>
        {events.map((event, index) => (
          <li key={index} className={event.recent ? undefined : 'is-old'}>
            <b>{event.value}</b>
            <span>{event.dateLabel}</span>
            <span>{event.by}</span>
            <span>
              {event.href ? (
                <a href={event.href}>{event.title}</a>
              ) : (
                event.title
              )}
              {event.calibrated ? ' · 已校准' : ''}
            </span>
          </li>
        ))}
        {count > events.length ? (
          <li className="more">
            还有 {count - events.length} 条，打开档案时间线查看
          </li>
        ) : null}
      </ul>
    </>
  );
}

/**
 * Per-dimension spread of confirmed event scores. Each row has its own mean; there is no
 * cross-dimension total, ranking or percentage, and a dimension without scores is drawn
 * as missing material rather than as a low score.
 */
export function Spectrum({
  groups,
  header,
}: {
  groups: readonly SpectrumGroup[];
  /** Page-level head (person, miniquad); the component owns only the chart. */
  header?: ReactNode;
}) {
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <article className="n-card n-spectrum">
      {header ? <div className="n-spectrum__head">{header}</div> : null}
      <div className="n-spectrum__scale">
        <span></span>
        <div className="n-spectrum__ticks">
          {scoreValues.map((value) => (
            <span key={value} style={{ left: `${position(value)}%` }}>
              {value}
            </span>
          ))}
        </div>
        <span></span>
      </div>
      <div>
        {groups.map((group) => (
          <Fragment key={group.title}>
            <div className="n-spectrum__group">{group.title}</div>
            {group.dimensions.map((dimension) =>
              dimension.state === 'scored' ? (
                <ScoredRow
                  key={dimension.id}
                  dimension={dimension}
                  bins={dimension.bins}
                  events={dimension.events}
                  open={openIds.has(dimension.id)}
                  onToggle={() => toggle(dimension.id)}
                />
              ) : (
                <div key={dimension.id} className="n-spectrum__row">
                  <span className="n-spectrum__dim">{dimension.name}</span>
                  <div className="n-spectrum__track is-unknown">
                    资料不足 · {dimension.missing}
                  </div>
                  <span className="n-spectrum__stat">
                    <span className="cnt">0 条</span>
                  </span>
                </div>
              ),
            )}
          </Fragment>
        ))}
      </div>
      <div className="n-spectrum__legend">
        <span>
          <i className="k-all"></i>外圈：这个分值的全部事件
        </span>
        <span>
          <i className="k-recent"></i>实心：其中近 3 个月
        </span>
        <span>
          <i className="k-mean"></i>均值
        </span>
        <span>
          <i className="k-unknown"></i>资料不足
        </span>
        <span>点一行展开事件</span>
      </div>
    </article>
  );
}
