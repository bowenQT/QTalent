'use client';
import { useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import type { ExportRange, ExportScope, ExportView } from '../../view';
import { exportCopy, exportRanges, rangeLabel } from './export-copy';
import { useExportPort, type ExportOutcome } from './export-port';
import '../../workbench.css';

/** The shared icon sprite has no download glyph yet; same path as the prototype's. */
function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4 15v4.5h16V15" />
    </svg>
  );
}

type Run = { scope: ExportScope; range: ExportRange };
type Job =
  | (Run & { state: 'busy' })
  | (Run & { state: 'denied' })
  | (Run & { state: 'empty' })
  | (Run & { state: 'failed'; reason: string })
  | (Run & {
      state: 'done';
      people: number;
      rows: number;
      at: string;
      href: string;
      fileName: string;
    });

const scopeLabel = (scope: ExportScope, range: ExportRange) =>
  `${scope.label} · ${rangeLabel[range]}`;

function Summary({ scope, range }: { scope: ExportScope; range: ExportRange }) {
  const preview = scope.previews[range];
  const skipped = preview.skipped ? (
    <span>{exportCopy.skipped(preview.skipped)}</span>
  ) : null;
  return (
    <p className="n-export__sum" id="ex-sum">
      {preview.rows ? (
        <>
          <b>
            {preview.people} 人 · {preview.rows} 条已确认的维度分
          </b>
          {skipped}
        </>
      ) : (
        <>
          <b>这个范围里已确认的内容 0 条</b>
          {!scope.people ? <span>这个范围里 0 人</span> : skipped}
        </>
      )}
    </p>
  );
}

function Status({
  job,
  onRetry,
  onClose,
}: {
  job: Job;
  onRetry: () => void;
  onClose: () => void;
}) {
  const label = scopeLabel(job.scope, job.range);
  const close = (
    <button
      className="n-btn n-btn--sm n-btn--ghost"
      type="button"
      onClick={onClose}
    >
      关闭
    </button>
  );
  if (job.state === 'busy')
    return (
      <div className="n-notice is-plain n-exst" data-state="busy">
        <Icon name="clock" />
        <div>{exportCopy.busy(label)}</div>
      </div>
    );
  if (job.state === 'denied' || job.state === 'empty')
    return (
      <div
        className={`n-notice ${job.state === 'denied' ? 'is-deny' : 'is-plain'} n-exst`}
        data-state={job.state === 'denied' ? 'deny' : 'empty'}
      >
        <Icon name={job.state === 'denied' ? 'lock' : 'info'} />
        <div>
          {job.state === 'denied' ? (
            <>
              <b>导出停在权限校验这一步。</b>
              {exportCopy.denied}
            </>
          ) : (
            <>
              <b>导出停在取数这一步。</b>
              {exportCopy.empty(label)}
            </>
          )}
          <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
            {close}
          </div>
        </div>
      </div>
    );
  if (job.state === 'failed')
    return (
      <div className="n-notice is-deny n-exst" data-state="fail">
        <Icon name="x" />
        <div>
          <b>导出停在生成文件这一步。</b>
          {exportCopy.failed(job.reason)}
          <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
            <button className="n-btn n-btn--sm" type="button" onClick={onRetry}>
              <Icon name="retry" />
              重试
            </button>
            {close}
          </div>
        </div>
      </div>
    );
  return (
    <div className="n-notice is-plain n-exst" data-state="done">
      <Icon name="check" />
      <div>
        <b>表格已生成：</b>
        {exportCopy.done(label, job.people, job.rows, job.at.slice(5))}
        <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
          <a
            className="n-btn n-btn--sm n-btn--ink"
            href={job.href}
            download={job.fileName}
          >
            <DownloadIcon />
            下载表格
          </a>
          {close}
        </div>
      </div>
    </div>
  );
}

/**
 * Heading with the export entry (managers and HR, BOW-912): pick a scope and an event
 * time range, see how many confirmed scores go into the table, then generate and
 * download. `children` is the heading text; the status shows under the heading.
 */
