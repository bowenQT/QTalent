'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type {
  SelectionManagerRevision,
  SelectionPublicationReceipt,
} from '@/contracts/selection-standard';
import { monthDay } from '../copy';
import { useOperation } from '../operation';
import {
  actionFailure,
  newOperationId,
  settle,
  type ManagerRevisionPorts,
} from '../ports';
import {
  ChangeTable,
  compatText,
  EffectText,
  ImpactCard,
  PointList,
  RevisionStateTag,
} from './parts';
import {
  applyChanges,
  impactLine,
  managerBasisText,
  type ReviewPoint,
} from './revision-view';

type View =
  | { kind: 'review'; revision: SelectionManagerRevision }
  | {
      kind: 'published';
      revision: SelectionManagerRevision;
      receipt: SelectionPublicationReceipt;
    }
  | { kind: 'returned'; revision: SelectionManagerRevision; reason: string }
  /** The page no longer knows the server state: reload before acting again. */
  | { kind: 'stale'; revision: SelectionManagerRevision };

/**
 * The manager reads the change, the reason, the summary basis and the saved impact
 * preview, then publishes (seal, five seconds to undo) or returns it with a reason.
 * No names, cases, rater figures or score changes reach this view.
 */
export function ManagerRevision({
  initial,
  base,
  ports,
  onSeal,
}: {
  initial: SelectionManagerRevision;
  base: readonly ReviewPoint[];
  ports: ManagerRevisionPorts;
  /** The page header carries the seal; it stamps on publish and lifts on undo. */
  onSeal: (sealed: boolean) => void;
}) {
  const toast = useToast();
  const [view, setView] = useState<View>({ kind: 'review', revision: initial });
  const [dialog, setDialog] = useState<'publish' | 'return' | null>(null);
  const [busy, setBusy] = useState(false);
  const returnReason = useRef<HTMLTextAreaElement>(null);
  const operation = useOperation();
  const revision = view.revision;
  const changes = revision.humanVersion?.changes ?? [];
  const editor = revision.humanVersion?.editedBy.name ?? 'HR';
  const basisLines = revision.basis.map(managerBasisText);
  const pending =
    view.kind === 'review' && revision.state === 'pending_confirmation';

  async function publish() {
    setBusy(true);
    const input = {
      draftId: revision.id,
      expectedRevision: revision.revision,
      expectedPreviewId: revision.impactPreview.id,
    };
    const result = await settle(() =>
      ports.publish({
        operationId: operation.idFor('publish', input),
        ...input,
      }),
    );
    setBusy(false);
    // A lost answer keeps the dialog, and with it the typed reason, for a resend.
    if (result.status !== 'lost') setDialog(null);
    if (result.status !== 'success') {
      toast.show(actionFailure(result));
      return;
    }
    operation.done();
    const receipt = result.result;
    setView({ kind: 'published', revision, receipt });
    onSeal(true);
    // One undo intent: the toast's 重试 resends this exact command.
    const undo = {
      operationId: newOperationId(),
      publicationId: receipt.publicationId,
      expectedRevision: receipt.revision,
    };
    toast.show(`已发布 ${receipt.versionId}，之后新建的期次默认用新版`, {
      onUndo: async () => {
        const undone = await ports.undo(undo);
        if (undone.status !== 'success') throw new Error(undone.status);
        onSeal(false);
        // The undo moves the revision number on the server: read it back, never
        // guess. A read that fails leaves the state unknown, not the undo failed.
        const fresh = await settle(() => ports.read({ draftId: revision.id }));
        setView(
          fresh.status === 'success' && fresh.view.audience === 'manager'
            ? { kind: 'review', revision: fresh.view.revision }
            : { kind: 'stale', revision },
        );
      },
      undoneText: `已撤销，${receipt.versionId} 回到待确认`,
      failedText:
        '撤销结果待核实：点「重试」按原请求再发一次，或刷新页面查看当前发布状态',
    });
  }

  async function sendBack() {
    const reason = returnReason.current?.value.trim() ?? '';
    setBusy(true);
    const input = {
      draftId: revision.id,
      expectedRevision: revision.revision,
      reason,
    };
    const result = await settle(() =>
      ports.return({ operationId: operation.idFor('return', input), ...input }),
    );
    setBusy(false);
    if (result.status !== 'lost') setDialog(null);
    if (result.status !== 'success') {
      toast.show(actionFailure(result));
      return;
    }
    operation.done();
    setView({ kind: 'returned', revision: result.result, reason });
    toast.show(`已退回给${editor}修改，理由在${editor}的待办里`);
  }

  if (view.kind === 'stale')
    return (
      <div className="n-notice" role="alert">
        <Icon name="info" />
        <div>
          <b>状态已更新，刷新页面后按当前状态处理。</b>
          <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
            <Button
              className="n-btn--sm"
              type="button"
              onClick={() => location.reload()}
            >
              <Icon name="retry" />
              刷新
            </Button>
          </div>
        </div>
      </div>
    );

  if (view.kind === 'published')
    return (
      <div className="nt-grid">
        <div className="n-notice" role="status">
          <Icon name="stamp" />
          <div>
            <b>{view.receipt.versionId} 已发布，之后新建的期次默认用新版。</b>
            {view.receipt.nextCohort.name}建立时绑定 {view.receipt.versionId}
            ；已建立的期次保持 {view.receipt.previousVersionId}。
            {view.receipt.publishedBy.name} {monthDay(view.receipt.publishedAt)}{' '}
            确认发布。
          </div>
        </div>
        <article className="n-card">
          <h3 className="n-section-title">
            标准要点
            <span
              className="nt-muted"
              style={{ marginLeft: 'auto', fontWeight: 400 }}
            >
              {view.receipt.versionId}
            </span>
          </h3>
          <PointList points={applyChanges(base, changes)} />
        </article>
      </div>
    );

  return (
    <div className="n-revise">
      <div className="nt-grid">
        <div className="n-version">
          <span className="n-version__tag is-draft">
            {pending ? '待确认' : '已退回'} {revision.versionId}
          </span>
          <span className="nt-muted">
            在 {revision.baseVersionId} 上修订 · {editor}起草
            {revision.humanVersion
              ? ` · ${monthDay(revision.humanVersion.editedAt)} 提交`
              : ''}
          </span>
        </div>
        {view.kind === 'returned' ? (
          <div className="n-notice">
            <Icon name="info" />
            <div>
              <b>已退回给{editor}：</b>「{view.reason}」等{editor}
              改好后重新提交。
            </div>
          </div>
        ) : null}
        <article className="n-card">
          <h3 className="n-section-title">
            改了什么
            <span
              className="nt-muted"
              style={{ marginLeft: 'auto', fontWeight: 400 }}
            >
              {changes.length} 处
            </span>
          </h3>
          <ChangeTable changes={changes} />
        </article>
        <ImpactCard
          preview={revision.impactPreview}
          basisLines={basisLines}
          note="按这份草稿计算"
        />
      </div>
      <aside className="n-revise__check" aria-label="确认发布">
        <div className="n-checkbar">
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">修订理由</span>
            <p style={{ margin: 0, fontSize: 'var(--t-sm)', lineHeight: 1.65 }}>
              {revision.reason}
            </p>
          </div>
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">依据</span>
            <div className="nt-row">
              {basisLines.map((line) => (
                <span key={line} className="n-casechip">
                  <Icon name="split" />
                  {line}
                </span>
              ))}
            </div>
          </div>
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">兼容声明</span>
            <p className="n-checkbar__text">
              {compatText(revision.baseVersionId)}
            </p>
          </div>
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">生效点</span>
            <p className="n-checkbar__text">
              <EffectText
                preview={revision.impactPreview}
                baseVersionId={revision.baseVersionId}
              />
            </p>
          </div>
          <div className="n-checkbar__foot">
            {pending ? (
              <>
                <Button
                  className="n-btn--seal"
                  type="button"
                  id="confirm"
                  disabled={busy}
                  onClick={() => setDialog('publish')}
                >
                  <Icon name="stamp" />
                  确认发布 {revision.versionId}
                </Button>
                <Button
                  className="n-btn--ghost"
                  type="button"
                  id="return"
                  disabled={busy}
                  onClick={() => setDialog('return')}
                >
                  退回修改
                </Button>
              </>
            ) : (
              <div className="nt-row">
                <RevisionStateTag state="draft" />
                <span className="nt-muted">等{editor}修改后重新提交</span>
              </div>
            )}
          </div>
        </div>
      </aside>
      <ConfirmDialog
        open={dialog === 'publish'}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        title={`确认发布 ${revision.versionId}？`}
        description={`确认后 ${revision.versionId} 立即成为之后新建期次的默认版本，${revision.baseVersionId} 变为已替代；已建立的期次、选拔记录和判断对照保持原版本。`}
        facts={[`理由：${revision.reason}`, impactLine(revision.impactPreview)]}
        busy={busy}
        actions={[
          {
            id: 'cancel',
            label: '取消',
            variant: 'ghost',
            onSelect: () => setDialog(null),
          },
          {
            id: 'publish',
            label: `确认发布 ${revision.versionId}`,
            variant: 'seal',
            icon: 'stamp',
            onSelect: () => void publish(),
          },
        ]}
      />
      <ConfirmDialog
        open={dialog === 'return'}
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        title={`退回 ${revision.versionId}？`}
        description={`草稿回到${editor}那里，你写的理由会出现在${editor}的待办里。`}
        busy={busy}
        actions={[
          {
            id: 'cancel',
            label: '取消',
            variant: 'ghost',
            onSelect: () => setDialog(null),
          },
          {
            id: 'return',
            label: '退回修改',
            variant: 'ink',
            validate: () => Boolean(returnReason.current?.value.trim()),
            hint: '写一句退回理由',
            onSelect: () => void sendBack(),
          },
        ]}
      >
        <textarea
          ref={returnReason}
          className="n-textarea"
          rows={2}
          aria-label="退回理由"
          placeholder="比如：刚过线一档也写一句要看到什么"
        />
      </ConfirmDialog>
    </div>
  );
}
