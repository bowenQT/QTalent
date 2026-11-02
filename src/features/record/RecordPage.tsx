'use client';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useReducedMotion } from 'motion/react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { State } from '@/components/ui/State';
import { UNDO_MS, useToast } from '@/components/ui/Toast';
import { AnchorPanel, type AnchorLoad, type IdleAnchor } from './AnchorPanel';
import { receiptHref } from './batch-route';
import {
  buildSaveInput,
  reuseOperationId,
  saveKey,
  suggestedCount,
  untouchedCount,
} from './build-save-input';
import { copy } from './copy';
import { saveProblems } from './errors';
import { OrganizeHeader } from './OrganizeHeader';
import { OrganizeProgress } from './OrganizeProgress';
import { RawInput } from './RawInput';
import { BannerNotice, FailurePanel, HandoffPanel } from './RecordNotices';
import { recognizePerson } from './recognize';
import { RecordInput } from './RecordInput';
import {
  initialState,
  inputKey,
  isDirty,
  recordReducer,
  type Connection,
} from './record-flow';
import { sessionDraftEpoch } from '@/lib/session-drafts';
import { createSessionScope } from './session-scope';
import { SavedSign } from './SavedSign';
import { SbiEditor } from './SbiEditor';
import { ScoreList, type AnchorFocus } from './ScoreList';
import {
  scoreKey,
  type DimensionOption,
  type LoadAnchors,
  type PersonOption,
  type ProjectOption,
  type RecordActions,
  type RecordEntry,
} from './types';
import { useRecordBatch } from './use-record-batch';
import './record.css';

export const DEFAULT_MAX_LENGTH = 2000;
const AUTO_START_MS = 300;
const STASH_DEBOUNCE_MS = 400;

export type RecordPageProps = {
  accountId: string;
  /** 署名行用：当前账号的显示名与角色名，由页面读取提供。 */
  accountName: string;
  roleLabel: string;
  /** 当前账号有记录权限的人；范围由服务端决定，页面不判断角色。 */
  people: readonly PersonOption[];
  projects: readonly ProjectOption[];
  dimensions: readonly DimensionOption[];
  actions: RecordActions;
  loadAnchors: LoadAnchors;
  /** 还没有分可看时右栏显示的锚点（原型默认内生动力），由页面读取提供；缺省显示提示句。 */
  idleAnchor?: IdleAnchor;
  entry?: RecordEntry;
  /** 非生产环境显示带化名的示例占位。 */
  showExample?: boolean;
  maxLength?: number;
  /** 附件入口与列表（BOW-870 接入），本页只留位置。 */
  attachmentSlot?: ReactNode;
  /** 批次 id 变化时通知页面更新 URL（`?batch=`），原话永远不进 URL。 */
  onBatchChange?: (batchId: string | null) => void;
  newId?: () => string;
};

type Confirm = 'discard' | 'load' | null;

function defaultNewId() {
  return crypto.randomUUID();
}

/**
 * 记一件事：写原话 → 整理 → 确认或改分 → 保存，5 秒内可撤销。
 * 按账号重新挂载：换账号后上一个账号的原话、任务和计时都不会带到新账号下（含输入暂存）。
 */
export function RecordPage(props: RecordPageProps) {
  return <RecordFlow key={props.accountId} {...props} />;
}

