'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from './Badge';
import type { ScoreValue } from './Score';

export type AnchorLevels = readonly [string, string, string, string, string];

/**
 * Behaviour anchors behind one dimension's 1-5 scale, with the rule version they come from.
 * The trigger opens the panel by keyboard or pointer; Escape closes it and returns focus.
 */
export function Anchor({
  dimension,
  ruleVersion,
  levels,
  hit,
  defaultOpen = false,
}: {
  dimension: string;
  ruleVersion: string;
  levels: AnchorLevels;
  /** Levels that the score under review landed on. */
  hit?: readonly ScoreValue[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const away = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', away);
    };
  }, [open]);
  return (
    <div ref={root}>
      <button
        ref={trigger}
        type="button"
        className="n-btn n-btn--sm n-btn--ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        {open ? '收起锚点' : '展开锚点'}
      </button>
      <div className="n-anchor" id={panelId} hidden={!open}>
        <b>{dimension} · 1–5 分锚点</b>{' '}
        <Badge style={{ marginLeft: 6 }}>{ruleVersion}</Badge>
        <ol>
          {levels.map((text, index) => (
            <li
              key={index}
              className={
                hit?.includes((index + 1) as ScoreValue) ? 'is-hit' : undefined
              }
            >
              <b>{index + 1}</b>
              {text}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
