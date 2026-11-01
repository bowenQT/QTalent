'use client';
import { Fragment } from 'react';
import { copy } from './copy';

export type QuoteRange = { start: number; end: number; quote: string };

type Segment = { text: string; marked: boolean; active: boolean };

/**
 * 按引用的字符范围（UTF-16 偏移，与服务端校验一致）切分原话。
 * 范围越界或引文与原话对不上时不高亮，不猜位置。
 */
export function splitByRanges(
  text: string,
  ranges: readonly QuoteRange[],
  active: QuoteRange | null,
): Segment[] {
  const valid = ranges
    .filter(
      (range) =>
        range.start >= 0 &&
        range.end <= text.length &&
        range.end > range.start &&
        text.slice(range.start, range.end) === range.quote,
    )
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of valid) {
    const start = Math.max(range.start, cursor);
    if (range.end <= start) continue;
    if (start > cursor)
      segments.push({
        text: text.slice(cursor, start),
        marked: false,
        active: false,
      });
    segments.push({
      text: text.slice(start, range.end),
      marked: true,
      active:
        active !== null &&
        active.start === range.start &&
        active.end === range.end,
    });
    cursor = range.end;
  }
  if (cursor < text.length)
    segments.push({ text: text.slice(cursor), marked: false, active: false });
  return segments;
}

/** 「原话」折叠区：显示用户提交的原文，被引用的范围加标记。 */
export function RawInput({
  text,
  ranges,
  active,
  open,
  onToggle,
}: {
  text: string;
  ranges: readonly QuoteRange[];
  active: QuoteRange | null;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      className="n-event__raw"
      id="ev-raw"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>{copy.sbi.rawSummary}</summary>
      <p>
        {splitByRanges(text, ranges, active).map((segment, index) => (
          <Fragment key={index}>
            {segment.marked ? (
              <mark data-active={segment.active ? '1' : undefined}>
                {segment.text}
              </mark>
            ) : (
              segment.text
            )}
          </Fragment>
        ))}
      </p>
    </details>
  );
}
