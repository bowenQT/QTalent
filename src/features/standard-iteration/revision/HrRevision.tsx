'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type { SelectionRevision } from '@/contracts/selection-standard';
import { monthDay } from '../copy';
import { useOperation } from '../operation';
import {
  actionFailure,
  newOperationId,
  settle,
  type HrRevisionPorts,
} from '../ports';
import {
  ChangeTable,
  compatText,
  EffectText,
  ImpactCard,
  RevisionStateTag,
} from './parts';
import { ReviewPointsEditor } from './ReviewPointsEditor';
import {
  applyChanges,
  changeCount,
  changesBetween,
  hrBasisText,
  impactLine,
  stateLabel,
  type ReviewPoint,
} from './revision-view';

const sameChanges = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * HR revises the selection standard in place: edit review points, write the reason,
 * save (which recalculates the impact preview), then submit for the manager.
 */
export function HrRevision({
  initial,
  base,
  ports,
  judgeHref,
}: {
  initial: SelectionRevision;
  base: readonly ReviewPoint[];
  ports: HrRevisionPorts;
  judgeHref: string;
}) {
  const toast = useToast();
  const [revision, setRevision] = useState(initial);
  const saved = revision.humanVersion?.changes ?? [];
  const [working, setWorking] = useState(() => applyChanges(base, saved));
  const [reason, setReason] = useState(initial.reason);
  const [busy, setBusy] = useState(false);
  // A point open in the editor holds input that `working` does not have yet.
  const [pointOpen, setPointOpen] = useState(false);
  const [error, setError] = useState('');
  const operation = useOperation();
  const changes = changesBetween(base, working);
  const dirty = reason !== revision.reason || !sameChanges(changes, saved);
  const previewReady = revision.humanVersion !== null && !dirty;
  const draft = revision.state === 'draft';

  async function save() {
    const missing = pointOpen
      ? '保存或取消正在编辑的要点'
      : !changes.length
        ? '先改至少一处'
        : !reason.trim()
          ? '写修订理由'
          : '';
    if (missing) {
      setError(`保存前还要：${missing}。`);
      return;
    }
    setBusy(true);
    setError('');
    const input = {
      draftId: revision.id,
      expectedRevision: revision.revision,
      reason: reason.trim(),
      changes,
    };
    const result = await settle(() =>
      ports.save({ operationId: operation.idFor('save', input), ...input }),
    );
    setBusy(false);
    if (result.status !== 'success') {
      setError(actionFailure(result));
      return;
    }
    operation.done();
    setRevision(result.result);
    setReason(result.result.reason);
    toast.show('已保存草稿，影响预览已按当前草稿计算');
  }

  async function submit() {
    const missing = pointOpen
      ? '保存或取消正在编辑的要点'
      : !reason.trim()
        ? '写修订理由'
        : revision.humanVersion === null || dirty
          ? '保存当前修改，按当前草稿预览一次影响'
          : '';
    if (missing) {
      setError(`提交前还要：${missing}。`);
      return;
    }
    setBusy(true);
    setError('');
    const input = {
      draftId: revision.id,
      expectedRevision: revision.revision,
      expectedPreviewId: revision.impactPreview.id,
    };
    const result = await settle(() =>
      ports.submit({ operationId: operation.idFor('submit', input), ...input }),
    );
    setBusy(false);
    if (result.status !== 'success') {
      setError(actionFailure(result));
      return;
    }
    operation.done();
    const pending = result.result;
    setRevision(pending);
    // One undo intent: the toast's 重试 resends this exact command.
    const undo = {
      operationId: newOperationId(),
      draftId: pending.id,
      expectedRevision: pending.revision,
    };
    toast.show(`已提交 ${pending.versionId}，待管理者确认`, {
      onUndo: async () => {
        const back = await ports.withdraw(undo);
        if (back.status !== 'success') throw new Error(back.status);
        setRevision(back.result);
      },
      undoneText: `已撤回，${pending.versionId} 回到草稿`,
      failedText: `撤回结果待核实：点「重试」按原请求再发一次，或刷新页面查看 ${pending.versionId} 的当前状态`,
    });
  }

  async function withdraw() {
    setBusy(true);
    const input = { draftId: revision.id, expectedRevision: revision.revision };
    const result = await settle(() =>
      ports.withdraw({
        operationId: operation.idFor('withdraw', input),
        ...input,
      }),
    );
    setBusy(false);
    if (result.status !== 'success') {
      toast.show(actionFailure(result));
      return;
    }
    operation.done();
    setRevision(result.result);
    toast.show(`${result.result.versionId} 已回到草稿`);
  }

  const basis = hrBasisText(revision.basis);
  const ai = revision.aiDraft;
  return (
    <div className="n-revise">
      <div className="nt-grid">
        <div className="n-version">
          <span className="n-version__tag is-draft">
            {stateLabel[revision.state]} {revision.versionId}
          </span>
          <span className="nt-muted">
            在 {revision.baseVersionId} 上修订
            {revision.humanVersion
              ? ` · ${revision.humanVersion.editedBy.name}编辑 · ${monthDay(revision.humanVersion.editedAt)}`
              : ''}{' '}
            · {changeCount(changes)}
          </span>
        </div>
        {draft && revision.lastReturn ? (
          <div className="n-notice">
            <Icon name="info" />
            <div>
              <b>
                {revision.lastReturn.returnedBy.name}{' '}
                {monthDay(revision.lastReturn.returnedAt)} 退回：
              </b>
              「{revision.lastReturn.reason}」改好后重新预览再提交。
            </div>
          </div>
        ) : null}
        {draft && ai && revision.humanVersion === null ? (
          <div className="n-block" data-state="light">
            <ChangeTable changes={ai.changes} />
            <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
              <Button
                className="n-btn--sm"
                type="button"
                onClick={() => setWorking(applyChanges(base, ai.changes))}
              >
                <Icon name="check" />
                采用 AI 建议
              </Button>
            </div>
            <div className="n-block__by">
              <span className="n-src n-src--ai">
                <Icon name="spark" />
                AI 建议
              </span>
              按已确认的归因起草 · {monthDay(ai.generatedAt)}
            </div>
          </div>
        ) : null}
        <article className="n-card">
          <h3 className="n-section-title">
            标准要点
            <span
              className="nt-muted"
              style={{ marginLeft: 'auto', fontWeight: 400 }}
            >
              XEngineer 入营选拔标准
            </span>
          </h3>
          <ReviewPointsEditor
            base={base}
            working={working}
            editable={draft && !busy}
            onChange={(points) => {
              setError('');
              setWorking(points);
            }}
            onEditing={(open) => {
              setError('');
              setPointOpen(open);
            }}
            newId={() => `point-${newOperationId()}`}
          />
          <p className="nt-caption">
            {changes.length
              ? `和 ${revision.baseVersionId} 相比：${changeCount(changes)}。`
              : `还和 ${revision.baseVersionId} 一样。`}
          </p>
        </article>
        {previewReady ? (
          <ImpactCard
            preview={revision.impactPreview}
            basisLines={[basis]}
            note={`${revision.versionId} ${stateLabel[revision.state]} · 对比 ${revision.baseVersionId}`}
          />
        ) : null}
      </div>
      <aside className="n-revise__check" aria-label="发布前检查">
        <div className="n-checkbar">
          <div className="n-checkbar__sec">
            <label className="n-checkbar__label" htmlFor="why">
              修订理由
              <span className="is-ok">
                {reason.trim() ? (
                  <>
                    <Icon name="check" />
                    已写
                  </>
                ) : (
                  '必填'
                )}
              </span>
            </label>
            <textarea
              className="n-textarea"
              id="why"
              rows={3}
              placeholder="比如：优先录取一档只看作品成品，组队和个人分不开"
              value={reason}
              disabled={!draft || busy}
              onChange={(event) => {
                setError('');
                setReason(event.target.value);
              }}
            />
          </div>
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">依据</span>
            <div className="nt-row">
              <a className="n-casechip" href={judgeHref}>
                <Icon name="split" />
                {basis}
              </a>
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
          <div className="n-checkbar__sec">
            <span className="n-checkbar__label">
              影响预览
              {previewReady ? (
                <span className="is-ok">
                  <Icon name="check" />
                  已按当前草稿计算
                </span>
              ) : null}
            </span>
            {previewReady ? (
              <>
                <p className="n-checkbar__text">
                  {impactLine(revision.impactPreview)}
                </p>
                <a
                  className="n-link"
                  href="#impact"
                  style={{ justifySelf: 'start' }}
                >
                  看完整预览
                </a>
              </>
            ) : (
              <p className="n-checkbar__text">
                {changes.length
                  ? '草稿改过之后，保存一次，按当前草稿预览影响再提交。'
                  : '先在左边改，再保存并预览影响。'}
              </p>
            )}
            {draft && !previewReady ? (
              <Button
                className="n-btn--sm"
                type="button"
                id="preview"
                style={{ justifySelf: 'start' }}
                disabled={busy || !changes.length}
                onClick={() => void save()}
              >
                <Icon name="retry" />
                {busy ? '计算中…' : '保存并预览影响'}
              </Button>
            ) : null}
          </div>
          {draft ? (
            <div className="n-checkbar__foot">
              <Button
                className="n-btn--ink"
                type="button"
                id="submit"
                disabled={busy}
                onClick={() => void submit()}
              >
                提交管理者确认
              </Button>
              {error ? (
                <p className="n-field__err" role="alert">
                  {error}
                </p>
              ) : null}
              <p className="n-checkbar__text">
                提交给管理者确认发布；确认前你可以撤回到草稿。
              </p>
            </div>
          ) : (
            <div className="n-checkbar__foot">
              <div className="nt-row">
                <RevisionStateTag state={revision.state} />
                <span className="nt-muted">
                  {revision.state === 'pending_confirmation'
                    ? `已提交给管理者 · ${monthDay(revision.submittedAt)}`
                    : revision.state === 'active' ||
                        revision.state === 'superseded'
                      ? `${revision.publishedBy.name} ${monthDay(revision.publishedAt)} 确认发布`
                      : ''}
                </span>
              </div>
              {revision.state === 'pending_confirmation' ? (
                <Button
                  className="n-btn--sm n-btn--ghost"
                  type="button"
                  style={{ justifySelf: 'start' }}
                  disabled={busy}
                  onClick={() => void withdraw()}
                >
                  撤回到草稿
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
