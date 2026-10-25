import { describe, expect, it } from 'vitest';
import { advanceJob, applyJobCommand, newJob, JobConflictError } from './state';
const now = '2026-10-25T00:00:00.000Z';
const initial = () =>
  newJob(
    {
      jobId: 'job',
      kind: 'test-job',
      resourceId: 'project',
      inputVersion: 'v1',
    },
    now,
  );
const update = (
  job: ReturnType<typeof initial>,
  status: Parameters<typeof advanceJob>[1]['status'],
) =>
  advanceJob(
    job,
    { attempt: job.attempt, expectedRevision: job.revision, status },
    now,
  );
const command = (
  job: ReturnType<typeof initial>,
  action: 'retry' | 'resume' | 'cancel',
) => applyJobCommand(job, { action, expectedRevision: job.revision }, now);
describe('persisted job transitions', () => {
  it('supports running, repeat partial updates and completion', () => {
    let job = update(initial(), 'running');
    job = advanceJob(
      job,
      {
        attempt: 1,
        expectedRevision: 2,
        status: 'partial',
        result: { units: ['validated'] },
      },
      now,
    );
    expect(job.revision).toBe(3);
    expect(update(update(job, 'partial'), 'completed').status).toBe(
      'completed',
    );
  });
  it.each(['completed', 'cancelled'] as const)(
    'never resumes terminal %s',
    (status) => {
      let job = update(initial(), 'running');
      job =
        status === 'completed'
          ? update(job, status)
          : update(command(job, 'cancel'), status);
      expect(() => update(job, 'running')).toThrow(JobConflictError);
      expect(() => command(job, 'resume')).toThrow(JobConflictError);
      expect(() => command(job, 'retry')).toThrow(JobConflictError);
    },
  );
  it('requires explicit resume of manual wait and retry increments attempt with cleared results', () => {
    const running = update(initial(), 'running');
    const waiting = update(running, 'awaiting_manual');
    expect(() => update(waiting, 'running')).toThrow(JobConflictError);
    const resumed = command(waiting, 'resume');
    expect(resumed).toMatchObject({
      attempt: 1,
      revision: 4,
      status: 'running',
    });
    const failed = advanceJob(
      resumed,
      {
        attempt: 1,
        expectedRevision: 4,
        status: 'failed',
        errorCode: 'processing_failed',
        result: { old: true },
      },
      now,
    );
    expect(() => update(failed, 'running')).toThrow(JobConflictError);
    const retry = command(failed, 'retry');
    expect(retry).toMatchObject({
      attempt: 2,
      revision: 6,
      status: 'queued',
      result: null,
      errorCode: null,
    });
    expect(() =>
      advanceJob(
        retry,
        { attempt: 1, expectedRevision: 6, status: 'completed' },
        now,
      ),
    ).toThrow(JobConflictError);
  });
  it('uses cancellation as persistent fence, not client unsubscription', () => {
    const running = update(initial(), 'running');
    const fenced = command(running, 'cancel');
    expect(fenced.cancelRequestedAt).toBe(now);
    expect(fenced.status).toBe('running');
    expect(() => update(fenced, 'completed')).toThrow(JobConflictError);
    expect(() => command(fenced, 'resume')).toThrow(JobConflictError);
    expect(update(fenced, 'cancelled').status).toBe('cancelled');
    expect(() => command(update(running, 'completed'), 'cancel')).toThrow(
      JobConflictError,
    );
  });
  it('rejects stale revision, illegal queued completion and cancellation without a fence', () => {
    expect(() =>
      applyJobCommand(
        initial(),
        { action: 'cancel', expectedRevision: 0 },
        now,
      ),
    ).toThrow(JobConflictError);
    expect(() => update(initial(), 'completed')).toThrow(JobConflictError);
    expect(() => update(initial(), 'cancelled')).toThrow(JobConflictError);
    expect(() => command(initial(), 'retry')).toThrow(JobConflictError);
  });
});

it('accepts repeated cancellation after the worker has stopped without another revision', () => {
  const cancelled = update(command(initial(), 'cancel'), 'cancelled');
  expect(
    applyJobCommand(cancelled, { action: 'cancel', expectedRevision: 1 }, now),
  ).toEqual(cancelled);
});

it('does not report partial without a persisted displayable result', () => {
  expect(() => update(update(initial(), 'running'), 'partial')).toThrow(
    JobConflictError,
  );
});
