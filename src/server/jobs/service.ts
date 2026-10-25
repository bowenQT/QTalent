import { z } from 'zod';
import {
  createJobSnapshotSchema,
  type JobCommand,
  type JobResponse,
  type JobSnapshot,
} from '../../contracts/jobs';
import { applyJobCommand, JobConflictError, type JobRecord } from './state';
export interface StoredOperation {
  fingerprint: string;
  record: JobRecord;
}
export interface JobTransaction<C> {
  context: C;
  record: JobRecord | null;
  save(record: JobRecord): Promise<void>;
  operation(
    accountId: string,
    operationId: string,
  ): Promise<StoredOperation | null>;
  saveOperation(
    accountId: string,
    operationId: string,
    operation: StoredOperation,
  ): Promise<void>;
}
export interface JobStore<C> {
  locked<T>(
    jobId: string,
    run: (tx: JobTransaction<C>) => Promise<T>,
  ): Promise<T>;
}
export interface JobPolicy<C> {
  kind: string;
  resultSchema: z.ZodType;
  can(
    context: C,
    accountId: string,
    job: JobRecord,
    action: 'read' | JobCommand['action'],
  ): Promise<boolean>;
  project(
    context: C,
    accountId: string,
    job: JobRecord,
  ): Promise<Pick<JobSnapshot, 'result' | 'progress'>>;
  inputVersion(context: C, job: JobRecord): Promise<string | null>;
  canResume(context: C, job: JobRecord): Promise<boolean>;
  /** Enqueue on this transaction, never an independent connection. Rollback must undo enqueue. */
  enqueue(
    context: C,
    job: JobRecord,
    action: JobCommand['action'],
  ): Promise<void>;
}
const safeErrors = {
  processing_failed: '处理失败，可以检查后重试',
  input_changed: '输入已变化，请重新确认',
  dependency_unavailable: '依赖暂不可用，请稍后重试',
};
export function createJobService<C>(
  store: JobStore<C>,
  policies: readonly JobPolicy<C>[],
  now: () => string,
) {
  const registry = new Map(policies.map((policy) => [policy.kind, policy]));
  if (registry.size !== policies.length) throw new Error('Duplicate job kind');
  async function present(
    tx: JobTransaction<C>,
    accountId: string,
    job: JobRecord,
    policy: JobPolicy<C>,
  ): Promise<JobResponse> {
    if (!(await policy.can(tx.context, accountId, job, 'read')))
      return { status: 'forbidden' };
    const projection = await policy.project(tx.context, accountId, job);
    const snapshot = {
      schemaVersion: 1,
      jobId: job.jobId,
      kind: job.kind,
      status: job.status,
      attempt: job.attempt,
      revision: job.revision,
      updatedAt: job.updatedAt,
      result: projection.result,
      progress: projection.progress,
      error:
        job.errorCode === null
          ? null
          : { code: job.errorCode, message: safeErrors[job.errorCode] },
      canRetry:
        job.status === 'failed' &&
        job.cancelRequestedAt === null &&
        (await policy.can(tx.context, accountId, job, 'retry')),
      canCancel:
        !['completed', 'cancelled'].includes(job.status) &&
        job.cancelRequestedAt === null &&
        (await policy.can(tx.context, accountId, job, 'cancel')),
      cancelRequestedAt: job.cancelRequestedAt,
    };
    // Projection must filter subjects BEFORE calculating counts; strict consumer schema rejects unknown fields.
    return {
      status: 'success',
      snapshot: createJobSnapshotSchema(policy.kind, policy.resultSchema).parse(
        snapshot,
      ),
    };
  }
  return {
    read(accountId: string, jobId: string): Promise<JobResponse> {
      return store.locked(jobId, async (tx) => {
        if (!tx.record) return { status: 'not_found' };
        const policy = registry.get(tx.record.kind);
        return policy
          ? present(tx, accountId, tx.record, policy)
          : { status: 'forbidden' };
      });
    },
    async command(accountId: string, input: JobCommand): Promise<JobResponse> {
      try {
        return await store.locked(input.jobId, async (tx) => {
          const current = tx.record;
          if (!current) return { status: 'not_found' };
          const policy = registry.get(current.kind);
          if (
            !policy ||
            !(await policy.can(tx.context, accountId, current, 'read')) ||
            !(await policy.can(tx.context, accountId, current, input.action))
          )
            return { status: 'forbidden' };
          const fingerprint = JSON.stringify([
            input.jobId,
            input.action,
            input.expectedRevision,
          ]);
          const previous = await tx.operation(accountId, input.operationId);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              return { status: 'conflict' };
            return present(tx, accountId, previous.record, policy);
          }
          if (
            input.action === 'retry' &&
            (await policy.inputVersion(tx.context, current)) !==
              current.inputVersion
          )
            return { status: 'conflict' };
          if (
            input.action === 'resume' &&
            !(await policy.canResume(tx.context, current))
          )
            return { status: 'conflict' };
          const next = applyJobCommand(current, input, now());
          await tx.save(next);
          if (next !== current)
            await policy.enqueue(tx.context, next, input.action);
          await tx.saveOperation(accountId, input.operationId, {
            fingerprint,
            record: next,
          });
          return present(tx, accountId, next, policy);
        });
      } catch (error) {
        if (error instanceof JobConflictError) return { status: 'conflict' };
        throw error;
      }
    },
  };
}
