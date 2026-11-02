'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import type {
  ConfirmedStandardAttribution,
  StandardAttributionHypothesis,
} from '@/contracts/standard-attribution';
import {
  categoryLabel,
  categoryOrder,
  categoryQuestion,
  monthDay,
  type AttributionCategory,
} from '../copy';
import type { DisplayCase } from '../judge/comparison-view';
import { useOperation } from '../operation';
import { actionFailure, settle, type AttributionPorts } from '../ports';

export type HypothesesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; items: StandardAttributionHypothesis[] };

type Draft = {
  hypothesisId: string | null;
  categories: AttributionCategory[];
  rationale: string;
};

const uniqueCaseIds = (citations: readonly { caseId: string }[]) => [
  ...new Set(citations.map((citation) => citation.caseId)),
];

function CaseChips({
  caseIds,
  cases,
  onCase,
}: {
  caseIds: readonly string[];
  cases: readonly DisplayCase[];
  onCase: (caseId: string) => void;
}) {
  return (
    <div className="n-attrib__cases">
      {caseIds.map((caseId) => {
        const unit = cases.find((item) => item.id === caseId);
        return (
          <button
            key={caseId}
            className="n-casechip"
            type="button"
            onClick={() => onCase(caseId)}
            disabled={!unit}
          >
            {unit
              ? `${unit.person.name} · ${unit.judgment.name}`
              : '案例已隐藏'}
          </button>
        );
      })}
    </div>
  );
}

function Conclusion({
  attribution,
  hypothesis,
  cases,
  onDraft,
}: {
  attribution: ConfirmedStandardAttribution;
  hypothesis: StandardAttributionHypothesis | null;
  cases: readonly DisplayCase[];
  onDraft: (attribution: ConfirmedStandardAttribution) => void;
}) {
  const judgment = cases.find(
    (unit) => unit.id === attribution.citations[0]?.caseId,
  )?.judgment.name;
  const standard = attribution.categories.includes('evaluation_standard');
  return (
    <div className="n-attrib" data-attribution={attribution.id}>
      <div
        className="n-block"
        data-state="ink"
        style={{ paddingLeft: 0, paddingRight: 0 }}
      >
        <div className="n-attrib__done">
          {attribution.categories.map((category) => (
            <span
              key={category}
              className="n-badge"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              {categoryLabel[category]}
            </span>
          ))}
          {judgment ? <span className="nt-muted">{judgment}</span> : null}
        </div>
        {hypothesis ? (
          <p style={{ margin: 'var(--s-2) 0 0' }}>{hypothesis.text}</p>
        ) : null}
        <p className="n-jcase__why" style={{ margin: 'var(--s-1) 0 0' }}>
          {attribution.rationale}
        </p>
        <div className="n-block__by">
          <span className="n-block__sig">{attribution.confirmedBy.name}</span>
          {monthDay(attribution.confirmedAt)} 确认归因
        </div>
      </div>
      {standard ? (
        <div className="nt-row">
          <Button
            className="n-btn--sm"
            type="button"
            onClick={() => onDraft(attribution)}
          >
            <Icon name="pen" />
            起草修订
          </Button>
        </div>
      ) : attribution.categories.includes('person_or_environment') ? (
        <p className="nt-caption" style={{ margin: 0 }}>
          本人或环境变化：记录情境，评价标准保持原样；需要时转为跟踪或沟通。
        </p>
      ) : null}
    </div>
  );
}

