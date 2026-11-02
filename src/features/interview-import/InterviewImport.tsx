'use client';
import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { ImportRowCard } from './ImportRowCard';
import {
  actionFailed,
  candidateStatusLabel,
  importPending,
  monthDay,
  monthDayTime,
  pagesText,
  sentToast,
  sentToastNotHired,
  skippedNote,
} from './copy';
import {
  batchState,
  rowState,
  skipped,
  summarize,
  type ImportBatch,
  type ImportRow,
} from './model';
import type { InterviewImportPorts, RowResult } from './ports';
import './interview-import.css';

/**
 * The interview import preview (prototype Y app/import.html, HR view): rows still to
 * settle as cards, skipped rows folded below, and the import bar. Every change goes
 * through the ports and the stored row comes back, so confirmed rows stay confirmed when
 * HR leaves and returns. Import itself is not connected yet (BOW-906).
 */
export function InterviewImport({
  batch,
  ports,
}: {
  batch: ImportBatch;
  ports: InterviewImportPorts;
}) {
  const [rows, setRows] = useState(batch.rows);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  // Entries HR chose that the server has not stored yet, by row and item. They stay in
  // the field after a failed save so nothing is lost, and never count as filled in.
  const [unsaved, setUnsaved] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});
  const toast = useToast();

  async function run(
    rowId: string,
    call: () => Promise<RowResult>,
    done?: (row: ImportRow) => void,
  ) {
    setBusy((current) => new Set(current).add(rowId));
    let result: RowResult;
    try {
      result = await call();
    } catch {
      result = { status: 'conflict', message: actionFailed };
    }
    setBusy((current) => {
      const next = new Set(current);
      next.delete(rowId);
      return next;
    });
    if (result.status !== 'ok') {
      toast.show(result.message);
      return false;
    }
    const row = result.row;
    setRows((current) => current.map((r) => (r.rowId === rowId ? row : r)));
    done?.(row);
    return true;
  }

  async function fill(rowId: string, item: string, value: string) {
    const keep = (entry: string | null) =>
      setUnsaved((current) => {
        const forRow = { ...current[rowId] };
        if (entry === null) delete forRow[item];
        else forRow[item] = entry;
        return { ...current, [rowId]: forRow };
      });
    keep(value);
    if (await run(rowId, () => ports.fill(batch.id, rowId, item, value)))
      keep(null);
  }

  const states = rows.map((row) => ({ row, state: rowState(row) }));
  const live = states.filter(({ state }) => !skipped(state));
  const out = states.filter(({ state }) => skipped(state));
  const sum = summarize(rows);
  const batchLabel = batchState(rows);
  const dupCount = states.filter(({ state }) => state === 'dup').length;

  return (
    <>
      <header className="nt-head">
        <div>
          <h1>面评导入</h1>
          {/* One text node, as in the prototype: split nodes shape the line differently. */}
          <p>{`${batch.file} · ${batch.pageCount} 页 · ${batch.uploadedBy} ${monthDayTime(batch.uploadedAt)} 上传 · 按版式读分`}</p>
        </div>
        <span className="n-rstate" data-s={batchLabel.s}>
          {batchLabel.label}
        </span>
      </header>
      {batch.prior ? (
        <p className="n-note">
          <Icon name="info" />
          <span>
            这份文件 {monthDay(batch.prior.importedOn)} 导入过一次，那次已导入的{' '}
            {dupCount} 行这次跳过，其余行照常确认。
          </span>
        </p>
      ) : null}
      <ul className="n-rsum" aria-label="这份面评">
        <li>
          <b>{sum.live}</b>行可导入
        </li>
        <li>
          <b>{sum.confirm}</b>行待确认是谁
        </li>
        <li>
          <b>{sum.verify + sum.unread + sum.unknown}</b>行待处理
          <small>
            面试官 {sum.verify} · 补录 {sum.unread} · 待认人 {sum.unknown}
          </small>
        </li>
        <li>
          <b>{sum.skipped}</b>行跳过
        </li>
      </ul>
      <div className="nt-grid" id="iv-rows">
        {live.map(({ row }) => (
          <ImportRowCard
            key={row.rowId}
            row={row}
            busy={busy.has(row.rowId)}
            unsaved={unsaved[row.rowId] ?? {}}
            flash={flash === row.rowId}
            on={{
              confirm: (ok) =>
                run(
                  row.rowId,
                  () => ports.confirm(batch.id, row.rowId, ok),
                  () => setFlash(ok ? row.rowId : null),
                ),
              fill: (item, value) => fill(row.rowId, item, value),
              send: () =>
                run(
                  row.rowId,
                  () => ports.sendToReview(batch.id, row.rowId),
                  () =>
                    toast.show(
                      row.candidateStatus === 'hired'
                        ? sentToast
                        : sentToastNotHired,
                    ),
                ),
            }}
          />
        ))}
      </div>
      {out.length ? (
        <details className="n-card nt-fold" style={{ marginTop: 'var(--s-4)' }}>
          <summary>
            <h3 className="n-section-title">跳过的 {out.length} 行</h3>
            <span className="nt-muted">{skippedNote}</span>
            <Icon name="chev" />
          </summary>
          <ul className="nt-list" style={{ marginTop: 'var(--s-3)' }}>
            {out.map(({ row }) => (
              <li
                key={row.rowId}
                className="nt-row"
                style={{ justifyContent: 'space-between', gap: 'var(--s-3)' }}
              >
                <span>
                  <b style={{ fontWeight: 600 }}>{row.observedName}</b> ·{' '}
                  {pagesText(row.pages)} · {row.template.name}
                </span>
                <span className="nt-muted">
                  {row.duplicate
                    ? `${monthDay(row.duplicate.importedOn)} 已导入过`
                    : `北森状态：${candidateStatusLabel[row.candidateStatus]}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="n-ivbar">
        <span className="nt-muted">
          {sum.confirmed
            ? `已确认 ${sum.confirmed} 行；导入后写进这些人的档案，作为面试段的历史评价`
            : '逐行确认「这是谁」以后，就能导入'}
        </span>
        <span className="nt-row">
          <Badge tone="prep">{importPending}</Badge>
          <button
            className="n-btn n-btn--ink"
            type="button"
            id="iv-go"
            disabled
          >
            <Icon name="upload" />
            导入已确认的 {sum.confirmed} 行
          </button>
        </span>
      </div>
    </>
  );
}
