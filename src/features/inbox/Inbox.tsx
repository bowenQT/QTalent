'use client';
import { useState } from 'react';
import { Chips, Count } from '@/components/ui/Chips';
import { State } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import type { MaterialReviewCommand } from '@/contracts/material-review';
import {
  allDone,
  failed,
  lede,
  restLater,
  undoFailed,
  undoneText,
} from './copy';
import type { InboxData, InboxPorts } from './ports';
import { ReviewCard } from './ReviewCard';
import {
  KIND_LABEL,
  LOCK_TEXT,
  doneText,
  isPageItem,
  isPageResolved,
  openKinds,
  question,
  resultText,
  type PageItem,
  type PageKind,
  type PageResolved,
  type Resolution,
} from './view';

type Filter = PageKind | 'all';
type Settling = { itemId: string; choice: string };

const operationId = () => crypto.randomUUID();
const short = (text: string) => text.replace(/？$/, '');

/** Builds the typed command for an item; the resolution was built by its card. */
function command(item: PageItem, resolution: Resolution) {
  return {
    operationId: operationId(),
    batchId: item.batchId,
    itemId: item.itemId,
    expectedRevision: item.revision,
    kind: item.kind,
    resolution,
  } as MaterialReviewCommand;
}

/**
 * 待核对: one question per card, one pick per question. A pick takes effect at once
 * and can be undone from the toast or from「已核对」until something depends on it.
 * The page re-reads after every command; it never edits its own copy of the result.
 */
export function Inbox({
  initial,
  ports,
}: {
  initial: InboxData;
  ports: InboxPorts;
}) {
  const toast = useToast();
  const [data, setData] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  // Deferred items brought back with「继续核对」; local until the next pick.
  const [resumed, setResumed] = useState<ReadonlySet<string>>(new Set());
  const [settling, setSettling] = useState<Settling | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const items = data.items.filter(isPageItem);
  const resolved = data.resolvedItems.filter(isPageResolved);
  const isOpen = (item: PageItem) =>
    item.state === 'pending' || resumed.has(item.itemId);
  const kinds = openKinds(items);
  const shown: Filter =
    filter !== 'all' && !kinds.includes(filter) ? 'all' : filter;
  const open = items.filter(
    (item) => isOpen(item) && (shown === 'all' || item.kind === shown),
  );
  const later = items.filter((item) => !isOpen(item));
  const openCount = (kind?: PageKind) =>
    items.filter((item) => isOpen(item) && (!kind || item.kind === kind))
      .length;

  const refresh = async () => setData(await ports.read());
  const setError = (itemId: string, message: string | null) =>
    setErrors((current) => {
      const next = { ...current };
      if (message) next[itemId] = message;
      else delete next[itemId];
      return next;
    });

  async function undo(
    kind: PageKind,
    item: { batchId: string; itemId: string },
    revision: number,
  ) {
    const result = await ports.undo({
      operationId: operationId(),
      batchId: item.batchId,
      itemId: item.itemId,
      expectedRevision: revision,
      kind,
      action: 'undo',
    });
    if (result.status !== 'success')
      throw new Error(
        result.status === 'conflict' ? undoFailed.conflict : undoFailed.other,
      );
    await refresh();
  }

  async function pick(item: PageItem, resolution: Resolution, choice: string) {
    if (settling) return;
    setSettling({ itemId: item.itemId, choice });
    setError(item.itemId, null);
    try {
      const result = await ports.resolve(command(item, resolution));
      if (result.status !== 'success') {
        setError(item.itemId, failed[result.status]);
        return;
      }
      setResumed((current) => {
        const next = new Set(current);
        next.delete(item.itemId);
        return next;
      });
      await refresh();
      const revision = result.result.revision;
      toast.show(
        doneText(resolution, data.people),
        resolution.action === 'defer'
          ? {}
          : {
              onUndo: () => undo(item.kind, item, revision),
              undoneText,
              failedText: undoFailed.other,
            },
      );
    } catch {
      setError(item.itemId, failed.offline);
    } finally {
      setSettling(null);
    }
  }

  async function undoResolved(item: PageResolved) {
    try {
      await undo(item.kind, item, item.revision);
      toast.show(undoneText);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : undoFailed.other);
    }
  }

  const empty = later.length ? (
    <State
      {...restLater(shown === 'all' ? null : KIND_LABEL[shown], later.length)}
      kind="empty"
    />
  ) : (
    <State {...allDone} />
  );

  return (
    <>
      <header className="nt-head">
        <div>
          <h1>待核对</h1>
          <p>{lede}</p>
        </div>
      </header>
      {kinds.length > 1 ? (
        <Chips
          label="按类型筛选"
          selected={[shown]}
          onSelect={(value) => setFilter(value as Filter)}
          items={[
            { value: 'all', label: '全部', count: openCount() },
            ...kinds.map((kind) => ({
              value: kind,
              label: KIND_LABEL[kind],
              count: openCount(kind) || undefined,
            })),
          ]}
        />
      ) : null}
      <div className="nt-split">
        <div className="nt-grid" id="cards">
          {open.length
            ? open.map((item) => (
                <ReviewCard
                  key={item.itemId}
                  item={item}
                  people={data.people}
                  picked={
                    settling?.itemId === item.itemId ? settling.choice : null
                  }
                  busy={settling !== null}
                  error={errors[item.itemId] ?? null}
                  onPick={(resolution, choice) =>
                    void pick(item, resolution, choice)
                  }
                />
              ))
            : empty}
        </div>
        <aside className="nt-grid nt-sticky">
          {later.length ? (
            <article className="n-card">
              <h3 className="n-section-title">
                稍后处理<Count tone="quiet">{later.length}</Count>
              </h3>
              <ul className="nt-list" style={{ fontSize: 'var(--t-sm)' }}>
                {later.map((item) => (
                  <li
                    key={item.itemId}
                    className="nt-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span>
                      <span className="n-kind">{KIND_LABEL[item.kind]}</span>{' '}
                      {short(question(item))}
                    </span>
                    <button
                      className="n-link"
                      type="button"
                      onClick={() =>
                        setResumed((current) =>
                          new Set(current).add(item.itemId),
                        )
                      }
                    >
                      继续核对
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
          {resolved.length ? (
            <article className="n-card">
              <h3 className="n-section-title">已核对</h3>
              <ul className="nt-list" style={{ fontSize: 'var(--t-sm)' }}>
                {resolved.map((item) => (
                  <li
                    key={item.itemId}
                    className="nt-row"
                    style={{ justifyContent: 'space-between' }}
                  >
                    <span>
                      <span className="n-kind">{KIND_LABEL[item.kind]}</span>{' '}
                      {short(question(item))} →{' '}
                      <b>{resultText(item, data.people)}</b>
                    </span>
                    {item.undo.status === 'available' ? (
                      <button
                        className="n-link"
                        type="button"
                        onClick={() => void undoResolved(item)}
                      >
                        撤销
                      </button>
                    ) : (
                      <span className="nt-muted">
                        {LOCK_TEXT[item.undo.reason]}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
        </aside>
      </div>
    </>
  );
}
