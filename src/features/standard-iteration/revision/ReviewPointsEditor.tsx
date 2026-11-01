'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Diff } from './parts';
import { pointText, type ReviewPoint } from './revision-view';

type Editing = {
  id: string;
  title: string;
  description: string;
  isNew: boolean;
};

/**
 * Review points edited in place: each change is marked against the base version, and
 * every point can return to its base text. Removed base points stay listed, struck out.
 */
export function ReviewPointsEditor({
  base,
  working,
  editable,
  onChange,
  onEditing,
  newId,
}: {
  base: readonly ReviewPoint[];
  working: readonly ReviewPoint[];
  editable: boolean;
  onChange: (points: ReviewPoint[]) => void;
  /** Whether a point is open with input not yet in `working`. */
  onEditing?: (open: boolean) => void;
  newId: () => string;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  function edit(next: Editing | null) {
    setEditing(next);
    onEditing?.(next !== null);
  }
  const baseOf = new Map(base.map((point) => [point.id, point]));
  const nowOf = new Map(working.map((point) => [point.id, point]));
  const rows: { id: string; before?: ReviewPoint; after?: ReviewPoint }[] = [
    ...base.map((point) => ({
      id: point.id,
      before: point,
      after: nowOf.get(point.id),
    })),
    ...working
      .filter((point) => !baseOf.has(point.id))
      .map((point) => ({ id: point.id, after: point })),
  ];
  if (editing?.isNew) rows.push({ id: editing.id });

  function save() {
    if (!editing) return;
    const title = editing.title.trim();
    const description = editing.description.trim();
    if (!title || !description) return;
    const point = { id: editing.id, title, description };
    onChange(
      editing.isNew
        ? [...working, point]
        : working.map((item) => (item.id === point.id ? point : item)),
    );
    edit(null);
  }
  function restore(id: string) {
    const before = baseOf.get(id);
    if (!before) {
      onChange(working.filter((point) => point.id !== id));
      return;
    }
    // Base points keep base order (a removed one returns to its place); additions follow.
    onChange([
      ...base.flatMap((point) => {
        const now = point.id === id ? point : nowOf.get(point.id);
        return now ? [now] : [];
      }),
      ...working.filter((point) => !baseOf.has(point.id)),
    ]);
  }

  let number = 0;
  return (
    <>
      <div
        className={`n-anchor${editable ? ' is-editing' : ''}`}
        style={{ boxShadow: 'none', padding: 0, background: 'none' }}
      >
        <ol>
          {rows.map(({ id, before, after }) => {
            const removed = before && !after;
            const changed =
              removed ||
              !before ||
              (after && pointText(before) !== pointText(after));
            const index = removed ? null : ++number;
            const open = editing?.id === id;
            return (
              <li
                key={id}
                className={changed ? 'is-changed' : undefined}
                data-point={id}
              >
                <b>{index ?? '—'}</b>
                {open ? (
                  <span className="n-anchor__edit">
                    <input
                      className="n-input"
                      aria-label="要点名称"
                      placeholder="比如：个人贡献核验"
                      value={editing.title}
                      onChange={(event) =>
                        edit({ ...editing, title: event.target.value })
                      }
                    />
                    <textarea
                      className="n-textarea"
                      rows={2}
                      aria-label="要点说明"
                      placeholder="比如：组队作品里每位成员说明本人做了哪部分"
                      value={editing.description}
                      onChange={(event) =>
                        edit({
                          ...editing,
                          description: event.target.value,
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          edit(null);
                        }
                      }}
                    />
                    <span className="nt-row">
                      <Button
                        className="n-btn--sm n-btn--ink"
                        type="button"
                        disabled={
                          !editing.title.trim() || !editing.description.trim()
                        }
                        onClick={save}
                      >
                        保存
                      </Button>
                      <Button
                        className="n-btn--sm n-btn--ghost"
                        type="button"
                        onClick={() => edit(null)}
                      >
                        取消
                      </Button>
                    </span>
                  </span>
                ) : (
                  <span>
                    {removed ? (
                      <span className="n-diff">
                        <del>{pointText(before)}</del>
                      </span>
                    ) : !before ? (
                      <span className="n-diff">
                        <ins>{pointText(after!)}</ins>
                      </span>
                    ) : changed ? (
                      <Diff from={pointText(before)} to={pointText(after!)} />
                    ) : (
                      pointText(after!)
                    )}
                  </span>
                )}
                {editable && !open ? (
                  <span className="n-anchor__acts">
                    {after ? (
                      <>
                        <Button
                          className="n-btn--sm n-btn--ghost"
                          type="button"
                          aria-label={`改要点 ${index}`}
                          onClick={() => edit({ ...after, isNew: false })}
                        >
                          <Icon name="pen" />
                        </Button>
                        <Button
                          className="n-btn--sm n-btn--ghost"
                          type="button"
                          aria-label={`删除要点 ${index}`}
                          onClick={() =>
                            onChange(working.filter((point) => point.id !== id))
                          }
                        >
                          <Icon name="x" />
                        </Button>
                      </>
                    ) : null}
                    {changed && before ? (
                      <Button
                        className="n-btn--sm n-btn--ghost"
                        type="button"
                        aria-label={`还原要点「${before.title}」`}
                        onClick={() => restore(id)}
                      >
                        <Icon name="retry" />
                      </Button>
                    ) : null}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      {editable && !editing ? (
        <Button
          className="n-btn--sm n-btn--ghost"
          type="button"
          style={{ justifySelf: 'start', marginTop: 'var(--s-2)' }}
          onClick={() =>
            edit({ id: newId(), title: '', description: '', isNew: true })
          }
        >
          <Icon name="plus" />
          添加要点
        </Button>
      ) : null}
    </>
  );
}
