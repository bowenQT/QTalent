'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordBatchDraft } from '@/contracts/record';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Progress } from '@/components/ui/Progress';
import { UNDO_MS, useToast } from '@/components/ui/Toast';
import { Niu } from '@/components/brand/Niu';
import { copy } from './copy';
import {
  extLabel,
  fileState,
  heldEntries,
  isEdited,
  people,
  resolvedResult,
  reviewQuestion,
  saveInput,
  saveKey,
  skippedEntries,
  statusKey,
  type EditValues,
} from './receipt-model';
import { HeldItem, ReceiptItem, type ItemProblem } from './ReceiptItem';
import {
  cardState,
  emptyLocal,
  eventKey,
  isLatestSave,
  reconcile,
  savedElsewhere,
  type LocalItem,
  type LocalState,
  type SavedRecord,
} from './receipt-local';
import type { ReceiptActions, ReceiptReadResult, ReceiptView } from './types';
import './receipt.css';

/** 有文件或整理还在跑时，按这个间隔重读回执。 */
export const RECEIPT_POLL_MS = 3000;
/** 自动重读连续失败这么多次后暂停，等用户点「再刷新」（engineering.md：重试有次数上限）。 */
export const RECEIPT_POLL_FAILURES = 5;
/** 请求时限（毫秒）：读取超时中止并当作中断；保存、撤销超时当作结果待确认，以读取为准。 */
export const RECEIPT_TIMEOUTS = { read: 10_000, write: 15_000 };

