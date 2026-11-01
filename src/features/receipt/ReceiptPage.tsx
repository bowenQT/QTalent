'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordBatchDraft } from '@/contracts/record';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { Progress } from '@/components/ui/Progress';
import { useToast } from '@/components/ui/Toast';
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
import {
  HeldItem,
  ReceiptItem,
  type ConfirmedDraft,
  type ItemProblem,
} from './ReceiptItem';
import type { ReceiptActions, ReceiptView } from './types';
import './receipt.css';

/** 有文件或整理还在跑时，按这个间隔重读回执。 */
export const RECEIPT_POLL_MS = 3000;

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
}: Props) {
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [problems, setProblems] = useState<Record<string, ItemProblem>>({});
  const [confirmed, setConfirmed] = useState<Record<string, ConfirmedDraft>>(
    {},
  );
  const ops = useRef(new Map<string, { key: string; id: string }>());
  // 卡片按第一次出现的顺序排，确认或撤销后留在原位
  const [order, setOrder] = useState(() => draftOrder([], initial));
  const { receipt } = view;

  const reload = useCallback(async () => {
    try {
      const result = await actions.read(batchId);
      if (result.status === 'success') {
        setView(result.view);
        setOrder((prev) => draftOrder(prev, result.view));
      }
    } catch {
      // 读不到时保留当前内容，下一次轮询或操作再读
    }
  }, [actions, batchId]);

  const running =
    receipt.jobId !== null ||
    receipt.files.some((f) => f.status === 'processing');
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reload(), RECEIPT_POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const drafts = receipt.draftSet?.drafts ?? [];

  const mineDrafts = drafts.filter((d) => view.confirmers[d.draftId]?.mine);
  const others = drafts.filter((d) => !view.confirmers[d.draftId]?.mine);
  const raters = [
    ...new Set(
      others.map((d) => view.confirmers[d.draftId]?.name).filter(Boolean),
    ),
  ].join('、');
  const mineConfirmed = Object.keys(confirmed).length;
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
      const result = await actions.save(saveInput(draft, values, reason, id));
      if (result.status === 'success') {
        ops.current.delete(draft.draftId);
        const saveId = result.result.saveId;
        setConfirmed((all) => ({
          ...all,
          [draft.draftId]: {
            draft,
            values,
            by: viewerName,
            on: shanghai(result.result.savedAt, false),
          },
        }));
        await reload();
        toast.show(
          copy.toast.confirmed(
            people(view, draft.personIds),
            isEdited(draft, values),
          ),
          {
            undoneText: copy.toast.undone,
            failedText: copy.toast.undoFailed,
            onUndo: async () => {
              const undone = await actions.undo({
                operation_id: newId(),
                saveId,
              });
              if (undone.status !== 'success') throw new Error(undone.status);
              setConfirmed((all) => {
                const next = { ...all };
                delete next[draft.draftId];
                return next;
              });
              await reload();
            },
          },
        );
      } else if (result.status === 'conflict')
        setProblem(draft.draftId, { message: result.message, reload: true });
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

  const card = (id: string) => {
    const draft = drafts.find((d) => d.draftId === id);
    const done = confirmed[id];
    if (draft || done) {
      const mine = draft ? Boolean(view.confirmers[id]?.mine) : true;
      return (
        <ReceiptItem
          key={id}
          view={view}
          draft={draft ?? done!.draft}
          mode={draft ? (mine ? 'mine' : 'others') : 'confirmed'}
          confirmed={done}
          busy={Boolean(busy[id])}
          problem={problems[id] ?? null}
          onConfirm={(values, reason) => void confirm(draft!, values, reason)}
          onReload={() => {
            setProblem(id, null);
            void reload();
          }}
        />
      );
    }
    const entry = receipt.confirmedDrafts.find((d) => d.draftId === id);
    if (!entry) return null;
    return (
      <article
        key={id}
        className="n-card n-rcpt"
        data-state="confirmed"
        id={`rc-${id}`}
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
  };
  const visible = order.filter(
    (id) =>
      drafts.some((d) => d.draftId === id) ||
      confirmed[id] ||
      receipt.confirmedDrafts.some((d) => d.draftId === id),
  );
  const isMine = (id: string) =>
    Boolean(confirmed[id]) || Boolean(view.confirmers[id]?.mine);
  const anyMine = mineDrafts.length > 0 || mineConfirmed > 0;
  const files = receipt.counts.files;
  const verifyOpen = receipt.counts.reviewItems;
  const summaryLine = `读完了「${view.title}」：${files.total} 个文件，涉及 ${receipt.personIds.length} 人，整理出 ${receipt.counts.events.total} 件事。${verifyOpen ? `${verifyOpen} 处等你核对，` : ''}${awaiting ? `${awaiting} 件事的建议分等你确认。` : ''}${receipt.hasHiddenContent ? copy.confirm.hidden : ''}`;

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
      <ul className="n-rsum" aria-label={copy.summary.label}>
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
            {visible.filter(isMine).map(card)}
            {visible.filter((id) => !isMine(id)).map(card)}
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
          ) : (
            <article className="n-card n-imcard">
              <h3 className="n-section-title">{copy.channel.web}</h3>
              <p className="nt-muted" style={{ margin: 0 }}>
                {copy.channel.webText}
              </p>
            </article>
          )}
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
