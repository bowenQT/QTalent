'use client';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';

/** A citation can point at a document paragraph, a page, a table cell or a recording time. */
export const citeSourceKinds = [
  'paragraph',
  'page',
  'cell',
  'timestamp',
] as const;
export type CiteSourceKind = (typeof citeSourceKinds)[number];

const sourceIcon: Record<CiteSourceKind, IconName> = {
  paragraph: 'doc',
  page: 'doc',
  cell: 'doc',
  timestamp: 'wave',
};

export type CiteSource = {
  kind: CiteSourceKind;
  title: string;
  /** Where inside the source: 第 3 段, 第 2 页, B7, 03:12–03:28. */
  location: string;
  /** Who said or wrote it. */
  by?: string;
};

type Base = {
  /** What the mark prints: a running number, or a short word such as 原文. */
  index: number | string;
  /** Accessible name after "引用 n：". */
  markLabel: string;
  source: CiteSource;
};

/** The caller supplies the destination; the component never builds a link of its own. */
export type CiteJump = { label: string } & (
  { href: string; onSelect?: never } | { onSelect: () => void; href?: never }
);

export type CiteProps = Base &
  (
    | {
        access: 'granted';
        quote: ReactNode;
        jump?: CiteJump;
        /** Only recordings can play the cited moment. */
        onPlay?: () => void;
        playText?: string;
      }
    | {
        /** The viewer may not read the original: only the provenance is shown. */
        access: 'locked';
        lockedText: string;
        quote?: never;
        jump?: never;
        onPlay?: never;
        playText?: never;
      }
  );

export type CiteSpec = CiteProps extends infer P
  ? P extends CiteProps
    ? Omit<P, 'index'>
    : never
  : never;

const NARROW = '(max-width: 760px)';

/** Fixes the popover to the viewport so scroll containers and screen edges cannot clip it. */
function place(root: HTMLElement, mark: HTMLElement, pop: HTMLElement) {
  if (window.matchMedia(NARROW).matches) {
    // Narrow screens use the bottom sheet from the stylesheet.
    pop.classList.remove('is-placed');
    for (const property of ['width', 'left', 'top'])
      pop.style.removeProperty(property);
    return;
  }
  const frame = root.closest('.m-screen')?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  const pad = 8;
  const gap = 10;
  const anchor = mark.getBoundingClientRect();
  pop.classList.add('is-placed');
  pop.style.width = `${Math.min(320, frame.right - frame.left - pad * 2)}px`;
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - width / 2, frame.left + pad),
    frame.right - width - pad,
  );
  const above =
    anchor.top - gap - height >= frame.top + pad ||
    anchor.bottom + gap + height > frame.bottom - pad;
  pop.style.left = `${left}px`;
  pop.style.top = `${above ? anchor.top - gap - height : anchor.bottom + gap}px`;
}

export function Cite(props: CiteProps) {
  const { index, markLabel, source } = props;
  if (!citeSourceKinds.includes(source.kind))
    throw new Error(`Unknown citation source kind: ${String(source.kind)}`);
  const locked = props.access === 'locked';
  const access: string = props.access;
  if (access !== 'locked' && access !== 'granted')
    throw new Error(`Unknown citation access: ${access}`);
  const canPlay =
    props.access === 'granted' && !!props.onPlay && source.kind === 'timestamp';
  const popId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  // Escape hides the popover without moving the pointer or focus; leaving resets it.
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused || pinned) && !dismissed;
  const reposition = useCallback(() => {
    if (root.current && mark.current && pop.current)
      place(root.current, mark.current, pop.current);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    // Capture so scrolling any ancestor container moves the popover with the mark.
    document.addEventListener('scroll', reposition, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
    };
  }, [open, reposition]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setDismissed(true);
      setPinned(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);
  return (
    <span
      ref={root}
      className={`n-cite${open ? ' is-open' : ''}`}
      onMouseEnter={() => {
        setDismissed(false);
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
        if (!focused) setDismissed(false);
      }}
      onFocus={() => {
        setDismissed(false);
        setFocused(true);
      }}
      onBlur={(event) => {
        if (root.current?.contains(event.relatedTarget as Node | null)) return;
        setFocused(false);
        if (!hovered) setDismissed(false);
      }}
    >
      <button
        ref={mark}
        type="button"
        className="n-cite__mark"
        data-kind={locked ? 'locked' : undefined}
        aria-label={`${typeof index === 'number' ? '引用 ' : ''}${index}：${markLabel}`}
        aria-expanded={open}
        aria-describedby={popId}
        onClick={() => {
          setDismissed(false);
          setPinned(!pinned);
        }}
      >
        {index}
      </button>
      <span
        ref={pop}
        id={popId}
        className="n-cite__pop"
        role="tooltip"
        data-source-kind={source.kind}
        style={dismissed ? { display: 'none' } : undefined}
      >
        <span className="n-cite__src">
          <Icon name={sourceIcon[source.kind]} size={14} />
          {source.title} · {source.location}
          {source.by ? ` · ${source.by}` : ''}
        </span>
        {props.access === 'locked' ? (
          <span className="n-cite__locked">
            <Icon name="lock" />
            {props.lockedText}
          </span>
        ) : (
          <>
            {/* A span, not a p: a paragraph inside the host paragraph would be closed early by the HTML parser. */}
            <span className="n-cite__quote" style={{ display: 'block' }}>
              {props.quote}
            </span>
            {canPlay || props.jump ? (
              <span className="n-cite__foot">
                {canPlay ? (
                  <span>
                    <button
                      type="button"
                      className="n-player__play"
                      style={{ width: 26, height: 26 }}
                      aria-label="播放这一段"
                      onClick={props.onPlay}
                    >
                      <Icon name="play" size={10} />
                    </button>
                    {props.playText ? (
                      <span
                        style={{
                          fontSize: 'var(--t-xs)',
                          color: 'var(--ink-3)',
                        }}
                      >
                        {props.playText}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span />
                )}
                {props.jump ? <JumpLink jump={props.jump} /> : null}
              </span>
            ) : null}
          </>
        )}
      </span>
    </span>
  );
}

const jumpStyle = { fontSize: 'var(--t-xs)', color: 'var(--light)' } as const;

function JumpLink({ jump }: { jump: CiteJump }) {
  return jump.href !== undefined ? (
    <a href={jump.href} style={jumpStyle}>
      {jump.label}
    </a>
  ) : (
    <button
      type="button"
      className="n-link"
      style={jumpStyle}
      onClick={jump.onSelect}
    >
      {jump.label}
    </button>
  );
}
