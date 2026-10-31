'use client';
import { State } from '@/components/ui/State';
import type { StaffingDemand, StaffingJobSnapshot } from '@/contracts/staffing';
import type { JobState } from '../../use-job';
import type { LoadSource } from '@/features/sources/SourceCite';
import { arrangeCandidates } from '../../view';
import {
  forbiddenText,
  matchingFailed,
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
  | { kind: 'job'; job: JobState<StaffingJobSnapshot> | null };

export type JudgingTarget = {
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
  if (matching.kind === 'unavailable')
    return (
      <Section>
        <State {...matchingUnavailable} />
      </Section>
    );
  const job = matching.kind === 'job' ? matching.job : null;
  if (!candidates) {
    if (job?.connection === 'forbidden' || job?.connection === 'not_found')
      return (
        <Section>
          <State kind="denied" title={forbiddenText} />
        </Section>
      );
    const settled =
      job?.snapshot &&
      ['failed', 'cancelled', 'completed'].includes(job.snapshot.status);
    if (settled || job?.connection === 'error')
      return (
        <Section>
          <State kind="failed" {...matchingFailed} />
        </Section>
      );
    return (
      <Section>
        <State kind="loading" title="正在核对候选人" />
      </Section>
    );
  }
  const { listed, pending } = arrangeCandidates(demand, candidates);
  const busy = judging?.busy ?? false;
  return (
    <>
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
