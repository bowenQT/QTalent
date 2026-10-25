import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { mediaJobSnapshotSchema } from '../../contracts/media';
import { newJob } from './state';
import {
  createAttachmentParsePolicy,
  registerAttachmentParseJob,
  attachmentParseQueue,
} from './attachment-parse';
import type { AttachmentPolicyPorts } from '../modules/records/attachments/flow';

function fixture() {
  const job = newJob(
    {
      jobId: 'job',
      kind: 'media',
      resourceId: 'media',
      inputVersion: 'version',
    },
    '2026-10-25T16:00:00.000Z',
  );
  const ports: AttachmentPolicyPorts<object> = {
    can: vi.fn(async () => true),
    inputVersion: vi.fn(async () => 'version'),
    visibleSources: vi.fn(async () => [
      { fragmentId: 'visible', originalVersionId: 'version' },
    ]),
    enqueue: vi.fn(async () => {}),
  };
  return { job, ports, policy: createAttachmentParsePolicy(ports) };
}
describe('attachment media policy and isolated worker registration', () => {
  it('uses the current requester and exact action independently, never the uploader', async () => {
    const { job, ports, policy } = fixture();
    const context = {};
    expect(await policy.can(context, 'viewer', job, 'read')).toBe(true);
    expect(ports.can).toHaveBeenLastCalledWith(context, 'viewer', job, 'read');
    vi.mocked(ports.can).mockResolvedValue(false);
    expect(await policy.can(context, 'other-account', job, 'cancel')).toBe(
      false,
    );
    expect(ports.can).toHaveBeenLastCalledWith(
      context,
      'other-account',
      job,
      'cancel',
    );
    expect(
      await policy.can(context, 'viewer', { ...job, kind: 'other' }, 'read'),
    ).toBe(false);
  });
  it('projects only currently visible fragment refs and computes counts afterwards', async () => {
    const { job, ports, policy } = fixture();
    job.status = 'completed';
    job.result = {
      stage: 'parsed',
      mediaId: 'media',
      source: { fragmentId: 'hidden', originalVersionId: 'version' },
      fragmentIds: ['hidden', 'visible'],
    };
    const context = {};
    const projection = await policy.project(context, 'viewer', job);
    expect(projection).toEqual({
      result: {
        stage: 'parsed',
        mediaId: 'media',
        source: { fragmentId: 'visible', originalVersionId: 'version' },
        fragmentIds: ['visible'],
      },
      progress: { completed: 1, total: 1 },
    });
    expect(ports.visibleSources).toHaveBeenCalledWith(context, 'viewer', job);
    expect(policy.resultSchema.safeParse(projection.result).success).toBe(true);
  });
  it('rebuilds cancellation stage rather than leaking the retained parsing result', async () => {
    const { job, ports, policy } = fixture();
    job.status = 'cancelled';
    job.cancelRequestedAt = job.updatedAt;
    job.result = {
      stage: 'parsing',
      mediaId: 'media',
      source: null,
      fragmentIds: [],
    };
    const projected = await policy.project({}, 'viewer', job);
    expect(projected).toEqual({
      result: {
        stage: 'cancelled',
        mediaId: 'media',
        source: null,
        fragmentIds: [],
      },
      progress: null,
    });
    expect(ports.visibleSources).not.toHaveBeenCalled();
    expect(
      mediaJobSnapshotSchema.safeParse({
        schemaVersion: 1,
        jobId: job.jobId,
        kind: 'media',
        status: job.status,
        attempt: 1,
        revision: 1,
        updatedAt: job.updatedAt,
        result: projected.result,
        progress: projected.progress,
        error: null,
        canRetry: false,
        canCancel: false,
        cancelRequestedAt: job.updatedAt,
      }).success,
    ).toBe(true);
  });
  it('never turns hidden or unclassified parses into public sources', async () => {
    const { job, ports, policy } = fixture();
    job.status = 'completed';
    job.result = {
      stage: 'parsed',
      mediaId: 'media',
      source: { fragmentId: 'hidden', originalVersionId: 'version' },
      fragmentIds: ['hidden'],
    };
    vi.mocked(ports.visibleSources).mockResolvedValue([]);
    expect(await policy.project({}, 'viewer', job)).toEqual({
      result: {
        stage: 'parsed',
        mediaId: 'media',
        source: null,
        fragmentIds: [],
      },
      progress: { completed: 0, total: 0 },
    });
    vi.mocked(ports.visibleSources).mockResolvedValue([
      { fragmentId: 'foreign', originalVersionId: 'other-version' },
    ]);
    await expect(policy.project({}, 'viewer', job)).rejects.toThrow();
  });
  it('refuses automatic resume and nonrecoverable retries while delegating current inputVersion', async () => {
    const { job, policy, ports } = fixture();
    job.status = 'failed';
    job.result = {
      stage: 'unsupported',
      mediaId: 'media',
      source: null,
      fragmentIds: [],
      failureReason: 'format',
    };
    expect(await policy.can({}, 'viewer', job, 'retry')).toBe(false);
    expect(await policy.canResume({}, job)).toBe(false);
    expect(await policy.inputVersion({}, job)).toBe('version');
    expect(ports.inputVersion).toHaveBeenCalled();
    job.result = {
      stage: 'failed',
      mediaId: 'media',
      source: null,
      fragmentIds: [],
      failureReason: 'dependency_unavailable',
    };
    expect(await policy.can({}, 'viewer', job, 'retry')).toBe(true);
  });
  it('registers an isolated queue and validates payload before dispatch', async () => {
    let callback:
      ((jobs: Array<{ data: unknown }>) => Promise<void>) | undefined;
    const boss = {
      createQueue: vi.fn(async () => {}),
      work: vi.fn(async (_queue: string, run: typeof callback) => {
        callback = run;
      }),
    };
    const run = vi.fn(async () => {});
    await registerAttachmentParseJob(boss as unknown as PgBoss, run);
    expect(boss.createQueue).toHaveBeenCalledWith(attachmentParseQueue);
    expect(boss.work).toHaveBeenCalledWith(
      attachmentParseQueue,
      expect.any(Function),
    );
    if (!callback) throw new Error('missing callback');
    await callback([{ data: { jobId: 'job', attempt: 1 } }]);
    expect(run).toHaveBeenLastCalledWith({ jobId: 'job', attempt: 1 });
    await expect(
      callback([{ data: { jobId: 'job', attempt: 1, accountId: 'spoof' } }]),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
