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
import {
  buildSaveInput,
  hasUnresolvedSelection,
  resolvedPersonIds,
  resolvedProjectId,
  reuseOperationId,
  saveKey,
  suggestedCount,
  untouchedCount,
  type OperationId,
} from './build-save-input';
import { copy } from './copy';
import {
  commandFailureMessage,
  saveProblems,
  type FailureKind,
} from './errors';
import { OrganizeHeader } from './OrganizeHeader';
import { OrganizeProgress } from './OrganizeProgress';
import { RawInput } from './RawInput';
import { BannerNotice, FailurePanel } from './RecordNotices';
import { RecordInput } from './RecordInput';
import {
  initialState,
  inputKey,
  isDirty,
  recordReducer,
  type Connection,
} from './record-flow';
import {
  clearRecordInputStash,
  restoreInput,
  stashInput,
  takeHandoff,
} from './record-handoff';
import { SavedSign } from './SavedSign';
import { SbiEditor } from './SbiEditor';
import { ScoreList, type AnchorFocus } from './ScoreList';
import { SelectionPanel } from './SelectionPanel';
import {
  scoreKey,
  type DimensionOption,
  type LoadAnchors,
  type PersonOption,
  type ProjectOption,
  type RecordActions,
  type RecordEntry,
  type RecordJob,
} from './types';
import { useRecordJob, type ReadRecordJob } from './use-record-job';
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
  /** 演示数据：头部显示「演示」徽标。 */
  demo?: boolean;
  /** 非生产环境显示带化名的示例占位。 */
  showExample?: boolean;
  maxLength?: number;
  /** 附件入口与列表（BOW-870 接入），本页只留位置。 */
  attachmentSlot?: ReactNode;
  /** 测试替身；默认读 /api/jobs/{id}。 */
  readJob?: ReadRecordJob;
  /** 任务 id 变化时通知页面更新 URL（`?job=`），原话永远不进 URL。 */
  onJobChange?: (jobId: string | null) => void;
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
    actions,
    entry,
    maxLength = DEFAULT_MAX_LENGTH,
    newId = defaultNewId,
  } = props;
  const toast = useToast();
  const reduced = Boolean(useReducedMotion());
  const [state, dispatch] = useReducer(recordReducer, undefined, () =>
    initialState({
      personId: people.some((p) => p.id === entry?.personId)
        ? (entry?.personId ?? null)
        : null,
      draft: entry?.draft,
      jobId: entry?.jobId,
    }),
  );
  const { phase, draft, edit } = state;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const selectionOp = useRef<OperationId | null>(null);
  const retryOp = useRef<OperationId | null>(null);
  const lastChoice = useRef<{
    personIds: string[];
    projectId: string | null;
  } | null>(null);
  const loadSeq = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [copyOut, setCopyOut] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<{
    title?: boolean;
    behavior?: boolean;
  }>({});
  const [settling, setSettling] = useState(false);
  const [focus, setFocus] = useState<AnchorFocus | null>(null);
  const [anchorTry, setAnchorTry] = useState(0);
  const [autoStart, setAutoStart] = useState(false);

  // ---------- 任务订阅 ----------
  const listening = phase === 'organizing' || phase === 'selecting';
  const job = useRecordJob(listening ? state.jobId : null, props.readJob);
  const { snapshot, connection, refresh } = job;
  useEffect(() => {
    if (snapshot) dispatch({ type: 'job', job: snapshot });
  }, [snapshot]);
  useEffect(() => {
    if (!listening) return;
    const mapped: Connection =
      connection === 'error'
        ? 'error'
        : connection === 'forbidden' || connection === 'not_found'
          ? 'gone'
          : 'connected';
    dispatch({ type: 'connection', connection: mapped });
  }, [connection, listening]);

  // 任务 id 变化时通知页面换 URL
  const reportedJob = useRef<string | null>(entry?.jobId ?? null);
  const onJobChange = useEffectEvent((id: string | null) =>
    props.onJobChange?.(id),
  );
  useEffect(() => {
    if (reportedJob.current === state.jobId) return;
    reportedJob.current = state.jobId;
    onJobChange(state.jobId);
  }, [state.jobId]);

  // ---------- 进入：工作台交接 / 输入暂存 ----------
  const dispatchEntry = useEffectEvent(() => {
    if (entry?.draft || entry?.jobId) return;
    if (entry?.handoff) {
      const text = takeHandoff(accountId);
      if (text) {
        dispatch({ type: 'text', text });
        setAutoStart(true);
      }
      return;
    }
    const restored = restoreInput(accountId);
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
    const timer = setTimeout(
      () =>
        stashInput(accountId, { text: state.text, personId: state.personId }),
      STASH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [accountId, phase, state.text, state.personId]);

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
  const loadAnchors = props.loadAnchors;
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

  // 阶段切换：待确认时把焦点交给标题；识别不到人时交给「谁」
  useEffect(() => {
    if (phase === 'review')
      articleRef.current
        ?.querySelector<HTMLElement>('[data-k="title"]')
        ?.focus({ preventScroll: true });
  }, [phase, draft?.draftId]);
  useEffect(() => {
    if (state.banner?.kind === 'who')
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
    const op = reuseOperationId(
      fresh ? null : state.startOp,
      inputKey(state),
      newId,
    );
    dispatch({ type: 'submit_begin', op });
    clearRecordInputStash();
    try {
      const result = await actions.start({
        operation_id: op.id,
        text,
        attachmentIds: state.attachmentIds,
        personId: state.personId,
        projectId: null,
      });
      if (result.status === 'success') {
        retryOp.current = null;
        dispatch({
          type: 'job_begin',
          jobId: result.result.jobId,
          job: result.result,
        });
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

  async function chooseSelection(choice: {
    personIds: string[];
    projectId: string | null;
  }) {
    const selection = state.selection;
    if (!selection) return;
    const op = reuseOperationId(
      selectionOp.current,
      JSON.stringify([
        selection.draftId,
        selection.inputVersion,
        choice.personIds,
        choice.projectId,
      ]),
      newId,
    );
    selectionOp.current = op;
    lastChoice.current = choice;
    dispatch({ type: 'select_begin' });
    try {
      const result = await actions.selectPeople({
        operation_id: op.id,
        draftId: selection.draftId,
        expected_input_version: selection.inputVersion,
        personIds: choice.personIds,
        projectId: choice.projectId,
      });
      if (result.status === 'success')
        dispatch({
          type: 'job_begin',
          jobId: result.result.jobId,
          job: result.result,
        });
      else
        dispatch({
          type: 'submit_refused',
          message:
            result.status === 'validation_error'
              ? copy.banner.startRefused
              : result.message,
          forbidden:
            result.status === 'forbidden' || result.status === 'not_found',
        });
    } catch {
      dispatch({ type: 'submit_offline' });
    }
  }

  async function reorganize() {
    const current = state.job;
    if (current?.canRetry) {
      const op = reuseOperationId(
        retryOp.current,
        `${current.jobId}:${current.revision}`,
        newId,
      );
      retryOp.current = op;
      setRetrying(true);
      setCommandMessage(null);
      try {
        const result = await actions.retryJob({
          jobId: current.jobId,
          action: 'retry',
          operationId: op.id,
          expectedRevision: current.revision,
        });
        if (result.status === 'success') {
          retryOp.current = null;
          dispatch({ type: 'job', job: result.snapshot as RecordJob });
          // 失败态的订阅已停止读取，命令成功后必须唤醒
          refresh();
        } else {
          setCommandMessage(commandFailureMessage(result.status));
        }
      } catch {
        setCommandMessage(copy.failure.commandFailed);
      } finally {
        setRetrying(false);
      }
      return;
    }
    // 不能原任务重试时，用同一原话发起新整理（新 operation_id）
    await start(true);
  }

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
        clearRecordInputStash();
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
          dispatch({
            type: 'undone',
            originalInput: result.result.originalInput,
          });
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
    if (!draft) return;
    setConfirm(null);
    // 只认最后一次读取；读取期间又改过内容时不覆盖（reducer 按 basis 判断）
    const seq = ++loadSeq.current;
    const basis = edit;
    // 读取失败时留在当前草稿上，修改都还在，冲突提示和它的出口也保留
    const refused = (message: string) =>
      dispatch({ type: 'banner', banner: { kind: 'conflict', message } });
    try {
      const result = await actions.openDraft({ draftId: draft.draftId });
      if (seq !== loadSeq.current) return;
      if (result.status === 'success')
        dispatch({ type: 'draft_loaded', draft: result.result, basis });
      else
        refused(
          result.status === 'validation_error'
            ? copy.banner.loadFailed
            : result.message,
        );
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
  const personIds = draft ? resolvedPersonIds(draft) : [];
  const projectId = draft ? resolvedProjectId(draft) : null;
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
      : phase === 'write' || (phase === 'submitting' && !state.selection)
        ? 'write'
        : 'shaped';
  const niu = state.failure
    ? 'error'
    : phase === 'saved'
      ? 'done'
      : phase === 'review' || phase === 'selecting'
        ? 'confirm'
        : 'thinking';
  const pending = draft ? untouchedCount(draft, edit!) : 0;
  const blocked = draft ? hasUnresolvedSelection(draft) : false;
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
  const inputBusy = phase === 'submitting' && !state.selection;

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
                hint={
                  state.banner?.kind === 'who' ? (
                    <>
                      <span style={{ color: 'var(--conflict)' }}>
                        {copy.input.whoMissingLead}
                      </span>
                      {copy.input.whoMissingRest}
                    </>
                  ) : undefined
                }
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
                origin={draft?.origin ?? 'text'}
                demo={Boolean(props.demo)}
                niu={niu}
              />
              <div id="ev-body">
                <BannerNotice
                  banner={state.banner}
                  onRetry={() => {
                    if (phase === 'review') void save();
                    else if (
                      state.banner?.kind === 'offline' &&
                      state.banner.scope === 'select' &&
                      lastChoice.current
                    )
                      void chooseSelection(lastChoice.current);
                    else void start();
                  }}
                  onLoadLatest={() => setConfirm('load')}
                  onCopyOut={openCopyOut}
                  onBack={requestBack}
                />
                <OrganizeProgress
                  job={state.job}
                  failure={state.failure}
                  connection={state.connection}
                  complete={Boolean(draft)}
                />
                {state.failure ? (
                  <FailurePanel
                    failure={state.failure as FailureKind}
                    canReorganize={
                      Boolean(state.job?.canRetry) || state.text.trim() !== ''
                    }
                    busy={retrying}
                    commandMessage={commandMessage}
                    onReorganize={() => void reorganize()}
                    onEdit={() => dispatch({ type: 'back_to_write' })}
                  />
                ) : state.selection &&
                  (phase === 'selecting' || phase === 'submitting') ? (
                  <SelectionPanel
                    selection={state.selection}
                    people={people}
                    busy={phase === 'submitting'}
                    onSubmit={(choice) => void chooseSelection(choice)}
                    onEdit={() => dispatch({ type: 'back_to_write' })}
                  />
                ) : draft && edit ? (
                  <>
                    {state.selection && phase === 'review' ? (
                      <SelectionPanel
                        selection={state.selection}
                        people={people}
                        busy={false}
                        onSubmit={(choice) => void chooseSelection(choice)}
                      />
                    ) : null}
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
                    <RawInput text={draft.originalInput.text} />
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
                          disabled={phase === 'saving' || blocked}
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
                          {blocked ? copy.selection.saveBlocked : hintText}
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