function HypothesisBlock({
  hypothesis,
  draft,
  cases,
  busy,
  onCase,
  onAdopt,
  onDraft,
  onCancel,
  onConfirm,
}: {
  hypothesis: StandardAttributionHypothesis;
  draft: Draft | null;
  cases: readonly DisplayCase[];
  busy: boolean;
  onCase: (caseId: string) => void;
  onAdopt: () => void;
  onDraft: (draft: Draft) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const formId = `attrib-${hypothesis.id}`;
  // 采纳并归因 opens the form; the reason box takes focus, as in the prototype.
  const why = useRef<HTMLTextAreaElement>(null);
  const open = draft !== null;
  useEffect(() => {
    if (open) why.current?.focus();
  }, [open]);
  return (
    <div className="n-attrib" data-hyp={hypothesis.id}>
      <div className="n-block" data-state="light">
        <span className="nt-hyp-text">{hypothesis.text}</span>
        <CaseChips
          caseIds={uniqueCaseIds(hypothesis.citations)}
          cases={cases}
          onCase={onCase}
        />
        <div className="n-block__by">
          <span className="n-src n-src--ai">
            <Icon name="spark" />
            AI 假设
          </span>
          建议归为
          {hypothesis.categories
            .map((category) => `「${categoryLabel[category]}」`)
            .join('')}{' '}
          · 依据 {uniqueCaseIds(hypothesis.citations).length} 个案例
        </div>
      </div>
      {draft ? (
        <div className="n-card" style={{ boxShadow: 'var(--e-0)' }}>
          <div className="n-field__label" id={`cats-${formId}`}>
            归为哪一类（可多选）
          </div>
          <div
            className="n-attrib__cats"
            role="group"
            aria-labelledby={`cats-${formId}`}
          >
            {categoryOrder.map((category) => (
              <button
                key={category}
                className="n-chip"
                type="button"
                aria-pressed={draft.categories.includes(category)}
                title={categoryQuestion[category]}
                onClick={() =>
                  onDraft({
                    ...draft,
                    categories: draft.categories.includes(category)
                      ? draft.categories.filter((item) => item !== category)
                      : [...draft.categories, category],
                  })
                }
              >
                {categoryLabel[category]}
              </button>
            ))}
          </div>
          <ul className="n-attrib__qs">
            {categoryOrder.map((category) => (
              <li key={category}>
                <b>{categoryLabel[category]}</b>
                {categoryQuestion[category]}
              </li>
            ))}
          </ul>
          <label className="n-field" style={{ marginTop: 'var(--s-3)' }}>
            <span className="n-field__label">理由（必填，会署名留档）</span>
            <textarea
              ref={why}
              className="n-textarea"
              id={`why-${formId}`}
              rows={2}
              placeholder="比如：两期都偏高，记录多是印象描述；先培训，再看下一期"
              value={draft.rationale}
              onChange={(event) =>
                onDraft({ ...draft, rationale: event.target.value })
              }
            />
          </label>
          <div className="nt-row" style={{ marginTop: 'var(--s-3)' }}>
            <Button
              className="n-btn--sm n-btn--ink"
              type="button"
              disabled={busy}
              onClick={onConfirm}
            >
              <Icon name="check" />
              确认归因
            </Button>
            <Button
              className="n-btn--sm n-btn--ghost"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              取消
            </Button>
            <span className="nt-muted">
              确认后署名留档
              {draft.categories.includes('evaluator')
                ? '；涉及评价人，管理者只看到类别'
                : '；管理者看到归因类别'}
            </span>
          </div>
        </div>
      ) : (
        <div className="nt-row">
          <Button
            className="n-btn--sm n-btn--ink"
            type="button"
            onClick={onAdopt}
          >
            <Icon name="check" />
            采纳并归因
          </Button>
          <span className="nt-muted">确认后的归因才能起草修订</span>
        </div>
      )}
    </div>
  );
}

/**
 * AI proposes hypotheses with case citations (light); HR picks categories, writes the
 * reason and signs (ink). Only a signed attribution that includes 评价标准 drafts a revision.
 */
export function Attribution({
  batchId,
  baseVersionId,
  cases,
  initialHypotheses,
  initialAttributions,
  ports,
  onCase,
  onDrafted,
}: {
  batchId: string;
  /** The selection standard version in force; a new revision starts from it. */
  baseVersionId: string;
  cases: readonly DisplayCase[];
  initialHypotheses: HypothesesState;
  initialAttributions: ConfirmedStandardAttribution[];
  ports: AttributionPorts;
  onCase: (caseId: string) => void;
  onDrafted: (draftId: string) => void;
}) {
  const toast = useToast();
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [attributions, setAttributions] = useState(initialAttributions);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState<ConfirmedStandardAttribution | null>(
    null,
  );
  const reason = useRef<HTMLTextAreaElement>(null);
  const operation = useOperation();

  async function generate() {
    setHypotheses({ status: 'loading' });
    const input = { batchId };
    const result = await settle(() =>
      ports.generate({
        operationId: operation.idFor('generate', input),
        ...input,
      }),
    );
    if (result.status === 'success') operation.done();
    setHypotheses(
      result.status === 'success'
        ? { status: 'ready', items: result.result }
        : { status: 'failed', message: actionFailure(result) },
    );
  }

  async function confirm(hypothesis: StandardAttributionHypothesis) {
    if (!draft) return;
    if (!draft.categories.length) {
      toast.show('至少选一个归因类别');
      return;
    }
    const rationale = draft.rationale.trim();
    if (!rationale) {
      document.getElementById(`why-attrib-${hypothesis.id}`)?.focus();
      toast.show('写一句理由再确认');
      return;
    }
    setBusy(true);
    const input = {
      batchId,
      hypothesisId: hypothesis.id,
      categories: draft.categories,
      rationale,
      caseIds: uniqueCaseIds(hypothesis.citations),
    };
    const result = await settle(() =>
      ports.confirm({
        operationId: operation.idFor('confirm', input),
        ...input,
      }),
    );
    setBusy(false);
    if (result.status !== 'success') {
      toast.show(actionFailure(result));
      return;
    }
    operation.done();
    setDraft(null);
    setAttributions((list) => [...list, result.result]);
    toast.show('归因已确认并署名，结论用于修订人才评价规则');
  }

  async function createRevision() {
    if (!drafting) return;
    const text = reason.current?.value.trim() ?? '';
    setBusy(true);
    const input = {
      baseVersionId,
      attributionId: drafting.id,
      expectedAttributionRevision: drafting.revision,
      reason: text,
    };
    const result = await settle(() =>
      ports.createRevision({
        operationId: operation.idFor('createRevision', input),
        ...input,
      }),
    );
    setBusy(false);
    if (result.status !== 'success') {
      // A lost answer keeps the dialog and the typed reason for a resend.
      if (result.status !== 'lost') setDrafting(null);
      toast.show(actionFailure(result));
      return;
    }
    operation.done();
    setDrafting(null);
    onDrafted(result.result.id);
  }

  const confirmedIds = new Set(attributions.map((a) => a.hypothesisId));
  const pending =
    hypotheses.status === 'ready'
      ? hypotheses.items.filter((h) => !confirmedIds.has(h.id))
      : [];
  const hypothesisOf = (id: string | null) =>
    hypotheses.status === 'ready'
      ? (hypotheses.items.find((h) => h.id === id) ?? null)
      : null;
  return (
    <article className="n-card" id="attrib">
      <h3 className="n-section-title">归因</h3>
      <div className="nt-grid">
        {attributions.map((attribution) => (
          <Conclusion
            key={attribution.id}
            attribution={attribution}
            hypothesis={hypothesisOf(attribution.hypothesisId)}
            cases={cases}
            onDraft={setDrafting}
          />
        ))}
        {pending.map((hypothesis) => (
          <HypothesisBlock
            key={hypothesis.id}
            hypothesis={hypothesis}
            draft={draft?.hypothesisId === hypothesis.id ? draft : null}
            cases={cases}
            busy={busy}
            onCase={onCase}
            onAdopt={() => {
              setDraft({
                hypothesisId: hypothesis.id,
                categories: hypothesis.categories.slice(),
                rationale: '',
              });
            }}
            onDraft={setDraft}
            onCancel={() => setDraft(null)}
            onConfirm={() => void confirm(hypothesis)}
          />
        ))}
        {hypotheses.status === 'idle' ? (
          <div className="nt-row">
            <Button
              className="n-btn--sm"
              type="button"
              onClick={() => void generate()}
            >
              <Icon name="spark" />
              整理 AI 假设
            </Button>
            <span className="nt-muted">AI 按这批案例提出带证据的假设</span>
          </div>
        ) : hypotheses.status === 'loading' ? (
          <div className="nt-row" role="status">
            <Badge tone="ai" icon="spark">
              整理中
            </Badge>
          </div>
        ) : hypotheses.status === 'failed' ? (
          <div className="n-notice" role="alert">
            <Icon name="info" />
            <div>
              <b>{hypotheses.message}</b>
              <div className="nt-row" style={{ marginTop: 'var(--s-2)' }}>
                <Button
                  className="n-btn--sm"
                  type="button"
                  onClick={() => void generate()}
                >
                  <Icon name="retry" />
                  重新整理
                </Button>
              </div>
            </div>
          </div>
        ) : !hypotheses.items.length && !attributions.length ? (
          <div className="nt-empty">
            AI 已看完这批案例，假设待更多案例后再整理。
          </div>
        ) : null}
      </div>
      <p className="nt-caption">
        AI 提出带证据的假设，HR
        选类别、写理由并确认归因。结论用于修订人才评价规则。
      </p>
      <ConfirmDialog
        open={drafting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDrafting(null);
        }}
        title="起草入营选拔标准修订？"
        busy={busy}
        actions={[
          {
            id: 'cancel',
            label: '取消',
            variant: 'ghost',
            onSelect: () => setDrafting(null),
          },
          {
            id: 'create',
            label: '起草修订',
            variant: 'ink',
            icon: 'pen',
            validate: () => Boolean(reason.current?.value.trim()),
            hint: '写一句修订理由',
            onSelect: () => void createRevision(),
          },
        ]}
      >
        <label className="n-field">
          <span className="n-field__label">修订理由</span>
          <textarea
            ref={reason}
            className="n-textarea"
            rows={3}
            defaultValue={drafting?.rationale ?? ''}
            placeholder="比如：优先录取一档只看作品成品，组队和个人分不开"
          />
        </label>
      </ConfirmDialog>
    </article>
  );
}
