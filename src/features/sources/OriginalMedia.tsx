'use client';
import { useCallback, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import styles from './source-viewer.module.css';
import { locatedProps, type Locate } from './located';
import { clock, timeRange } from './source-format';
import { overlaps, type At, type Content } from './viewer-model';

const BARS = 64;
// 与设计系统纪要播放条同一组刻度高度，只作波形示意。保留一位小数，服务端与浏览器
// 写出的百分比才一致，水合时不报属性不符。
const barHeight = (i: number) =>
  Math.min(
    100,
    20 + Math.abs(Math.sin(i * 1.7) * 60 + Math.cos(i * 0.6) * 20),
  ).toFixed(1);

/**
 * 录音与视频：播放条上蓝色刻度是引用的时间段，「播放这一段」从起点播到终点停；
 * 下面的转写里，和这一段重叠的话标出来。播放地址没接入时只有转写和时间段。
 */
export function MediaOriginal({
  location,
  content,
  locate,
}: {
  location: At<'recording'> | At<'video'>;
  content: Content<'recording'> | Content<'video'>;
  locate: Locate;
}) {
  const { startMs, endMs } = location;
  const media = useRef<HTMLMediaElement | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [currentMs, setCurrentMs] = useState(startMs);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const total =
    durationMs ??
    Math.max(endMs, ...content.segments.map((segment) => segment.endMs));
  const target = content.segments.findIndex((segment) =>
    overlaps(segment, startMs, endMs),
  );
  const playback = content.playback && !failed ? content.playback : null;
  const setMedia = useCallback((element: HTMLMediaElement | null) => {
    media.current = element;
  }, []);

  const toggle = () => {
    const element = media.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    const at = element.currentTime * 1000;
    if (at < startMs || at >= endMs) element.currentTime = startMs / 1000;
    element.play().catch(() => setFailed(true));
  };
  const events = {
    ref: setMedia,
    src: playback?.url,
    preload: 'metadata' as const,
    onLoadedMetadata: () => {
      const element = media.current!;
      if (Number.isFinite(element.duration))
        setDurationMs(element.duration * 1000);
      // 打开时停在引用的起点，不自动播放。
      element.currentTime = startMs / 1000;
    },
    onTimeUpdate: () => {
      const element = media.current!;
      const at = element.currentTime * 1000;
      setCurrentMs(at);
      if (at >= endMs && !element.paused) element.pause();
    },
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setFailed(true),
  };
  const kindName = location.kind === 'video' ? '视频' : '录音';
  const player = (
    <div className={`n-player ${styles.player}`}>
      <button
        type="button"
        className="n-player__play"
        aria-label={playing ? '暂停' : '播放这一段'}
        disabled={!playback}
        onClick={toggle}
      >
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <div
        className={`n-player__track ${styles.track}`}
        role="img"
        aria-label={`${kindName}中引用的时间段 ${timeRange(startMs, endMs)}`}
      >
        {Array.from({ length: BARS }, (_, i) => {
          const from = (i / BARS) * total;
          const to = ((i + 1) / BARS) * total;
          const mark = overlaps({ startMs: from, endMs: to }, startMs, endMs);
          const played = playback !== null && to <= currentMs;
          return (
            <i
              key={i}
              className={mark ? 'is-mark' : played ? 'is-played' : undefined}
              style={{ height: `${barHeight(i)}%` }}
            />
          );
        })}
      </div>
      <span className={styles.time}>
        {failed
          ? '播放失败，刷新页面再试'
          : playback
            ? `${clock(Math.floor(currentMs / 1000))} / ${clock(Math.round(total / 1000))}`
            : `${timeRange(startMs, endMs)} · 播放待接入`}
      </span>
    </div>
  );
  return (
    <div className={styles.original}>
      {playback && location.kind === 'video' ? (
        <video
          {...events}
          className={styles.video}
          playsInline
          aria-label="视频原件"
        />
      ) : playback ? (
        <audio {...events} />
      ) : null}
      {target < 0 ? <div {...locatedProps(locate)}>{player}</div> : player}
      {content.segments.length ? (
        <ol className={`n-transcript ${styles.transcript}`} aria-label="转写">
          {content.segments.map((segment, i) => {
            const quoted = overlaps(segment, startMs, endMs);
            const body = (
              <>
                <time>{clock(Math.floor(segment.startMs / 1000))}</time>
                <div>
                  {segment.speaker ? <b>{segment.speaker}</b> : null}
                  {quoted ? <mark>{segment.text}</mark> : segment.text}
                </div>
              </>
            );
            return i === target ? (
              <li key={i} {...locatedProps(locate)}>
                {body}
              </li>
            ) : (
              <li key={i}>{body}</li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