export function Export({
  view,
  data,
  children,
}: {
  view: { displayName: string };
  data: ExportView;
  children: ReactNode;
}) {
  const port = useExportPort();
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState(data.scopes[0]?.id ?? '');
  const [range, setRange] = useState<ExportRange>('last12Months');
  const [job, setJob] = useState<Job | null>(null);
  const run = useRef(0);
  const scope = data.scopes.find((item) => item.id === scopeId);

  async function generate(target: ExportScope, targetRange: ExportRange) {
    if (!port) return;
    const id = ++run.current;
    setJob({ state: 'busy', scope: target, range: targetRange });
    let outcome: ExportOutcome;
    try {
      outcome = await port.generate(target.id, targetRange);
    } catch {
      outcome = { status: 'failed', reason: exportCopy.unreachable };
    }
    // A newer run or a closed status owns the notice now.
    if (run.current !== id) return;
    const base = { scope: target, range: targetRange };
    if (outcome.status === 'done')
      setJob({
        ...base,
        state: 'done',
        people: outcome.people,
        rows: outcome.rows,
        at: outcome.at,
        href: outcome.href,
        fileName: outcome.fileName,
      });
    else if (outcome.status === 'failed')
      setJob({ ...base, state: 'failed', reason: outcome.reason });
    else if (outcome.status === 'denied') setJob({ ...base, state: 'denied' });
    else setJob({ ...base, state: 'empty' });
  }

  return (
    <>
      <header className="nt-head">
        {children}
        {port && data.scopes.length ? (
          <div className="nt-head__acts">
            <button
              className="n-btn n-btn--sm"
              type="button"
              id="btn-export"
              onClick={() => setOpen(true)}
            >
              <DownloadIcon />
              导出已确认内容
            </button>
          </div>
        ) : null}
      </header>
      <div id="export-st" aria-live="polite" hidden={!job}>
        {job ? (
          <Status
            job={job}
            onRetry={() => void generate(job.scope, job.range)}
            onClose={() => {
              run.current++;
              setJob(null);
            }}
          />
        ) : null}
      </div>
      {scope ? (
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title="导出已确认内容"
          actions={[
            {
              id: 'cancel',
              label: '取消',
              variant: 'ghost',
              onSelect: () => setOpen(false),
            },
            {
              id: 'go',
              label: '生成表格',
              variant: 'ink',
              validate: () =>
                scope.previews[range].rows ? true : exportCopy.pickAnother,
              onSelect: () => {
                setOpen(false);
                void generate(scope, range);
              },
            },
          ]}
        >
          <div className="n-export">
            <div className="n-export__pick">
              <label className="n-field">
                <span className="n-field__label">范围</span>
                <select
                  className="n-select"
                  id="ex-scope"
                  value={scope.id}
                  onChange={(event) => setScopeId(event.target.value)}
                >
                  {data.scopes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}（{item.people} 人）
                    </option>
                  ))}
                </select>
              </label>
              <label className="n-field">
                <span className="n-field__label">事件时间</span>
                <select
                  className="n-select"
                  id="ex-time"
                  value={range}
                  onChange={(event) => {
                    const picked = exportRanges.find(
                      (item) => item === event.target.value,
                    );
                    if (picked) setRange(picked);
                  }}
                >
                  {exportRanges.map((item) => (
                    <option key={item} value={item}>
                      {rangeLabel[item]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Summary scope={scope} range={range} />
            <div className="n-export__head">
              <span className="n-export__cap">表头会写明</span>
              <dl id="ex-head">
                <dt>导出时间</dt>
                <dd>生成时写入，精确到分钟</dd>
                <dt>导出人</dt>
                <dd>{view.displayName}</dd>
                <dt>口径</dt>
                <dd>{exportCopy.basis}</dd>
                <dt>范围</dt>
                <dd>{scopeLabel(scope, range)}</dd>
              </dl>
            </div>
            <p className="nt-caption">{exportCopy.caption}</p>
          </div>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
