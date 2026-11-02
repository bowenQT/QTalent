import type { z } from 'zod';
import type {
  reviewActiveItemSchema,
  reviewCalibrationSchema,
  reviewQueueListSchema,
} from '../../../../contracts/review-queue';

export type ReviewItem = z.infer<typeof reviewActiveItemSchema>;
export type Calibration = z.infer<typeof reviewCalibrationSchema>;
export type ReviewQueue = z.infer<typeof reviewQueueListSchema>;
export type ReviewAuthority = {
  accountId: string;
  personId: string;
  isSystemAdmin: boolean;
  hasHrRole: boolean;
};
export type ReviewTarget = {
  itemId: string;
  eventId: string;
  personId: string;
  evaluationNodeId: string;
  dimensionId: string;
  ruleVersion: string;
  revision: number;
  status: 'open' | 'resolved' | 'withdrawn';
};
export type ReviewAnchor = {
  id: string;
  text: string;
  ruleVersion: string;
  dimensionId: string;
  value: number;
};
export type ReviewOperation = {
  accountId: string;
  operationId: string;
  fingerprint: string;
  scopeFingerprint: string;
  result: Calibration;
};
export type CalibrationWrite = ReviewOperation & {
  target: ReviewTarget;
  originalFingerprint: string;
  actorPersonId: string;
};
export interface ScoreReviewReadPort {
  currentAuthority(accountId: string): Promise<ReviewAuthority | null>;
  listOpenTargets(): Promise<ReviewTarget[]>;
  target(itemId: string): Promise<ReviewTarget | null>;
  /** Mandatory BOW-899 node AND person scope policy; no cohort-only fallback. */
  canReview(authority: ReviewAuthority, target: ReviewTarget): Promise<boolean>;
  /** Immutable original sides, revalidated against current source/field permissions.
   * Resolve exact confirmation/suggestion versions, citations and anchors server-side.
   * Return null if any required evidence is unreadable. Never load raw payload before canReview. */
  authorizedItem(
    authority: ReviewAuthority,
    target: ReviewTarget,
  ): Promise<ReviewItem | null>;
}
export interface ScoreReviewWritePort extends ScoreReviewReadPort {
  /** Namespace talent.score-review + actor + operation; acquire before event lock. */
  lockOperation(accountId: string, operationId: string): Promise<void>;
  /** Share BOW-846's score-event:<eventId> lock with confirmation and undo. */
  lockEvent(eventId: string): Promise<void>;
  operation(
    accountId: string,
    operationId: string,
  ): Promise<ReviewOperation | null>;
  calibration(itemId: string): Promise<Calibration | null>;
  anchor(target: ReviewTarget, value: number): Promise<ReviewAnchor | null>;
  /** In THIS transaction: unique calibration per item, compare revision/original
   * fingerprint, preserve both originals, persist new HR record + effective projection,
   * resolve review/todo, audit, and actor-scoped operation receipt together.
   * Never insert profile versions or change frozen positions. */
  applyCalibration(write: CalibrationWrite): Promise<void>;
}
export interface ScoreReviewRepository {
  read<T>(work: (port: ScoreReviewReadPort) => Promise<T>): Promise<T>;
  /** Production writes use Read Committed + operation/event locks, with fresh
   * authority and clock reads after waits (899 head 96fa3aa). A Serializable
   * snapshot taken before a lock must not retain revoked authorization.
   * Provide atomic rollback and persistent uniqueness; port doubles prove neither
   * PostgreSQL concurrency nor live authorization. */
  transaction<T>(work: (port: ScoreReviewWritePort) => Promise<T>): Promise<T>;
}
export type ScoreReviewRequestPorts = {
  currentAccountId(): Promise<string>;
  repository: ScoreReviewRepository;
  now(): Date;
};
export class ScoreReviewForbiddenError extends Error {
  constructor() {
    super('当前账号无权处理评分复核');
    this.name = 'ScoreReviewForbiddenError';
  }
}
export class ScoreReviewStoreConflict extends Error {
  constructor() {
    super('评分复核状态已变化');
    this.name = 'ScoreReviewStoreConflict';
  }
}
