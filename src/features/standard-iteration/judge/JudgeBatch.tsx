'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { ComparisonHrPage } from '@/contracts/judgment-comparison';
import type { ConfirmedStandardAttribution } from '@/contracts/standard-attribution';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { Attribution, type HypothesesState } from '../attribution/Attribution';
import { stage } from '../copy';
import type { AttributionPorts, SelectionStandardContent } from '../ports';
import { scopeLine } from './comparison-view';
import { Distribution, judgmentOf } from './Distribution';
import { LockNote, RaterCard, RuleCard } from './SideCards';
import '../standard-iteration.css';

/** One comparison batch as HR sees it: distribution, cases, attribution and raters. */
export function JudgeBatch({
  page,
  standard,
  currentStandardVersionId,
  initialHypotheses,
  initialAttributions,
  ports,
  raterHref,
  onDrafted,
  initialOpen = null,
}: {
  page: ComparisonHrPage;
  standard: SelectionStandardContent | null;
  currentStandardVersionId: string;
  initialHypotheses: HypothesesState;
  initialAttributions: ConfirmedStandardAttribution[];
  ports: AttributionPorts;
  raterHref: (evaluatorId: string) => string;
  onDrafted: (draftId: string) => void;
  initialOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [focus, setFocus] = useState<string | null>(null);
  const { batch, mapping, cases } = page;
  const scope = scopeLine(cases);
  useEffect(() => {
    if (!focus) return;
    document.getElementById(`case-${focus}`)?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, [focus]);
  return (
    <>
      <ShellTitle title={batch.name} />
      <header className="nt-head">
        <div>
          <h1>{batch.name}</h1>
          <p>
            {stage.front} → {stage.back} · {batch.cohort.name}
          </p>
          {scope ? (
            <p className="nt-muted" style={{ marginTop: 2 }}>
              {scope}
            </p>
          ) : null}
        </div>
        <div className="nt-head__acts">
          <span className="n-rule">
            <Icon name="doc" />
            标准 {batch.selectionStandardVersionId}
          </span>
          <span className="n-rule">
            <Icon name="swap" />
            对应表 {batch.mappingVersionId}
          </span>
        </div>
      </header>
      <div className="nt-split nt-split--wide">
        <div className="nt-grid">
          <Distribution
            cases={cases}
            mapping={mapping}
            open={open}
            onOpen={(id) => {
              setFocus(null);
              setOpen(id);
            }}
            focusCaseId={focus}
          />
          <Attribution
            batchId={batch.id}
            baseVersionId={currentStandardVersionId}
            cases={cases}
            initialHypotheses={initialHypotheses}
            initialAttributions={initialAttributions}
            ports={ports}
            onCase={(caseId) => {
              setOpen(judgmentOf(cases, caseId));
              setFocus(caseId);
            }}
            onDrafted={onDrafted}
          />
        </div>
        <aside className="nt-grid">
          <RuleCard
            mapping={mapping}
            judgmentName={cases[0]?.judgment.name ?? stage.front}
            standardVersionId={batch.selectionStandardVersionId}
            standard={standard}
          />
          <RaterCard raters={page.raters} raterHref={raterHref} />
          <LockNote />
        </aside>
      </div>
    </>
  );
}
