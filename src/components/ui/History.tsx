import type { ScoreValue } from './Score';

export type HistoryEntry = {
  value: ScoreValue;
  /** AI proposals are tinted; human edits and confirmations are not. */
  origin: 'ai' | 'human';
  /** Headline when no reason was written, e.g. 确认 or AI 建议 · 锚点 4. */
  summary: string;
  /** The reason the scorer gave; replaces the summary when present. */
  reason?: string;
  /** Who, in what role, under which rule version, when; joined with " · ". */
  meta: readonly string[];
};

/**
 * Every revision of one score, in the order given (newest first in the prototype).
 * Older versions stay listed; nothing is collapsed or dropped here.
 */
export function History({ entries }: { entries: readonly HistoryEntry[] }) {
  return (
    <ul className="n-history">
      {entries.map((entry, index) => (
        <li key={index}>
          <span
            className={`n-history__v${entry.origin === 'ai' ? ' is-ai' : ''}`}
          >
            {entry.value}
          </span>
          <div>
            {entry.reason ? (
              <span className="n-history__why">{entry.reason}</span>
            ) : (
              entry.summary
            )}
            <small>{entry.meta.join(' · ')}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
