'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reassignEvaluationWorkAction } from '@/server/actions/evaluation-reassignment';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { State } from '@/components/ui/State';
import { useToast } from '@/components/ui/Toast';
import { ShellTitle } from '@/features/shell/ShellTitle';
import {
  candidatesFor,
  changedReason,
  groupItems,
  itemLabel,
  targetRelation,
  type ReassignItem,
  type ReassignResult,
} from './reassign-model';

// The read carries no avatar facts for these people; the stylesheet's default hue.
const neutralHue = 220;

type Attempt = {
  operationId: string;
  workItemId: string;
  expectedRevision: number;
  targetRelationId: string;
};
type Sent = { attempt: Attempt; name: string };
type Changed = { key: string; text: string };

/**
 * HR hands over work left by an evaluator whose relation ended (BOW-899): pick the
 * items, pick one person who can take all of them, confirm. Each item is its own
 * request; one that changed in the meantime is reported and left as it is. A request
 * that never got an answer keeps its operation id, so 重试 replays it exactly.
 */
export function Reassign({ items }: { items: ReassignItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const [to, setTo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState<Changed[]>([]);
  const [unanswered, setUnanswered] = useState<Sent[]>([]);
  const attempts = useRef(new Map<string, Attempt>());
  const acknowledge = useRef<HTMLButtonElement>(null);
  // Nothing went through: move focus to the notice that says why.
  const focusNotice = useRef(false);

  const picked = items.filter((item) => !skipped.has(item.workItemId));
  const candidates = candidatesFor(picked.length ? picked : items);
  const chosen =
    candidates.find(
      (candidate) =>
        candidate.evaluatorId === to && candidate.eligible === picked.length,
    ) ?? null;

  useEffect(() => {
    if (!focusNotice.current) return;
    focusNotice.current = false;
    acknowledge.current?.focus();
  }, [changed]);

  function attemptFor(item: ReassignItem, relationId: string): Attempt {
    const previous = attempts.current.get(item.workItemId);
    if (
      previous &&
      previous.targetRelationId === relationId &&
      previous.expectedRevision === item.revision
    )
      return previous;
    const attempt = {
      operationId: crypto.randomUUID(),
      workItemId: item.workItemId,
      expectedRevision: item.revision,
      targetRelationId: relationId,
    };
    attempts.current.set(item.workItemId, attempt);
    return attempt;
  }

  async function send(batch: Sent[]) {
    if (!batch.length) return;
    setBusy(true);
    const byId = new Map(items.map((item) => [item.workItemId, item]));
    let done = 0;
    const changedNow: Changed[] = [];
    const unansweredNow: Sent[] = [];
    for (const sent of batch) {
      let result: ReassignResult;
      try {
        result = await reassignEvaluationWorkAction(sent.attempt);
      } catch {
        unansweredNow.push(sent);
        continue;
      }
      // A later pick of the same item may hold a newer attempt; only this one is settled.
      if (
        attempts.current.get(sent.attempt.workItemId)?.operationId ===
        sent.attempt.operationId
      )
        attempts.current.delete(sent.attempt.workItemId);
      if (result.status === 'success') {
        done++;
        continue;
      }
      const item = byId.get(sent.attempt.workItemId);
      changedNow.push({
        key: sent.attempt.workItemId,
        text: `${item ? `${item.person.name} · ${itemLabel(item)}` : '一件事'}：${changedReason(result.status)}`,
      });
    }
    setBusy(false);
    setConfirming(false);
    setChanged(changedNow);
    // Requests from earlier batches that this one did not carry are still unanswered:
    // they keep their place and their operation id until they get an answer.
    const carried = new Set(batch.map((sent) => sent.attempt.operationId));
    setUnanswered((current) => [
      ...current.filter((sent) => !carried.has(sent.attempt.operationId)),
      ...unansweredNow,
    ]);
    const name = batch[0].name;
    if (done)
      toast.show(
        `已交给${name} ${done} 件${changedNow.length ? `，${changedNow.length} 件已有变化` : ''}`,
      );
    else if (changedNow.length) focusNotice.current = true;
    if (done || changedNow.length) router.refresh();
  }

  function submit() {
    if (!chosen) return;
    void send(
      picked.flatMap((item) => {
        const relationId = targetRelation(item, chosen.evaluatorId);
        return relationId
          ? [
              {
                attempt: attemptFor(item, relationId),
                name: chosen.displayName,
              },
            ]
          : [];
      }),
    );
  }

  function toggle(id: string, checked: boolean) {
    setSkipped((current) => {
      const next = new Set(current);
      if (checked) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const groups = groupItems(items);
  return (
    <>
      <ShellTitle title="重新分派" />
      <header className="nt-head">
        <div>
          <h1>重新分派</h1>
          <p>评价关系结束后待完成的事，选一位接手人。</p>
        </div>
      </header>
      {changed.length ? (
        <div className="n-note is-warn" role="alert">
          <Icon name="info" />
          <div>
            <b>{changed.length} 件已有变化，以最新状态为准</b>
            <ul>
              {changed.map((entry) => (
                <li key={entry.key}>{entry.text}</li>
              ))}
            </ul>
            <button
              className="n-link"
              type="button"
              ref={acknowledge}
              onClick={() => setChanged([])}
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
      {unanswered.length ? (
        <div className="n-notice is-deny" role="alert" id="ra-failed">
          <Icon name="x" />
          <div>
            <b>提交中断：{unanswered.length} 件待重新提交。</b>
            重试会按原来的选择再提交一次。
            <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
              <button
                className="n-btn n-btn--sm"
                type="button"
                disabled={busy}
                onClick={() => void send(unanswered)}
              >
                <Icon name="retry" />
                重试
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {items.length ? (
        <div className="nt-split">
          <div className="nt-grid">
            {groups.map((group) => (
              <article className="n-card" key={group.key}>
                <div className="n-ra__head">
                  <Avatar
                    name={group.evaluator.name}
                    hue={neutralHue}
                    size="sm"
                  />
                  <div>
                    <b>{group.evaluator.name}</b> · {group.node.name}
                    <small>评价关系已结束</small>
                  </div>
                </div>
                <ul className="n-ra">
                  {group.items.map((item) => (
                    <li key={item.workItemId}>
                      <label>
                        <input
                          type="checkbox"
                          checked={!skipped.has(item.workItemId)}
                          disabled={busy}
                          onChange={(event) =>
                            toggle(item.workItemId, event.target.checked)
                          }
                        />
                        <Avatar
                          name={item.person.name}
                          hue={neutralHue}
                          size="sm"
                        />
                        <span>
                          <b>{item.person.name}</b>
                          <small>{itemLabel(item)}</small>
                        </span>
                        <span className="due" />
                      </label>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <aside className="nt-grid nt-sticky">
            <article className="n-card">
              <h3 className="n-section-title">接手人</h3>
              <div className="n-choices" role="radiogroup" aria-label="接手人">
                {candidates.map((candidate) => {
                  const ok = candidate.eligible === picked.length;
                  return (
                    <button
                      key={candidate.evaluatorId}
                      className={`n-choice${chosen?.evaluatorId === candidate.evaluatorId ? ' is-picked' : ''}`}
                      type="button"
                      role="radio"
                      aria-checked={
                        chosen?.evaluatorId === candidate.evaluatorId
                      }
                      disabled={!ok || busy}
                      onClick={() => setTo(candidate.evaluatorId)}
                    >
                      <Avatar
                        name={candidate.displayName}
                        hue={neutralHue}
                        size="sm"
                      />
                      {candidate.displayName}
                      <small>
                        {ok
                          ? candidate.label
                          : `可接手其中 ${candidate.eligible} 件，先取消勾选其余的`}
                      </small>
                    </button>
                  );
                })}
              </div>
              <p className="nt-caption">
                名单里是这些人在本节点关系有效的评价人。
              </p>
              <button
                className="n-btn n-btn--ink"
                type="button"
                id="ra-go"
                style={{ width: '100%', marginTop: 'var(--s-3)' }}
                disabled={!chosen || !picked.length || busy}
                onClick={() => setConfirming(true)}
              >
                {chosen ? `交给${chosen.displayName}` : '选接手人'}
                {picked.length ? ` · ${picked.length} 件` : ''}
              </button>
            </article>
          </aside>
        </div>
      ) : (
        <State
          title="需要重新分派的事都处理完了"
          text="评价关系结束后待完成的事会出现在这里。"
        >
          <a className="n-btn n-btn--sm" href="/work">
            回到工作台
          </a>
        </State>
      )}
      {chosen ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          busy={busy}
          title={`交给${chosen.displayName}？`}
          description={`${chosen.displayName}接手后，这 ${picked.length} 件事由 TA 处理。`}
          actions={[
            {
              id: 'cancel',
              label: '取消',
              variant: 'ghost',
              onSelect: () => setConfirming(false),
            },
            {
              id: 'go',
              label: `交给${chosen.displayName}`,
              variant: 'ink',
              onSelect: submit,
            },
          ]}
        />
      ) : null}
    </>
  );
}
