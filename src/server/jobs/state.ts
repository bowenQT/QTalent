import type { JobCommand, JobErrorCode, JobStatus } from '../../contracts/jobs';
export interface JobRecord {
  jobId: string;
  kind: string;
  resourceId: string;
  inputVersion: string;
  status: JobStatus;
  attempt: number;
  revision: number;
  updatedAt: string;
  result: unknown;
  errorCode: JobErrorCode | null;
  cancelRequestedAt: string | null;
}
export class JobConflictError extends Error {
  constructor() {
    super('Job revision, attempt or state conflict');
  }
}
export function newJob(
  input: Pick<JobRecord, 'jobId' | 'kind' | 'resourceId' | 'inputVersion'>,
  now: string,
): JobRecord {
  return {
    ...input,
    status: 'queued',
    attempt: 1,
    revision: 1,
    updatedAt: now,
    result: null,
    errorCode: null,
    cancelRequestedAt: null,
  };
}
export interface JobUpdate {
  attempt: number;
  expectedRevision: number;
  status: JobStatus;
  result?: unknown;
  errorCode?: JobErrorCode | null;
}
const transitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running'],
  running: ['partial', 'awaiting_manual', 'failed', 'completed'],
  partial: ['partial', 'awaiting_manual', 'failed', 'completed'],
  awaiting_manual: [],
  failed: [],
  completed: [],
  cancelled: [],
};
export function advanceJob(
  current: JobRecord,
  update: JobUpdate,
  now: string,
): JobRecord {
  if (
    current.attempt !== update.attempt ||
    current.revision !== update.expectedRevision
  )
    throw new JobConflictError();
  if (current.cancelRequestedAt !== null) {
    if (current.status === 'cancelled' || update.status !== 'cancelled')
      throw new JobConflictError();
  } else if (!transitions[current.status].includes(update.status))
    throw new JobConflictError();
  if (
    update.status === 'partial' &&
    (update.result === undefined ? current.result : update.result) === null
  )
    throw new JobConflictError();
  return {
    ...current,
    status: update.status,
    revision: current.revision + 1,
    updatedAt: now,
    result:
      update.status === 'cancelled'
        ? current.result
        : update.result === undefined
          ? current.result
          : update.result,
    errorCode:
      update.status === 'failed'
        ? (update.errorCode ?? 'processing_failed')
        : null,
  };
}
export function applyJobCommand(
  current: JobRecord,
  command: Pick<JobCommand, 'action' | 'expectedRevision'>,
  now: string,
): JobRecord {
  if (command.action === 'cancel' && current.status === 'cancelled')
    return current;
  if (current.revision !== command.expectedRevision)
    throw new JobConflictError();
  if (command.action === 'cancel') {
    if (current.status === 'completed') throw new JobConflictError();
    if (current.cancelRequestedAt !== null) return current;
    return {
      ...current,
      revision: current.revision + 1,
      updatedAt: now,
      cancelRequestedAt: now,
    };
  }
  if (current.cancelRequestedAt !== null) throw new JobConflictError();
  if (command.action === 'resume') {
    if (current.status !== 'awaiting_manual') throw new JobConflictError();
    return {
      ...current,
      status: 'running',
      revision: current.revision + 1,
      updatedAt: now,
    };
  }
  if (current.status !== 'failed') throw new JobConflictError();
  return {
    ...current,
    status: 'queued',
    attempt: current.attempt + 1,
    revision: current.revision + 1,
    updatedAt: now,
    result: null,
    errorCode: null,
  };
}
