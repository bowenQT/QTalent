'use client';
import { State } from '@/components/ui/State';
import type { StaffingDemand, StaffingJobSnapshot } from '@/contracts/staffing';
import type { JobState } from '../../use-job';
import type { LoadSource } from '@/features/sources/SourceCite';
import { arrangeCandidates } from '../../view';
import { formatClock } from '../../format';
import {
  matchingLoading,
  outOfScope,
  matchingFailed,
  matchingReadPaused,
  matchingReload,
  matchingRetry,
  matchingStale,
  matchingUnavailable,
  noCandidates,
} from '../../copy';
import { CandidateCard, type JudgingState } from './CandidateCard';
import type { ManualJudgmentDraft } from './ManualJudgment';
import { PendingCard } from './PendingCard';

type StaffingPage = NonNullable<StaffingJobSnapshot['result']>;
export type MatchingState =
  | { kind: 'opening' }
  | { kind: 'unavailable' }
  | { kind: 'denied' }
  | { kind: 'failed' }
  | { kind: 'job'; job: JobState<StaffingJobSnapshot> | null };

export type JudgingTarget = {
  demandId: string;
  revision: number;
  personId: string;
  requirementId: string;
  busy: boolean;
  error: string | null;
} | null;

function Section({
  meta,
  children,
}: {
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="nt-h2">
        候选人 {meta ? <small id="cand-meta">{meta}</small> : null}
      </h2>
      <div className="nt-grid" id="cands">
        {children}
      </div>
    </div>
  );
}

/** The result belongs to this demand revision only; anything else is not shown. */
export function pageFor(
  demand: StaffingDemand,
  matching: MatchingState,
): StaffingPage | null {
  if (matching.kind !== 'job') return null;
  const page = matching.job?.snapshot?.result ?? null;
  return page &&
    page.demand.id === demand.id &&
    page.demand.revision === demand.revision
    ? page
    : null;
}

export function Candidates({
  demand,
  matching,
  candidates,
  loadSource,
  judging,
  onOpenJudgment,
  onSubmitJudgment,
  onCancelJudgment,
}: {
  demand: StaffingDemand;
  matching: MatchingState;
  /** Candidates of this revision with any judgment saved here applied; null if none yet. */
  candidates: StaffingPage['candidates'] | null;
  loadSource: LoadSource;
  judging: JudgingTarget;
  onOpenJudgment: (personId: string, requirementId: string) => void;
  onSubmitJudgment: (
    personId: string,
    requirementId: string,
    draft: ManualJudgmentDraft,
  ) => void;
  onCancelJudgment: () => void;
}) {
  const job = matching.kind === 'job' ? matching.job : null;
  // Automatic reads stopped at their limit: offer reading again by hand.
  const retry = job?.gaveUp ? (
    <button type="button" className="n-btn n-btn--sm" onClick={job.retry}>
      {matchingRetry}
    </button>
  ) : null;
  if (matching.kind === 'unavailable' || (!candidates && job?.notConnected))
    return (
      <Section>
        <State {...matchingUnavailable}>{retry}</State>
      </Section>
    );
  // The server said these results belong to an older demand version: they are
  // already cleared, so no judgment can be made on them.
  if (job?.connection === 'conflict')
    return (
      <Section>
        <State kind="failed" {...matchingStale}>
          <button
            type="button"
            className="n-btn n-btn--sm"
            onClick={() => window.location.reload()}
          >
            {matchingReload}
          </button>
        </State>
      </Section>
    );
  if (!candidates) {
    if (
      matching.kind === 'denied' ||
      job?.connection === 'forbidden' ||
      job?.connection === 'not_found'
    )
      return (
        <Section>
          <State kind="denied" title={outOfScope} />
        </Section>
      );
    const settled =
      job?.snapshot &&
      ['failed', 'cancelled', 'completed'].includes(job.snapshot.status);
    if (settled || matching.kind === 'failed' || job?.connection === 'error')
      return (
        <Section>
          <State kind="failed" {...matchingFailed}>
            {retry}
          </State>
        </Section>
      );
    return (
      <Section>
        <State kind="loading" title={matchingLoading} />
      </Section>
    );
  }
  const { listed, pending } = arrangeCandidates(demand, candidates);
  const busy = judging?.busy ?? false;
  // Candidates kept from the last successful read while reading again fails.
  const paused =
    job?.connection === 'error' && job.snapshot
      ? (job.gaveUp ? matchingReadPaused.stopped : matchingReadPaused.retrying)(
          formatClock(job.snapshot.updatedAt),
        )
      : null;
  return (
    <>
      {paused ? (
        <div
          className="nt-row"
          role="status"
          style={{ marginBottom: 'var(--s-3)' }}
        >
          <span className="nt-muted">{paused}</span>
          {retry}
        </div>
      ) : null}
      <Section meta={`${listed.length} 人进入候选 · 按必须项的证据排列`}>
        {listed.length ? (
          listed.map((view) => {
            const mine: JudgingState =
              judging?.personId === view.person.id
                ? {
                    requirementId: judging.requirementId,
                    busy: judging.busy,
                    error: judging.error,
                  }
                : null;
            return (
              <CandidateCard
                key={view.person.id}
                view={view}
                loadSource={loadSource}
                judging={mine}
                onOpenJudgment={
                  busy
                    ? undefined
                    : (requirementId) =>
                        onOpenJudgment(view.person.id, requirementId)
                }
                onSubmitJudgment={(requirementId, draft) =>
                  onSubmitJudgment(view.person.id, requirementId, draft)
                }
                onCancelJudgment={onCancelJudgment}
              />
            );
          })
        ) : (
          <State {...noCandidates} />
        )}
      </Section>
      <PendingCard pending={pending} />
    </>
  );
}
