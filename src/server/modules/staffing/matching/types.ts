import type { z } from 'zod';
import type {
  StaffingDemand,
  StaffingCandidate,
  staffingJudgmentResultSchema,
} from '../../../../contracts/staffing';
import type { Source } from '../../../../contracts/sources';
import type { JevClient } from '../../../integrations/jev';
import type { JobRecord } from '../../../jobs/state';

export type Match = StaffingCandidate['requirements'][number];
export interface EvidenceUnit {
  eventId: string;
  personId: string;
  nature: 'original_fact' | 'self_report' | 'management_observation' | 'human_conclusion';
  situation: string;
  behavior: string;
  impact: string;
  source: Source;
}
export interface ScopedCandidate {
  person: StaffingCandidate['person'];
  evidence: EvidenceUnit[];
}
export interface MatchScope {
  demand: Extract<StaffingDemand, { status: 'confirmed' }>;
  actor: { id: string; name: string };
  candidates: ScopedCandidate[];
}
export interface MatchCell {
  match: Match;
  claim: string | null;
  error: 'no_evidence' | 'input_changed' | 'jev_failed' | null;
}
export interface MatchRun {
  schemaVersion: 1;
  id: string;
  initiatorAccountId: string;
  demand: Extract<StaffingDemand, { status: 'confirmed' }>;
  inputVersion: string;
  inputFormatVersion: string;
  jevPromptVersion: string;
  createdAt: string;
  candidates: (ScopedCandidate & { cells: MatchCell[] })[];
}
export type JudgmentResult = z.infer<typeof staffingJudgmentResultSchema>;
export type StoredMatchOperation = {
  fingerprint: string;
  runId: string;
  judgment: JudgmentResult | null;
};
/** Every mutation and queue insertion in this interface shares one transaction. */
export interface MatchTransaction<C> {
  context: C;
  load(runId: string): Promise<{ run: MatchRun; job: JobRecord } | null>;
  insert(run: MatchRun, job: JobRecord): Promise<void>;
  save(run: MatchRun, job: JobRecord): Promise<void>;
  operation(accountId: string, operationId: string): Promise<StoredMatchOperation | null>;
  saveOperation(accountId: string, operationId: string, value: StoredMatchOperation): Promise<void>;
  enqueue(job: JobRecord): Promise<void>;
}
export interface MatchStore<C> {
  transaction<T>(key: string, run: (tx: MatchTransaction<C>) => Promise<T>): Promise<T>;
}
export interface MatchDependencies<C> {
  store: MatchStore<C>;
  scope(accountId: string, demandId: string, revision: number): Promise<MatchScope>;
  jev: JevClient;
  now(): string;
  id(): string;
}
export class MatchingError extends Error {
  constructor(readonly code: 'forbidden' | 'not_found' | 'conflict' | 'stale') {
    super(code);
  }
}
