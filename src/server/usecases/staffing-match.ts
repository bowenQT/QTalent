import type { LoadTalentSnapshot } from '../authz/talent';
import type { StaffingDemand } from '../../contracts/staffing';
import type { Source } from '../../contracts/sources';
import type { JevClient } from '../integrations/jev';
import type { MatchStore } from '../modules/staffing/matching/types';

/** Facts come from the event confirmation authority, never inferred from scores. */
export interface EventConfirmationFact {
  recordId: string;
  personId: string;
  active: boolean;
  state: 'draft' | 'confirmed';
  confirmation:
    | { kind: 'human'; id: string; actorId: string; confirmedAt: string }
    | { kind: 'prototype_baseline'; id: string; demo: true };
  nature: 'original_fact' | 'self_report' | 'management_observation' | 'human_conclusion';
}
export interface StaffingMatchDependencies<C> {
  environment: string;
  store: MatchStore<C>;
  demands: {
    read(accountId: string, demandId: string, revision?: number): Promise<StaffingDemand | null>;
  };
  loadEvidence(accountId: string, today: string): Promise<{
    snapshot: Awaited<ReturnType<LoadTalentSnapshot>>;
    confirmations: EventConfirmationFact[];
    sources: Source[];
    actor: { id: string; name: string };
  }>;
  jev: JevClient;
  wallNow?: () => Date;
  id?: () => string;
}
export function createStaffingMatchUsecase<C>(_deps: StaffingMatchDependencies<C>): {
  start(accountId: string, input: unknown): Promise<unknown>;
  read(accountId: string, runId: string): Promise<unknown>;
  judge(accountId: string, runId: string, input: unknown): Promise<unknown>;
  execute(runId: string, attempt: number): Promise<void>;
} {
  const missing = async (): Promise<never> => { throw new Error('not implemented'); };
  return { start: missing, read: missing, judge: missing, execute: missing };
}
