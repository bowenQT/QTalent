'use client';
import { useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DropZone } from '@/components/ui/DropZone';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Progress } from '@/components/ui/Progress';
import { useToast } from '@/components/ui/Toast';
import { extLabel, type FileSelection } from '@/components/ui/file-selection';
import { useMaterialsPort } from './materials-port';
import {
  batchParts,
  batchState,
  fileLines,
  inProgress,
  uploadHint,
  uploadRules,
  type Batch,
  type BatchKey,
} from './materials-model';
import { useBatches } from './use-batches';
import './materials.css';

type Batches = ReturnType<typeof useBatches>;

const ROW_ICON: Record<BatchKey, IconName> = {
  processing: 'spark',
  verify: 'split',
  confirm: 'check2',
  done: 'check',
  failed: 'x',
};
// `.n-task[data-state]` colours the state word: partial for review, failed for errors.
const ROW_STATE: Record<BatchKey, string> = {
  processing: 'shaping',
  verify: 'partial',
  confirm: 'partial',
  done: 'done',
  failed: 'failed',
};

function Pending({ text }: { text: string }) {
  return (
    <p className="nt-caption">
      <Badge tone="prep">待接入</Badge> <span className="nt-muted">{text}</span>
    </p>
  );
}

/** 进行中的任务: one row per batch dropped on this page, as the prototype's dropRow. */
function TaskList({ state }: { state: Batches | null }) {
  if (!state) return <Pending text="上传和处理进度接通后会出现在这里" />;
  if (!state.batches.length)
    return <div className="nt-empty">投递的材料会出现在这里</div>;
  return state.batches.map((batch) => {
    const [key, label] = batchState(batch);
    return (
      <div key={batch.id} className="n-task" data-state={ROW_STATE[key]}>
        <span className="n-task__icon">
          <Icon name={ROW_ICON[key]} />
        </span>
        <div>
          <div className="n-task__name">
            {batch.title}
            <span className="n-badge">统一投递</span>
          </div>
          <div className="n-task__state">
            <b>{label}</b> · {batchParts(batch).join(' · ')}
          </div>
          {key === 'processing' ? (
            <Progress label={`${batch.title} 处理进度`} />
          ) : null}
        </div>
        <div />
      </div>
    );
  });
}

/** The batch just dropped: each file's state, with cancel and retry while uploading. */
function BatchCard({ batch, state }: { batch: Batch; state: Batches }) {
  const [key, label] = batchState(batch);
  const { submission } = batch;
  const parts = batchParts(batch).slice(1);
  return (
    <li className="n-dropbatch" data-state={key}>
      <div className="n-dropbatch__head">
        <b>{batch.title}</b>
        <span className="n-rstate" data-s={key}>
          {label}
        </span>
      </div>
      {fileLines(batch).map(({ key: fileKey, name, line, local }) => (
        <div key={fileKey} className="n-file">
          <span className="n-file__ext">{extLabel(name)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="n-file__name" title={name}>
              {name}
            </div>
            <div className="n-file__state">
              <span className={line.tone ?? undefined}>
                <Icon name={line.icon} size={12} /> {line.label}
              </span>{' '}
              · {line.meta}
            </div>
            {line.progress === undefined ? null : (
              <Progress
                value={line.progress ?? undefined}
                label={`${name} ${line.label}`}
              />
            )}
          </div>
          {local?.state === 'uploading' ? (
            <Button
              className="n-btn--sm n-btn--ghost"
              onClick={() => state.cancel(batch.id, local.clientFileId)}
            >
              取消上传
            </Button>
          ) : local?.state === 'interrupted' ? (
            <span className="n-dropbatch__acts">
              <Button
                className="n-btn--sm n-btn--ghost"
                onClick={() => state.cancel(batch.id, local.clientFileId)}
              >
                取消上传
              </Button>
              <Button
                className="n-btn--sm"
                onClick={() => state.retry(batch.id, local.clientFileId)}
              >
                <Icon name="retry" />
                重试
              </Button>
            </span>
          ) : (
            <span />
          )}
        </div>
      ))}
      <div className="n-dropbatch__foot">
        <span className="nt-muted">
          {submission.state === 'interrupted'
            ? submission.message
            : parts.join(' · ') || label}
        </span>
        {submission.state === 'interrupted' ? (
          <Button
            className="n-btn--sm"
            onClick={() => state.resubmit(batch.id)}
          >
            <Icon name="retry" />
            重新提交
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** 上传材料: the drop zone and the batch just dropped. */
/** Without a port the drop zone stays in place, inert, under a 待接入 note. */
function UploadArea({ state }: { state: Batches | null }) {
  if (!state)
    return (
      <>
        <Pending text="上传接通后可以拖入文件" />
        <DropZone
          rules={uploadRules}
          currentCount={0}
          hint={uploadHint}
          disabled
          onSelect={() => undefined}
        />
        <ul className="n-files" id="files" />
      </>
    );
  return <ConnectedUpload state={state} />;
}

function ConnectedUpload({ state }: { state: Batches }) {
  const toast = useToast();
  const latest = state.batches[0];
  const select = (selection: FileSelection) => {
    if (selection.overflow) toast.show(selection.overflow.message);
    state.add(selection);
  };
  return (
    <>
      <DropZone
        rules={uploadRules}
        currentCount={0}
        hint={uploadHint}
        onSelect={select}
      />
      <ul className="n-files" id="files">
        {latest ? <BatchCard batch={latest} state={state} /> : null}
      </ul>
    </>
  );
}

function useMaterials() {
  const port = useMaterialsPort();
  const state = useBatches(port);
  return port ? state : null;
}

/** HR: 进行中的任务 and 上传材料, two cards in the side column. */
export function MaterialsCards() {
  const state = useMaterials();
  return (
    <>
      <article className="n-card">
        <h3 className="n-section-title">进行中的任务</h3>
        <div id="tasks">
          <TaskList state={state} />
        </div>
      </article>
      <article className="n-card" id="upload">
        <h3 className="n-section-title">上传材料</h3>
        <UploadArea state={state} />
      </article>
    </>
  );
}

/**
 * Mentor: the same, folded into 材料与任务 and closed by default. The composer's clip
 * links to `#upload`, which opens it.
 */
export function MaterialsFold() {
  const state = useMaterials();
  const fold = useRef<HTMLDetailsElement>(null);
  // Only batches dropped on this page are known; earlier ones have no list read yet,
  // so the count is drawn only when there is something in progress here.
  const busy = state ? inProgress(state.batches) : 0;
  useEffect(() => {
    const open = () => {
      if (location.hash === '#upload' && fold.current) fold.current.open = true;
    };
    open();
    addEventListener('hashchange', open);
    return () => removeEventListener('hashchange', open);
  }, []);
  return (
    <details className="n-card nt-fold" id="fold" ref={fold}>
      <summary>
        <h3 className="n-section-title">材料与任务</h3>
        {busy ? <span className="nt-muted">{busy} 个在处理</span> : null}
        <Icon name="chev" />
      </summary>
      <div id="tasks">
        <TaskList state={state} />
      </div>
      <div id="upload" style={{ marginTop: 'var(--s-4)' }}>
        <UploadArea state={state} />
      </div>
    </details>
  );
}
