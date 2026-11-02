import {
  orderStaffingCandidates,
  type StaffingCandidate,
  type StaffingDemand,
} from '@/contracts/staffing';
import type { z } from 'zod';
import type { projectStatusSchema } from '@/contracts/projects';
import type { staffingConclusionSchema } from '@/contracts/staffing';
import type { Source } from '@/contracts/sources';
import type { MatchStateValue } from '@/components/ui/MatchState';
import type { JudgeProgressState } from '@/components/ui/JudgeProgress';

/**
 * What the find-people sections read. Sections never read the staffing contract directly:
 * when the contract is revised only the mapping below changes.
 */
export type StaffingConclusion = z.infer<typeof staffingConclusionSchema>;
export type StaffingRequirement = StaffingDemand['requirements'][number];
type StaffingMatch = StaffingCandidate['requirements'][number];

/** The project the page finds people for; supplied by the page, not by the staffing contract. */
export type ProjectHead = {
  id: string;
  name: string;
  goal: string;
  status: z.infer<typeof projectStatusSchema>;
};

export const conclusionState: Record<StaffingConclusion, MatchStateValue> = {
  supported: 'yes',
  not_supported: 'no',
  insufficient: 'unknown',
  conflict: 'conflict',
};

export type RequirementRow = {
  requirement: StaffingRequirement;
} & (
  | {
      kind: 'concluded';
      state: MatchStateValue;
      rationale: string;
      sources: Source[];
      /** Who reached the conclusion: the model, or a named person. */
      by: { kind: 'ai' } | { kind: 'human'; name: string; at: string };
    }
  /** Not concluded yet, or failed. Never shown as one of the four states. */
  | { kind: 'progress'; state: JudgeProgressState }
);

export type CandidateView = {
  person: StaffingCandidate['person'];
  rows: RequirementRow[];
};

export type PendingView = {
  person: StaffingCandidate['person'];
  /** Required items with insufficient evidence, in demand order. */
  missing: string[];
};

const progressState: Record<
  Exclude<StaffingMatch['progress'], 'completed'>,
  JudgeProgressState
> = {
  queued: 'queued',
  judging: 'judging',
  awaiting_manual: 'review',
  failed: 'failed',
};

export function toRow(
  requirement: StaffingRequirement,
  match: StaffingMatch,
): RequirementRow {
  if (match.progress !== 'completed')
    return {
      requirement,
      kind: 'progress',
      state: progressState[match.progress],
    };
  // A human conclusion replaces the model's; the model's stays in the record, not here.
  const human = match.humanJudgment;
  const judgment = human ?? match.aiJudgment;
  if (!judgment) throw new Error('Completed match without a judgment');
  return {
    requirement,
    kind: 'concluded',
    state: conclusionState[judgment.conclusion],
    rationale: judgment.rationale,
    sources: judgment.sources,
    by: human
      ? { kind: 'human', name: human.judgedBy.name, at: human.judgedAt }
      : { kind: 'ai' },
  };
}

export function toCandidateView(
  demand: StaffingDemand,
  candidate: StaffingCandidate,
): CandidateView {
  const matches = new Map(
    candidate.requirements.map((item) => [item.requirementId, item]),
  );
  return {
    person: candidate.person,
    rows: demand.requirements.flatMap((requirement) => {
      const match = matches.get(requirement.id);
      return match ? [toRow(requirement, match)] : [];
    }),
  };
}

/**
 * Candidates in contract order (how many required items are supported, nothing else),
 * split as the prototype does: people with at least two required items short of evidence
 * and none supported wait under「条件待确认」, once none of their requirements is
 * still open. Insufficient evidence is never read as a negative: it only moves the
 * person to the waiting list.
 */
export function arrangeCandidates(
  demand: StaffingDemand,
  candidates: StaffingCandidate[],
): { listed: CandidateView[]; pending: PendingView[] } {
  const listed: CandidateView[] = [];
  const pending: PendingView[] = [];
  for (const candidate of orderStaffingCandidates(demand, candidates)) {
    const view = toCandidateView(demand, candidate);
    const required = view.rows.filter(
      (row) => row.requirement.priority === 'required',
    );
    const concluded = (state: MatchStateValue) =>
      required.filter((row) => row.kind === 'concluded' && row.state === state);
    const unknown = concluded('unknown');
    // Someone with a requirement still being judged, or waiting for a person to judge
    // it, keeps the full card: the waiting list has no place to finish that work.
    const open = view.rows.some(
      (row) => row.kind === 'progress' && row.state !== 'failed',
    );
    if (!open && unknown.length >= 2 && concluded('yes').length === 0)
      pending.push({
        person: view.person,
        missing: unknown.map((row) => row.requirement.text),
      });
    else listed.push(view);
  }
  return { listed, pending };
}

/**
 * Sources a person may cite when judging a requirement by hand: the evidence already
 * attached to this candidate's other judgments, each once. The contract has no other
 * list of a candidate's sources yet.
 */
export function citableSources(view: CandidateView): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const row of view.rows) {
    if (row.kind !== 'concluded') continue;
    for (const source of row.sources) {
      const key = `${source.fragmentId}\u0000${source.originalVersionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  return sources;
}

export const projectStatusTone = {
  筹备中: 'prep',
  进行中: 'yes',
  已结束: 'ended',
  已归档: 'archived',
} as const satisfies Record<ProjectHead['status'], string>;