function RecordFlow(props: RecordPageProps) {
  const {
    accountId,
    people,
    projects,
    dimensions,
    entry,
    maxLength = DEFAULT_MAX_LENGTH,
    newId = defaultNewId,
  } = props;
  // 会话代纪门闸：挂载时记下代纪，动作和暂存都只经它（session-scope）。退出或换账号后，
  // 这个实例发起过的请求不再改状态，也不再读写暂存。
  const [epoch] = useState(sessionDraftEpoch);
  const scope = useMemo(
    () =>
      createSessionScope(accountId, epoch, props.actions, props.loadAnchors),
    [accountId, epoch, props.actions, props.loadAnchors],
  );
  const { actions, drafts } = scope;
  const toast = useToast();
  const reduced = Boolean(useReducedMotion());
  const [state, dispatch] = useReducer(recordReducer, undefined, () =>
    initialState({
      personId: people.some((p) => p.id === entry?.personId)
        ? (entry?.personId ?? null)
        : null,
      batchId: entry?.batchId,
    }),
  );
  const { phase, draft, edit } = state;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const loadSeq = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [copyOut, setCopyOut] = useState<string | null>(null);
  const [missing, setMissing] = useState<{
    title?: boolean;
    behavior?: boolean;
  }>({});
  const [settling, setSettling] = useState(false);
  const [focus, setFocus] = useState<AnchorFocus | null>(null);
  const [anchorTry, setAnchorTry] = useState(0);
  const [autoStart, setAutoStart] = useState(false);

  // ---------- 批次进度 ----------
  const listening = phase === 'organizing' && !state.failure;
  const batch = useRecordBatch(
    listening ? state.batchId : null,
    actions.readBatch,
  );
  useEffect(() => {
    if (batch.receipt) dispatch({ type: 'batch', batch: batch.receipt });
  }, [batch.receipt]);
  useEffect(() => {
    if (!listening) return;
    const mapped: Connection =
      batch.connection === 'error'
        ? 'error'
        : batch.connection === 'gone'
          ? 'gone'
          : 'connected';
    dispatch({ type: 'connection', connection: mapped });
  }, [batch.connection, listening]);

  // 批次 id 变化时通知页面换 URL
  const reportedBatch = useRef<string | null>(entry?.batchId ?? null);
  const onBatchChange = useEffectEvent((id: string | null) =>
    props.onBatchChange?.(id),
  );
  useEffect(() => {
    if (reportedBatch.current === state.batchId) return;
    reportedBatch.current = state.batchId;
    onBatchChange(state.batchId);
  }, [state.batchId]);

  // ---------- 进入：工作台交接 / 输入暂存 ----------
  const dispatchEntry = useEffectEvent(() => {
    if (entry?.batchId) {
      const kept = drafts.restoreBatchInput(entry.batchId);
      if (kept) {
        dispatch({ type: 'text', text: kept.text });
        if (people.some((p) => p.id === kept.personId))
          dispatch({ type: 'person', personId: kept.personId });
      }
      return;
    }
    if (entry?.handoff) {
      const text = drafts.takeHandoff();
      if (text) {
        dispatch({ type: 'text', text });
        setAutoStart(true);
      }
      return;
    }
    const restored = drafts.restoreInput();
    if (restored) {
      dispatch({ type: 'text', text: restored.text });
      if (people.some((p) => p.id === restored.personId))
        dispatch({ type: 'person', personId: restored.personId });
    }
  });
  useEffect(() => {
    // 会话暂存只在浏览器里读得到；放进微任务，严格模式重复挂载时前一次会被取消
    let live = true;
    queueMicrotask(() => {
      if (live) dispatchEntry();
    });
    return () => {
      live = false;
    };
  }, []);

  // 输入态防抖写入会话暂存（D19）；开始整理或保存后删除
  useEffect(() => {
    if (phase !== 'write') return;
    // 经门闸写入：退出或换账号后到点也不写回
    const timer = setTimeout(
      () => drafts.stashInput({ text: state.text, personId: state.personId }),
      STASH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [drafts, phase, state.text, state.personId]);

  // 未保存内容：硬离开时提示
  const dirty = isDirty(state);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // 卸载时收起撤销之外的计时
  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  // ---------- 锚点 ----------
  const anchorKey = useMemo(() => {
    if (!draft || phase === 'write' || phase === 'organizing') return null;
    const suggested = draft.scores.filter((s) => s.state === 'suggested');
    if (suggested.length === 0) return null;
    return JSON.stringify([
      [...new Set(suggested.map((s) => s.personId))].sort(),
      [
        ...new Set(
          suggested.flatMap((s) =>
            s.state === 'suggested' ? [s.anchor.ruleVersion] : [],
          ),
        ),
      ].sort(),
      anchorTry,
    ]);
  }, [draft, phase, anchorTry]);
  const [anchorResult, setAnchorResult] = useState<{
    key: string;
    load: AnchorLoad;
  } | null>(null);
  const loadAnchors = scope.loadAnchors;
  useEffect(() => {
    if (!anchorKey) return;
    let live = true;
    const [personIds, ruleVersions] = JSON.parse(anchorKey) as [
      string[],
      string[],
    ];
    loadAnchors({ personIds, ruleVersions }).then(
      (map) =>
        live &&
        setAnchorResult({ key: anchorKey, load: { status: 'ready', map } }),
      () =>
        live && setAnchorResult({ key: anchorKey, load: { status: 'error' } }),
    );
    return () => {
      live = false;
    };
  }, [anchorKey, loadAnchors]);
  const anchorLoad: AnchorLoad =
    anchorKey && anchorResult?.key === anchorKey
      ? anchorResult.load
      : anchorKey
        ? { status: 'loading' }
        : { status: 'ready', map: {} };

  // 阶段切换：待确认时把焦点交给标题；没选人、节点待定时交给「谁」
  useEffect(() => {
    if (phase === 'review')
      articleRef.current
        ?.querySelector<HTMLElement>('[data-k="title"]')
        ?.focus({ preventScroll: true });
  }, [phase, draft?.draftId]);
  useEffect(() => {
    if (state.banner?.kind === 'node' && !state.banner.picked)
      document.getElementById('ev-person')?.focus();
  }, [state.banner]);

  // ---------- 动作 ----------
  const personName = useCallback(
    (id: string) =>
      people.find((p) => p.id === id)?.name ?? copy.header.unknownPerson,
    [people],
  );

  async function start(fresh = false) {
    const text = state.text.trim();
    if (!text) {
      textareaRef.current?.focus();
      return;
    }
    if (state.text.length > maxLength) return;
    // 「从原话里识别」：按候选姓名精确匹配，认出恰好一位就填进「谁」；认不出时下面的推导返回
    // none，页面提示选人并把焦点交给「谁」。
    const personId = state.personId ?? recognizePerson(state.text, people);
    if (personId !== state.personId) dispatch({ type: 'person', personId });
    const personIds = personId ? [personId] : [];
    const input = { text: state.text, personId };
    dispatch({ type: 'submit_begin' });
    try {
      // 评价节点由服务端按所选人员推导；不唯一时说明原因，不提交（#248 6564917769）。
      if (!actions.resolveNode) {
        dispatch({ type: 'node_unresolved', reason: 'pending' });
        return;
      }
      const node = await actions.resolveNode({ personIds, projectId: null });
      if (node.status !== 'unique') {
        dispatch({ type: 'node_unresolved', reason: node.status });
        return;
      }
      // 同样的原话、人员和节点复用同一个 operation_id：服务端按它重放，不会产生两个批次。
      const op = reuseOperationId(
        fresh ? null : state.startOp,
        JSON.stringify([inputKey(input), node.evaluationNodeId]),
        newId,
      );
      dispatch({ type: 'submit_begin', op });
      drafts.clearInput();
      const result = await actions.submit({
        operationId: op.id,
        evaluationNodeId: node.evaluationNodeId,
        personIds,
        projectId: null,
        text,
        // 附件入口待接通（BOW-870）；897 入口目前只收文本
        files: [],
      });
      if (result.status === 'success') {
        drafts.stashBatchInput(result.result.batchId, input);
        dispatch({ type: 'batch_begin', batch: result.result });
      } else {
        dispatch({
          type: 'submit_refused',
          message:
            result.status === 'validation_error'
              ? copy.banner.startRefused
              : result.message,
          forbidden:
            result.status === 'forbidden' || result.status === 'not_found',
        });
      }
    } catch {
      dispatch({ type: 'submit_offline' });
    }
  }
  const startFromEffect = useEffectEvent(() => void start());
  useEffect(() => {
    if (!autoStart) return;
    const timer = setTimeout(() => {
      setAutoStart(false);
      startFromEffect();
    }, AUTO_START_MS);
    return () => clearTimeout(timer);
  }, [autoStart]);

  async function save() {
    if (!draft || !edit) return;
    const probe = buildSaveInput(draft, edit, state.saveOp?.id ?? 'pending');
    if (!probe.ok) {
      if (probe.reason === 'empty_title' || probe.reason === 'empty_behavior') {
        const next = {
          title: probe.reason === 'empty_title',
          behavior:
            probe.reason === 'empty_behavior' ||
            edit.sbi.behavior.trim() === '',
        };
        setMissing(next);
        articleRef.current
          ?.querySelector<HTMLElement>(
            next.title ? '[data-k="title"]' : '[data-k="behavior"]',
          )
          ?.focus();
      } else if (probe.reason === 'invalid') {
        dispatch({
          type: 'save_problems',
          problems: { scores: {}, general: true },
        });
      }
      return;
    }
    setMissing({});
    const { operation_id: _ignored, ...content } = probe.input;
    void _ignored;
    const op = reuseOperationId(state.saveOp, saveKey(content), newId);
    const input = { ...probe.input, operation_id: op.id };
    dispatch({ type: 'save_begin', op });
    try {
      const result = await actions.save(input);
      if (result.status === 'success') {
        drafts.clearInput();
        dispatch({
          type: 'save_saved',
          receipt: result.result,
          replayed: result.replayed,
        });
        settle();
        announceSaved(result.result, result.replayed);
      } else if (result.status === 'validation_error') {
        dispatch({
          type: 'save_problems',
          problems: saveProblems(result.fieldErrors, input.decisions),
        });
      } else if (result.status === 'conflict') {
        dispatch({ type: 'save_conflict', message: result.message });
      } else if (result.status === 'unavailable') {
        dispatch({ type: 'save_unavailable' });
      } else {
        dispatch({ type: 'save_forbidden', message: result.message });
      }
    } catch {
      dispatch({ type: 'save_offline' });
    }
  }

  function settle() {
    if (reduced) return;
    setSettling(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettling(false), 700);
  }

  function announceSaved(
    receipt: NonNullable<typeof state.receipt>,
    replayed: boolean,
  ) {
    const names = receipt.events
      .map((event) => personName(event.personId))
      .join(copy.saved.peopleJoin);
    const message = copy.saved.toast(names, receipt.reviewItemIds.length);
    // 重放说明首次响应丢了，原撤销窗口可能已过：只提示，不给撤销
    if (replayed) {
      toast.show(message);
      return;
    }
    // 撤销窗口以回执的 undoUntil 为准（服务端只接受 undoUntil 之前的撤销）；
    // 提示自身最长 5 秒，剩余不足时提前收起，已过则不给撤销入口
    const undoUntil = Date.parse(receipt.undoUntil);
    const remaining = undoUntil - Date.now();
    if (!(remaining > 0)) {
      toast.show(message);
      return;
    }
    const undoOperation = newId();
    const close = toast.show(message, {
      undoneText: copy.saved.undone,
      failedText: copy.saved.undoFailed,
      retryLabel: copy.saved.undoRetry,
      onUndo: async () => {
        if (Date.now() >= undoUntil) {
          close();
          toast.show(copy.saved.undoLate);
          return;
        }
        // 网络失败时让它抛出，Toast 会显示失败并给重试（同一 operation_id）
        const result = await actions.undo({
          operation_id: undoOperation,
          saveId: receipt.saveId,
        });
        if (result.status === 'success') {
          dispatch({ type: 'undone' });
          return;
        }
        // 业务终局失败不是「可重试」：收起原提示，另发一条说明
        close();
        toast.show(
          result.status === 'forbidden' || result.status === 'not_found'
            ? result.message
            : copy.saved.undoLate,
        );
      },
    });
    if (remaining < UNDO_MS) setTimeout(close, remaining);
  }

  function requestBack() {
    if (phase === 'review' && dirty) setConfirm('discard');
    else dispatch({ type: 'back_to_write' });
  }

  async function loadLatest() {
    if (!draft || !state.batchId) return;
    setConfirm(null);
    // 只认最后一次读取；读取期间又改过内容时不覆盖（reducer 按 basis 判断）
    const seq = ++loadSeq.current;
    const basis = edit;
    // 读取失败时留在当前草稿上，修改都还在，冲突提示和它的出口也保留
    const refused = (message: string) =>
      dispatch({ type: 'banner', banner: { kind: 'conflict', message } });
    try {
      const result = await actions.readBatch({ batchId: state.batchId });
      if (seq !== loadSeq.current) return;
      if (result.status !== 'success') {
        refused(
          result.status === 'validation_error'
            ? copy.banner.loadFailed
            : result.message,
        );
        return;
      }
      const latest = result.result.draftSet?.drafts.find(
        (item) => item.draftId === draft.draftId,
      );
      // 这件事已不在待确认里（别处已确认或撤回）：如实说明，交给回执页看，不在本页绕过。
      if (latest) dispatch({ type: 'draft_loaded', draft: latest, basis });
      else refused(copy.conflict.draftGone);
    } catch {
      if (seq === loadSeq.current) refused(copy.banner.loadFailed);
    }
  }

  function openCopyOut() {
    if (state.banner?.kind === 'forbidden' || !edit) setCopyOut(state.text);
    else
      setCopyOut(
        [
          edit.sbi.title,
          `${copy.sbi.situation}：${edit.sbi.situation}`,
          `${copy.sbi.behavior}：${edit.sbi.behavior}`,
          `${copy.sbi.impact}：${edit.sbi.impact}`,
          '',
          `${copy.sbi.rawSummary}：${state.text}`,
        ].join('\n'),
      );
  }

  // ---------- 派生视图 ----------
  const personIds = draft?.personIds ?? [];
  const projectId = draft?.projectId ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const firstSuggested = draft?.scores.find((s) => s.state === 'suggested');
  const anchorFocus: AnchorFocus | null =
    focus ??
    (firstSuggested
      ? {
          personId: firstSuggested.personId,
          dimensionId: firstSuggested.dimensionId,
          hit: null,
        }
      : null);
  const focusedValue = anchorFocus
    ? edit?.scores[scoreKey(anchorFocus.personId, anchorFocus.dimensionId)]
        ?.value
    : undefined;
  const shownFocus =
    anchorFocus && anchorFocus.hit === null && focusedValue !== undefined
      ? { ...anchorFocus, hit: focusedValue }
      : anchorFocus;
  const step =
    phase === 'saved'
      ? 'done'
      : phase === 'write' || phase === 'submitting'
        ? 'write'
        : 'shaped';
  const niu = state.failure
    ? 'error'
    : phase === 'saved'
      ? 'done'
      : phase === 'review' || phase === 'handoff'
        ? 'confirm'
        : 'thinking';
  const pending = draft ? untouchedCount(draft, edit!) : 0;
  const live =
    phase === 'organizing' && !state.failure
      ? copy.live.organizing
      : phase === 'review' && draft
        ? copy.live.ready(suggestedCount(draft))
        : phase === 'saved'
          ? copy.live.saved
          : '';
  const hintText =
    !draft || suggestedCount(draft) === 0
      ? copy.hint.noScores
      : pending > 0
        ? copy.hint.pending(pending)
        : copy.hint.allConfirmed;
  const inputBusy = phase === 'submitting';

  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{copy.page.title}</h1>
          <p>{copy.page.lead}</p>
        </div>
      </header>
      <div className="nt-split">
        <article
          ref={articleRef}
          className={`n-card n-event${settling ? ' is-settling' : ''}`}
          id="ev"
          data-step={step}
        >
          {state.connection === 'gone' ? (
            <State
              title={copy.connection.goneTitle}
              text={copy.connection.goneText}
            >
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ink"
                onClick={() => dispatch({ type: 'back_to_write' })}
              >
                {copy.connection.goneAction}
              </button>
            </State>
          ) : step === 'write' ? (
            <>
              <RecordInput
                people={people}
                personId={state.personId}
                text={state.text}
                maxLength={maxLength}
                submitting={inputBusy}
                showExample={Boolean(props.showExample)}
                attachmentSlot={props.attachmentSlot}
                textareaRef={textareaRef}
                onText={(text) => dispatch({ type: 'text', text })}
                onPerson={(personId) => dispatch({ type: 'person', personId })}
                onSubmit={() => void start()}
              />
              <BannerNotice
                banner={state.banner}
                onRetry={() => void start()}
                onLoadLatest={() => undefined}
                onCopyOut={openCopyOut}
                onBack={requestBack}
              />
            </>
          ) : (
            <>
              <OrganizeHeader
                personIds={
                  personIds.length > 0
                    ? personIds
                    : state.personId
                      ? [state.personId]
                      : []
                }
                people={people}
                project={project}
                origin="text"
                niu={niu}
              />
              <div id="ev-body">
                <BannerNotice
                  banner={state.banner}
                  onRetry={() => {
                    if (phase === 'review') void save();
                    else void start();
                  }}
                  onLoadLatest={() => setConfirm('load')}
                  onCopyOut={openCopyOut}
                  onBack={requestBack}
                />
                <OrganizeProgress
                  processing={phase === 'organizing'}
                  failure={state.failure?.kind ?? null}
                  connection={state.connection}
                  complete={phase !== 'organizing'}
                />
                {state.failure ? (
                  <FailurePanel
                    failure={state.failure.kind}
                    canReorganize={
                      state.failure.retryable && state.text.trim() !== ''
                    }
                    onReorganize={() => void start(true)}
                    onEdit={() => dispatch({ type: 'back_to_write' })}
                  />
                ) : phase === 'handoff' && state.handoff && state.batchId ? (
                  <HandoffPanel
                    reason={state.handoff}
                    href={receiptHref(state.batchId)}
                    onEdit={() => dispatch({ type: 'back_to_write' })}
                    onCopyOut={state.text.trim() ? openCopyOut : null}
                  />
                ) : draft && edit ? (
                  <>
                    <SbiEditor
                      sbi={edit.sbi}
                      editable={phase === 'review'}
                      problems={state.problems}
                      required={missing}
                      onChange={(field, value) => {
                        setMissing({});
                        dispatch({ type: 'edit_sbi', field, value });
                      }}
                    />
                    <RawInput text={state.text} />
                    <div id="ev-att-slot">{props.attachmentSlot}</div>
                    <ScoreList
                      draft={draft}
                      edit={edit}
                      people={people}
                      dimensions={dimensions}
                      saved={phase === 'saved'}
                      pickDisabled={
                        anchorLoad.status === 'error' || phase === 'saving'
                      }
                      problems={state.problems}
                      loadSource={actions.loadSource}
                      inputFragmentId={state.batch?.textMaterial?.materialId}
                      onPick={(key, value) =>
                        dispatch({ type: 'edit_score', key, value })
                      }
                      onReason={(key, reason) =>
                        dispatch({ type: 'edit_reason', key, reason })
                      }
                      onPreview={setFocus}
                    />
                    {phase === 'saved' && state.receipt ? (
                      <SavedSign
                        receipt={state.receipt}
                        people={people}
                        accountName={props.accountName}
                        roleLabel={props.roleLabel}
                      />
                    ) : (
                      <div
                        className="nt-row"
                        style={{ marginTop: 'var(--s-4)' }}
                        id="ev-actions"
                      >
                        <button
                          type="button"
                          className="n-btn n-btn--sm n-btn--ink"
                          id="ev-save"
                          disabled={phase === 'saving'}
                          aria-busy={phase === 'saving' || undefined}
                          aria-describedby="score-hint"
                          onClick={() => void save()}
                        >
                          <Icon name="check" />
                          {phase === 'saving'
                            ? copy.actions.saving
                            : copy.actions.save}
                        </button>
                        <button
                          type="button"
                          className="n-btn n-btn--sm n-btn--ghost"
                          id="ev-back"
                          disabled={phase === 'saving'}
                          onClick={requestBack}
                        >
                          {copy.actions.back}
                        </button>
                        <span className="n-eventin__hint" id="score-hint">
                          {hintText}
                        </span>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </>
          )}
        </article>
        <aside className="nt-grid nt-sticky">
          <AnchorPanel
            focus={shownFocus}
            load={anchorLoad}
            dimensions={dimensions}
            idle={props.idleAnchor}
            onRetry={() => setAnchorTry((n) => n + 1)}
          />
          <div className="n-card" style={{ padding: 'var(--s-4) var(--s-5)' }}>
            <b style={{ fontSize: 'var(--t-sm)' }}>{copy.page.howTitle}</b>
            <p className="nt-caption">{copy.page.howBody}</p>
          </div>
        </aside>
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {live}
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm === 'load'
            ? copy.confirm.loadTitle
            : copy.confirm.discardTitle
        }
        description={
          confirm === 'load' ? copy.confirm.loadText : copy.confirm.discardText
        }
        actions={[
          {
            id: 'cancel',
            label: copy.actions.keepEditing,
            variant: 'ghost',
            onSelect: () => setConfirm(null),
          },
          {
            id: 'ok',
            label: confirm === 'load' ? copy.actions.load : copy.actions.back,
            variant: 'ink',
            onSelect: () => {
              if (confirm === 'load') void loadLatest();
              else {
                setConfirm(null);
                dispatch({ type: 'back_to_write' });
              }
            },
          },
        ]}
      />
      {copyOut !== null ? (
        <div
          className="n-card"
          style={{ margin: 'var(--s-4) 0', padding: 'var(--s-4)' }}
        >
          <label className="n-eventin__label" htmlFor="ev-copy">
            {copy.conflict.copyLabel}
          </label>
          <textarea
            id="ev-copy"
            className="n-eventin__field"
            rows={8}
            readOnly
            value={copyOut}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
            <button
              type="button"
              className="n-btn n-btn--sm n-btn--ghost"
              onClick={() => setCopyOut(null)}
            >
              {copy.actions.keepEditing}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