/** 在时限内等结果；超时返回 { done: false }，请求本身的报错照常抛出。 */
function within<T>(
  promise: Promise<T>,
  ms: number,
): Promise<{ done: true; value: T } | { done: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.then((value) => ({ done: true as const, value })),
    new Promise<{ done: false }>((resolve) => {
      timer = setTimeout(() => resolve({ done: false }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const shanghai = (iso: string, withTime: boolean) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const day = `${parts.month}-${parts.day}`;
  return withTime ? `${day} ${parts.hour}:${parts.minute}` : day;
};

/** 确认或撤销后按钮会消失，焦点交给这件事的卡片，键盘用户留在原处。 */
function focusCard(draftId: string) {
  requestAnimationFrame(() =>
    document.getElementById(`rc-${draftId}`)?.focus({ preventScroll: true }),
  );
}

/** 离截止还有多少毫秒；在事件里调用，不在渲染里。 */
const msUntil = (until: number) => until - Date.now();

function draftOrder(prev: string[], view: ReceiptView) {
  const ids = [
    ...(view.receipt.draftSet?.drafts ?? []).map((d) => d.draftId),
    ...view.receipt.confirmedDrafts.map((d) => d.draftId),
  ];
  const added = ids.filter((id) => !prev.includes(id));
  return added.length ? [...prev, ...added] : prev;
}

type Props = {
  batchId: string;
  initial: ReceiptView;
  actions: ReceiptActions;
  /** 当前查看人的姓名，用于确认后的署名。 */
  viewerName: string;
  newId?: () => string;
  /** 请求时限，测试里可以调短。 */
  timeouts?: { read: number; write: number };
};

/**
 * 回执页：一次投递读到了什么、哪些待核对、哪些事等谁确认。确认按 844 一件一件保存，
 * 保存后 5 秒内可以撤销，回到待确认；没有「全部确认」。
 */
export function ReceiptPage({
  batchId,
  initial,
  actions,
  viewerName,
  newId = () => crypto.randomUUID(),
  timeouts = RECEIPT_TIMEOUTS,
}: Props) {
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, ItemProblem>>({});
  /*
   * 卡片是已确认、待确认还是已撤销，只看最近一次成功读取的快照。本地每件事只留进行中的操作
   * 和用来恢复的编辑输入（receipt-local.ts）；操作只在一次能说明它的成功读取后清掉，
   * 读取失败、unavailable、forbidden 一律留着。
   */
  const [local, setLocal] = useState<LocalState>(emptyLocal);
  // 发起过几次读取；当前快照是第几次读取带回来的，更早发起、更晚落定的读取不替换它
  const reads = useRef(0);
  const shown = useRef(0);
  /*
   * 读取没成功时页面怎么说：stale——这次读取中断了，下面是上次读到的内容，之后的读取照常；
   * lost——读取被拒或回执已不存在，停在之前读到的内容，之后不再发起读取。
   */
  const [readIssue, setReadIssue] = useState<
    | null
    | { kind: 'stale'; since: string; paused: boolean }
    | { kind: 'lost'; status: 'forbidden' | 'not_found' | 'unauthenticated' }
  >(null);
  const lost = useRef(false);
  // 在途读取：失效、卸载时一起中止；轮询只在没有在途读取时发起
  const inflight = useRef(new Set<AbortController>());
  // 在途撤销：失效、卸载时一起中止
  const writes = useRef(new Set<AbortController>());
  // 最近一次采用的快照；撤销结果到达时和它比对，快照已前进就不采用
  const current = useRef(initial.receipt);
  // 自动重读连续失败的次数，到上限暂停轮询
  const failures = useRef(0);
  // 上次读到回执的时间（ISO）；页面卸载后返回的读取不再改页面
  const readAt = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const pending = [inflight.current, writes.current];
    return () => {
      alive.current = false;
      for (const set of pending) for (const controller of set) controller.abort();
    };
  }, []);
  // 撤销结果不知道时，卡片上的重试沿用同一次撤销
  const retries = useRef(new Map<string, () => void>());
  const ops = useRef(new Map<string, { key: string; id: string }>());
  // 卡片按第一次出现的顺序排，确认或撤销后留在原位
  const [order, setOrder] = useState(() => draftOrder([], initial));
  const { receipt } = view;

  /** 失效屏障：之后不再发起读取，在途的读取和撤销一起中止，迟到的结果也不再采用。 */
  const loseAccess = useCallback(
    (status: 'forbidden' | 'not_found' | 'unauthenticated') => {
      lost.current = true;
      for (const set of [inflight.current, writes.current])
        for (const controller of set) controller.abort();
      setReadIssue({ kind: 'lost', status });
    },
    [],
  );

  /**
   * 重读回执；带回的快照被采用时返回 true。poll：自动轮询，有在途读取或已到失败上限时不发起；
   * 用户触发的重读会重置失败计数。
   */
  const reload = useCallback(
    async (source: 'poll' | 'user' = 'user') => {
      if (lost.current || !alive.current) return false;
      if (source === 'poll') {
        if (inflight.current.size || failures.current >= RECEIPT_POLL_FAILURES)
          return false;
      } else failures.current = 0;
      const started = ++reads.current;
      const controller = new AbortController();
      inflight.current.add(controller);
      let result: ReceiptReadResult;
      try {
        const timed = await within(
          actions.read(batchId, controller.signal),
          timeouts.read,
        );
        if (!timed.done) controller.abort();
        result = timed.done ? timed.value : { status: 'unavailable' };
      } catch {
        result = { status: 'unavailable' };
      } finally {
        inflight.current.delete(controller);
      }
      // 卸载后才返回、失效之后才返回、比已显示的快照发起得早：都不改页面
      if (!alive.current || lost.current || started <= shown.current)
        return false;
      if (result.status === 'success') {
        shown.current = started;
        failures.current = 0;
        readAt.current = new Date().toISOString();
        current.current = result.view.receipt;
        setView(result.view);
        setOrder((prev) => draftOrder(prev, result.view));
        setLocal((all) => reconcile(all, started, result.view.receipt));
        setReadIssue(null);
        return true;
      }
      if (
        result.status === 'forbidden' ||
        result.status === 'not_found' ||
        result.status === 'unauthenticated'
      ) {
        loseAccess(result.status);
        return false;
      }
      // 中断：保留当前内容并写明它是上次读到的，下一次轮询、联网或操作再读
      failures.current += 1;
      setReadIssue({
        kind: 'stale',
        since: readAt.current ?? '',
        paused: failures.current >= RECEIPT_POLL_FAILURES,
      });
      return false;
    },
    [actions, batchId, timeouts.read, loseAccess],
  );

  // 断网恢复后读一次
  useEffect(() => {
    const online = () => void reload('user');
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [reload]);

  const running =
    receipt.jobId !== null ||
    receipt.files.some((f) => f.status === 'processing');
  useEffect(() => {
    if (!running || readIssue?.kind === 'lost') return;
    const timer = setInterval(() => void reload('poll'), RECEIPT_POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload, readIssue]);

  const drafts = receipt.draftSet?.drafts ?? [];
  const states = new Map(
    order.map((id) => [id, cardState(local, id, receipt)] as const),
  );
  const stateOf = (id: string) =>
    states.get(id) ?? cardState(local, id, receipt);

  const mineDrafts = drafts.filter((d) => view.confirmers[d.draftId]?.mine);
  const others = drafts.filter((d) => !view.confirmers[d.draftId]?.mine);
  const raters = [
    ...new Set(
      others.map((d) => view.confirmers[d.draftId]?.name).filter(Boolean),
    ),
  ].join('、');
  const mineConfirmed = [...states.values()].filter(
    (st) =>
      st.kind === 'saved' ||
      st.kind === 'unknown' ||
      (st.kind === 'settled' && st.signed),
  ).length;
  const awaiting = receipt.counts.events.awaiting_confirmation;
  const held = heldEntries(receipt);
  const skipped = skippedEntries(receipt);

  const setProblem = (draftId: string, problem: ItemProblem | null) =>
    setProblems((all) => {
      const next = { ...all };
      if (problem) next[draftId] = problem;
      else delete next[draftId];
      return next;
    });

  /** 改一件事的本地记录（进行中的操作和编辑输入）。 */
  const setItem = (
    id: string,
    next: (item: LocalItem, all: LocalState) => LocalItem,
  ) =>
    setLocal((all) => {
      const { op, edit } = next(all.items[id] ?? {}, all);
      const items = { ...all.items };
      if (op || edit)
        items[id] = { ...(op ? { op } : {}), ...(edit ? { edit } : {}) };
      else delete items[id];
      return { ...all, items };
    });
  async function confirm(
    draft: RecordBatchDraft,
    values: EditValues,
    reason: string,
  ) {
    const key = saveKey(saveInput(draft, values, reason, ''));
    const known = ops.current.get(draft.draftId);
    const id = known?.key === key ? known.id : newId();
    ops.current.set(draft.draftId, { key, id });
    setBusy((b) => ({ ...b, [draft.draftId]: true }));
    setProblem(draft.draftId, null);
    try {
      const timed = await within(
        actions.save(saveInput(draft, values, reason, id)),
        timeouts.write,
      );
      if (!timed.done) {
        // 结果不知道：留在待确认，输入和这次保存的编号都留着（再保存是同一次保存的重放），
        // 以读取为准；迟到的结果不再采用
        setProblem(draft.draftId, {
          message: copy.problem.timeout,
          reload: true,
        });
        void reload('user');
        return;
      }
      const result = timed.value;
      if (result.status === 'success') {
        ops.current.delete(draft.draftId);
        const { saveId, savedAt, undoUntil, events, revision } = result.result;
        const record: SavedRecord = {
          draft,
          values,
          reason,
          by: viewerName,
          on: shanghai(savedAt, false),
          saveId,
          events: eventKey(events),
          receipt: { revision, events },
        };
        // 在 updater 外取值：updater 到渲染时才执行，那时紧接着的重读已经发起了
        const at = reads.current;
        // 再次保存：这次保存成为进行中的操作，上一次的撤销操作随之替换
        setItem(draft.draftId, (item) => ({
          op: { kind: 'saved', at, save: record },
          edit: item.edit,
        }));
        setLocal((all) => ({
          ...all,
          signed: { ...all.signed, [record.events]: record },
          latest: { ...all.latest, [draft.draftId]: saveId },
        }));
        // 撤销窗口按服务端的 undoUntil 算，保存成功就给出，不等重读
        offerUndo(record, Date.parse(undoUntil));
        await reload();
        focusCard(draft.draftId);
      } else if (result.status === 'conflict')
        setProblem(draft.draftId, { message: result.message, reload: true });
      else if (result.status === 'unavailable')
        setProblem(draft.draftId, {
          message: copy.problem.unavailable,
          reload: false,
        });
      else if (result.status === 'validation_error')
        setProblem(draft.draftId, {
          message: copy.problem.invalid,
          reload: false,
        });
      else
        setProblem(draft.draftId, { message: result.message, reload: false });
    } catch {
      setProblem(draft.draftId, {
        message: copy.problem.offline,
        reload: false,
      });
    } finally {
      setBusy((b) => ({ ...b, [draft.draftId]: false }));
    }
  }

  function offerUndo(save: SavedRecord, until: number) {
    const { draft, values, reason, saveId } = save;
    const id = draft.draftId;
    const message = copy.toast.confirmed(
      people(view, draft.personIds),
      isEdited(draft, values),
    );
    const remaining = msUntil(until);
    if (remaining <= 0) {
      toast.show(message);
      return;
    }
    // 一次撤销只用一个 operation_id：结果不知道时重试沿用它，服务端按它重放原结果，
    // 不会因为换了编号被当成第二次撤销拒掉
    const operation = newId();
    const markUnknown = (busy: boolean, verify = false) => {
      const at = reads.current;
      setItem(id, (item, all) =>
        isLatestSave(all, id, saveId)
          ? {
              op: {
                kind: 'unknown',
                at,
                save,
                busy,
                verify,
                failed: false,
              },
              edit: item.edit,
            }
          : item,
      );
    };
    async function attempt(): Promise<
      'success' | 'refused' | 'unknown' | 'superseded' | 'lost'
    > {
      if (lost.current) return 'lost';
      const controller = new AbortController();
      writes.current.add(controller);
      let result;
      try {
        const timed = await within(
          actions.undo({ operation_id: operation, saveId }, controller.signal),
          timeouts.write,
        );
        if (!timed.done) {
          controller.abort();
          return 'unknown';
        }
        result = timed.value;
      } catch {
        return 'unknown';
      } finally {
        writes.current.delete(controller);
      }
      if (result.status === 'unauthenticated') {
        loseAccess('unauthenticated');
        return 'lost';
      }
      if (result.status === 'unavailable') return 'unknown';
      if (result.status !== 'success') return 'refused';
      // 回放可能是早先那次撤销的结果：快照已读到别处的再次确认时，以快照为准，丢弃这次结果
      if (savedElsewhere(current.current, save)) {
        setItem(id, (item) =>
          item.op && item.op.kind !== 'undone' && item.op.save.saveId === saveId
            ? { edit: item.edit }
            : item,
        );
        return 'superseded';
      }
      // 撤销推进了草稿版本：重读没跟上时按回执给的版本再保存；分和理由照保存时的留着
      const restored = result.result.draftRestoration;
      const at = reads.current;
      setItem(id, (item, all) =>
        isLatestSave(all, id, saveId)
          ? {
              op: {
                kind: 'undone',
                at,
                saveId,
                draft:
                  restored.status === 'available' && restored.draftId === id
                    ? { ...draft, revision: restored.draftRevision }
                    : draft,
              },
              edit: { values, reason },
            }
          : item,
      );
      // 不等重读：提示马上换成「已撤销」，卡片随重读更新
      void reload().then(() => focusCard(id));
      return 'success';
    }
    function retry() {
      markUnknown(true);
      void attempt().then((outcome) => {
        if (outcome === 'success') return;
        if (outcome === 'superseded') {
          toast.show(copy.toast.undoSuperseded);
          return;
        }
        // 被拒（例如评价关系已撤权，服务端先鉴权再重放）证明不了之前那次没生效：
        // 改为请用户刷新回执看这件事现在的状态
        markUnknown(false, outcome === 'refused');
      });
    }
    retries.current.set(id, retry);
    const close = toast.show(message, {
      undoneText: copy.toast.undone,
      failedText: copy.toast.undoFailed,
      onUndo: async () => {
        if (msUntil(until) <= 0) {
          close();
          toast.show(copy.toast.undoLate);
          void reload();
          return;
        }
        const outcome = await attempt();
        if (outcome === 'refused') {
          // 只说被拒，这件事现在的状态以重读到的回执为准
          void reload();
          throw new Error('undo refused');
        }
        if (outcome === 'superseded') {
          close();
          toast.show(copy.toast.undoSuperseded);
        }
        if (outcome === 'unknown' || outcome === 'lost') {
          // 不说「已撤销」也不说「撤销失败」：收起提示，交给卡片上的重试；失效时页面顶部另写
          close();
          markUnknown(false);
          if (outcome === 'unknown') toast.show(copy.toast.undoUnknown);
        }
      },
    });
    if (remaining < UNDO_MS) setTimeout(close, remaining);
  }

  /** 核实撤销结果：重读回执；读到这件事就以快照为准，读不到就留在待核实。 */
  async function verifyUndo(id: string) {
    const mark = (busy: boolean, failed: boolean) =>
      setItem(id, (item) =>
        item.op?.kind === 'unknown'
          ? { op: { ...item.op, busy, failed }, edit: item.edit }
          : item,
      );
    mark(true, false);
    const ok = await reload();
    mark(false, !ok);
    focusCard(id);
  }

  /** 这件事是不是当前查看人确认（决定卡片的模式和所在的组）。 */
  const mineOf = (id: string) => {
    const st = stateOf(id);
    if (st.kind === 'saved' || st.kind === 'unknown') return true;
    if (st.kind === 'settled') return Boolean(st.signed);
    if (st.kind === 'pending')
      // 刚撤销回来的事，快照可能还是保存后的、没有它的确认人信息：本人刚确认过它，确认入口留着；
      // 快照明确写了 mine:false 时照快照。能否保存仍由保存动作判断
      return view.confirmers[id]?.mine ?? st.fromUndo;
    return false;
  };

  const card = (id: string) => {
    const st = stateOf(id);
    if (st.kind === 'none') return null;
    if (st.kind === 'settled' && !st.signed) {
      const entry = receipt.confirmedDrafts.find((d) => d.draftId === id)!;
      return (
        <article
          key={id}
          className="n-card n-rcpt"
          data-state="confirmed"
          id={`rc-${id}`}
          tabIndex={-1}
        >
          <div className="n-rcpt__head">
            {entry.events.map(({ personId }) => {
              const person = view.people[personId];
              return person ? (
                <span key={personId} style={{ display: 'contents' }}>
                  <Avatar
                    name={person.name}
                    hue={person.hue}
                    photo={person.photo}
                  />
                  <b>{person.name}</b>
                  {person.demo ? <Badge tone="demo">{copy.demo}</Badge> : null}
                </span>
              ) : null;
            })}
          </div>
          <div className="n-rcpt__foot">
            <span className="nt-muted">{copy.confirm.confirmedShort}</span>
          </div>
        </article>
      );
    }
    const done =
      st.kind === 'saved'
        ? st.save
        : st.kind === 'unknown'
          ? st.op.save
          : st.kind === 'settled'
            ? st.signed!
            : undefined;
    const draft = st.kind === 'pending' ? st.draft : done!.draft;
    const edit = local.items[id]?.edit ?? null;
    return (
      <ReceiptItem
        key={id}
        view={view}
        draft={draft}
        mode={done ? 'confirmed' : mineOf(id) ? 'mine' : 'others'}
        confirmed={done}
        // 失效后停在之前读到的内容：输入留着，操作停下
        busy={Boolean(busy[id])}
        frozen={readIssue?.kind === 'lost'}
        problem={problems[id] ?? null}
        restore={st.kind === 'pending' ? edit : null}
        pendingUndo={
          st.kind === 'unknown'
            ? {
                busy: st.op.busy,
                verify: st.op.verify,
                failed: st.op.failed,
                onRetry: () => retries.current.get(id)?.(),
                onVerify: () => void verifyUndo(id),
              }
            : null
        }
        onConfirm={(values, reason) => void confirm(draft, values, reason)}
        onReload={() => {
          // 读成功才收起提示；读不到时提示留着，页面顶部另写读取中断或失效
          void reload().then((ok) => {
            if (ok) setProblem(id, null);
          });
        }}
      />
    );
  };
  const visible = order.filter((id) => stateOf(id).kind !== 'none');
  const isMine = mineOf;
  const anyMine = mineDrafts.length > 0 || mineConfirmed > 0;
  const files = receipt.counts.files;
  const verifyOpen = receipt.counts.reviewItems;
  const material = files.total
    ? `${files.total} ${copy.summary.files}，`
    : receipt.textMaterial
      ? `1 ${copy.summary.original}，`
      : '';
  const summaryLine = `读完了「${view.title}」：${material}涉及 ${receipt.personIds.length} 人，整理出 ${receipt.counts.events.total} 件事。${verifyOpen ? `${verifyOpen} 处等你核对，` : ''}${awaiting ? `${awaiting} 件事的建议分等你确认。` : ''}${receipt.hasHiddenContent ? copy.confirm.hidden : ''}`;

  return (
    <>
      <header className="nt-head">
        <div>
          <h1>{view.title}</h1>
          <p>
            {copy.entry[view.entry]}
            {view.tool ? ` · ${view.tool}` : ''} ·{' '}
            {copy.submitted(view.submittedBy)} ·{' '}
            {shanghai(view.submittedAt, true)}
          </p>
        </div>
        <span className="n-rstate" data-s={statusKey[receipt.status]}>
          {copy.state[receipt.status]}
        </span>
      </header>
      {readIssue?.kind === 'lost' ? (
        <div
          className="n-notice is-deny"
          role="alert"
          style={{ margin: '0 0 var(--s-5)' }}
        >
          <Icon name="info" />
          <div>
            <b>{copy.read[readIssue.status].title}</b>
            <p style={{ margin: 0 }}>{copy.read[readIssue.status].text}</p>
            <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
              <Link className="n-btn n-btn--sm n-btn--ghost" href="/">
                {copy.read.toWork}
              </Link>
            </div>
          </div>
        </div>
      ) : readIssue?.kind === 'stale' ? (
        <div
          className="n-notice is-plain"
          role="status"
          style={{ margin: '0 0 var(--s-5)' }}
        >
          <Icon name="info" />
          <div>
            {readIssue.since
              ? copy.read.stale(shanghai(readIssue.since, true))
              : copy.read.staleFirst}
            {readIssue.paused ? `。${copy.read.paused}` : null}
            <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
              <button
                type="button"
                className="n-btn n-btn--sm n-btn--ghost"
                onClick={() => void reload('user')}
              >
                {copy.read.retry}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ul className="n-rsum" aria-label={copy.summary.label}>
        {/* 只写了原话、没有文件的批次：这一格写原话，不写「0 个文件」 */}
        {!files.total && receipt.textMaterial ? (
          <li>
            <b>1</b>
            {copy.summary.original}
          </li>
        ) : (
          <li>
            <b>{files.total}</b>
            {copy.summary.files}
            {files.processing ? (
              <small>{copy.summary.processing(files.processing)}</small>
            ) : null}
            {files.failed ? (
              <small className="is-err">
                {copy.summary.failed(files.failed)}
              </small>
            ) : null}
          </li>
        )}
        <li>
          <b>{receipt.personIds.length}</b>
          {copy.summary.people}
        </li>
        <li>
          <b>{receipt.counts.events.total}</b>
          {copy.summary.events}
        </li>
        <li>
          <b>{verifyOpen}</b>
          {copy.summary.review}
        </li>
        <li>
          <b>{awaiting}</b>
          {copy.summary.toConfirm}
          {receipt.counts.events.confirmed ? (
            <small>
              {copy.summary.confirmed(receipt.counts.events.confirmed)}
            </small>
          ) : null}
        </li>
      </ul>
      {receipt.error ? (
        <p className="n-field__err" role="alert">
          {receipt.error.message}
        </p>
      ) : null}
      <div className="nt-split">
        <div className="nt-grid">
          {receipt.files.length ? (
            <article className="n-card">
              <h3 className="n-section-title">{copy.files.title}</h3>
              <ul className="n-files" style={{ margin: 0 }}>
                {receipt.files.map((file) => {
                  const state = fileState(file);
                  return (
                    <li
                      className="n-file"
                      data-state={file.status}
                      key={file.materialId}
                    >
                      <span className="n-file__ext">
                        {extLabel(file.filename)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div className="n-file__name">{file.filename}</div>
                        <div className="n-file__state">
                          <span className={state.tone ?? undefined}>
                            <Icon name={state.icon} size={12} /> {state.label}
                          </span>
                          {state.message ? ` · ${state.message}` : null}
                        </div>
                        {state.busy ? (
                          <Progress label={`${file.filename} 处理进度`} />
                        ) : null}
                      </div>
                      <span />
                    </li>
                  );
                })}
              </ul>
              {running ? (
                <p className="nt-caption">{copy.files.stillProcessing}</p>
              ) : null}
            </article>
          ) : receipt.textMaterial ? (
            <article className="n-card">
              <h3 className="n-section-title">{copy.files.originalTitle}</h3>
              {view.original ? (
                <blockquote className="n-cite__quote">
                  {view.original}
                </blockquote>
              ) : null}
              {running ? (
                <p className="nt-caption">{copy.files.arranging}</p>
              ) : null}
            </article>
          ) : null}
          {receipt.items.length || receipt.resolvedItems.length ? (
            <article className="n-card">
              <h3 className="n-section-title">
                {copy.review.title}
                {verifyOpen ? (
                  <span className="n-count">{verifyOpen}</span>
                ) : null}
              </h3>
              <ul className="nt-list">
                {receipt.items.map((item) => (
                  <li
                    className="nt-row"
                    style={{
                      justifyContent: 'space-between',
                      gap: 'var(--s-3)',
                    }}
                    key={item.itemId}
                  >
                    <span>
                      <span className="n-kind">
                        {copy.review.kind[item.kind]}
                      </span>{' '}
                      {reviewQuestion(receipt, item)}
                    </span>
                    <Badge>{copy.review.pending}</Badge>
                  </li>
                ))}
                {receipt.resolvedItems.map((item) => (
                  <li
                    className="nt-row"
                    style={{
                      justifyContent: 'space-between',
                      gap: 'var(--s-3)',
                    }}
                    key={item.itemId}
                  >
                    <span>
                      <span className="n-kind">
                        {copy.review.kind[item.kind]}
                      </span>{' '}
                      {reviewQuestion(receipt, item)}
                      {resolvedResult(item, view.people) ? (
                        <>
                          {' → '}
                          <b>{resolvedResult(item, view.people)}</b>
                        </>
                      ) : null}
                    </span>
                    <Badge tone="yes" icon="check">
                      {copy.review.done}
                    </Badge>
                  </li>
                ))}
              </ul>
            </article>
          ) : null}
          <section id="confirm" className="nt-grid" aria-labelledby="rc-h">
            <h3 className="n-section-title" id="rc-h" style={{ margin: 0 }}>
              {anyMine
                ? copy.confirm.mine
                : raters
                  ? copy.confirm.others(raters)
                  : copy.confirm.neutral}
              {mineDrafts.length ? (
                <span className="n-count">{mineDrafts.length}</span>
              ) : null}
            </h3>
            {anyMine ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                {copy.confirm.lead}
              </p>
            ) : null}
            {visible.length || held.length || skipped.length ? null : (
              <div className="nt-empty">
                {running ? copy.confirm.emptyProcessing : copy.confirm.empty}
              </div>
            )}
            {/* 一个数组、按 id 作 key：撤销后从「别人的」挪到「自己的」只是换位置，卡片不重新挂载 */}
            {[
              ...visible.filter(isMine),
              ...visible.filter((id) => !isMine(id)),
            ].map(card)}
            {held.map((entry) => (
              <HeldItem key={entry.itemId} state="held" {...entry} />
            ))}
            {skipped.map((entry) => (
              <HeldItem
                key={entry.itemId}
                state="skipped"
                quote={null}
                {...entry}
              />
            ))}
            {receipt.hasHiddenContent ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                {copy.confirm.hidden}
              </p>
            ) : null}
          </section>
        </div>
        <aside className="nt-grid nt-sticky">
          {/* 网页投递：原型写「回执也会发到你的企业微信单聊」。企业微信回执（#282）接通前
              没有可读的通道信号，这句无条件不显示，也不放占位（已登记为已知差异）。 */}
          {view.entry === 'wecom' ? (
            <article
              className="n-card n-imcard"
              aria-label={copy.channel.wecom}
            >
              <h3 className="n-section-title">
                {copy.channel.wecom} <Badge tone="demo">{copy.demo}</Badge>
              </h3>
              <div className="n-imcard__bubble">
                <Niu size={24} />
                <div>
                  <b>{copy.channel.bot}</b>
                  <p>{summaryLine}</p>
                  <a className="n-btn n-btn--sm" href="#confirm">
                    <Icon name="up-r" />
                    {copy.channel.toWeb}
                  </a>
                </div>
              </div>
              <p className="nt-caption">{copy.channel.wecomCaption}</p>
            </article>
          ) : view.entry === 'mcp' ? (
            <article className="n-card n-imcard" aria-label={copy.channel.mcp}>
              <h3 className="n-section-title">
                {copy.channel.mcp} <Badge tone="demo">{copy.demo}</Badge>
              </h3>
              <pre className="n-term">
                {`⏺ 调用 niu · ${view.tool ?? ''}\n  涉及的人  ${people(view, receipt.personIds)}\n  出处      ${receipt.files[0]?.filename ?? '原话'}\n⏺ 已交给 Niu-Talent，整理出 ${receipt.counts.events.total} 件事${receipt.hasHiddenContent ? `\n  ${copy.confirm.hidden}` : ''}\n  建议分等你确认 → 在 Web 上确认`}
              </pre>
              <p className="nt-caption">{copy.channel.mcpCaption}</p>
            </article>
          ) : null}
          <article className="n-card">
            <h3 className="n-section-title">{copy.people}</h3>
            <div className="nt-grid" style={{ gap: 'var(--s-2)' }}>
              {receipt.personIds.map((id) => {
                const person = view.people[id];
                if (!person) return null;
                return (
                  <div className="n-person" key={id}>
                    <Avatar
                      name={person.name}
                      hue={person.hue}
                      photo={person.photo}
                    />
                    <div>
                      <div className="n-person__name">
                        <Link
                          className="nt-plink"
                          href={`/person?id=${encodeURIComponent(id)}`}
                        >
                          {person.name}
                        </Link>
                        {person.demo ? (
                          <Badge tone="demo">{copy.demo}</Badge>
                        ) : null}
                      </div>
                      <div className="n-person__meta">{person.meta}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {receipt.personIds.length === 0 && receipt.hasHiddenContent ? (
              <p className="nt-muted" style={{ margin: 0 }}>
                {copy.confirm.hidden}
              </p>
            ) : null}
          </article>
        </aside>
      </div>
    </>
  );
}
