import { createHash } from 'node:crypto';
import type { PgBoss, SendOptions } from 'pg-boss';
import type { JobPolicy } from './service';
import {
  attachmentJobPayloadSchema,
  attachmentJobResultSchema,
  type AttachmentPolicyPorts,
} from '../modules/records/attachments/flow';
import { mediaJobSnapshotSchema } from '../../contracts/media';
export const attachmentParseQueue = 'attachment-parse';
const publicResultSchema = mediaJobSnapshotSchema.shape.result.unwrap();
export function createAttachmentParsePolicy<C>(
  ports: AttachmentPolicyPorts<C>,
): JobPolicy<C> {
  return {
    kind: 'media',
    resultSchema: publicResultSchema,
    async can(context, requesterAccountId, job, action) {
      if (
        job.kind !== 'media' ||
        !(await ports.can(context, requesterAccountId, job, action))
      )
        return false;
      if (action === 'cancel' && job.status === 'failed') return false;
      if (action === 'resume') return false;
      if (action === 'retry') {
        const result = attachmentJobResultSchema.safeParse(job.result);
        return (
          result.success &&
          result.data.stage === 'failed' &&
          ['dependency_unavailable', 'processing_failed', 'cancelled'].includes(
            result.data.failureReason ?? '',
          )
        );
      }
      return true;
    },
    async canReplay(context, requesterAccountId, job, action) {
      return (
        job.kind === 'media' &&
        action !== 'resume' &&
        (await ports.can(context, requesterAccountId, job, action))
      );
    },
    async project(context, requesterAccountId, job) {
      if (job.status === 'queued' || job.status === 'cancelled')
        return {
          result: publicResultSchema.parse({
            stage: job.status === 'queued' ? 'queued' : 'cancelled',
            mediaId: job.resourceId,
            source: null,
            fragmentIds: [],
          }),
          progress: null,
        };
      const result = attachmentJobResultSchema.parse(job.result);
      if (result.mediaId !== job.resourceId)
        throw new Error('Attachment job resource mismatch');
      if (job.status === 'completed') {
        if (result.stage !== 'parsed')
          throw new Error('Attachment job stage mismatch');
        const visible = await ports.visibleSources(
          context,
          requesterAccountId,
          job,
        );
        if (
          new Set(visible.map((source) => source.fragmentId)).size !==
            visible.length ||
          visible.some(
            (source) =>
              source.originalVersionId !== job.inputVersion ||
              !result.fragmentIds.includes(source.fragmentId),
          )
        )
          throw new Error('Invalid attachment source projection');
        return {
          result: publicResultSchema.parse({
            stage: 'parsed',
            mediaId: job.resourceId,
            source: visible[0] ?? null,
            fragmentIds: visible.map((source) => source.fragmentId),
          }),
          progress: { completed: visible.length, total: visible.length },
        };
      }
      const stage =
        job.status === 'failed'
          ? result.stage === 'unsupported'
            ? 'unsupported'
            : 'failed'
          : 'parsing';
      return {
        result: publicResultSchema.parse({
          stage,
          mediaId: job.resourceId,
          source: null,
          fragmentIds: [],
        }),
        progress: null,
      };
    },
    inputVersion: (context, job) => ports.inputVersion(context, job),
    canResume: async () => false,
    enqueue: (context, job, action) => ports.enqueue(context, job, action),
  };
}
/** Message id for one job revision: the queue's primary key turns a second
 * send for the same `jobId:revision` into a no-op (`send` returns null). */
export function attachmentParseMessageId(jobId: string, revision: number) {
  const hex = createHash('sha256')
    .update(`attachment-parse:${jobId}:${revision}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '5' + hex.slice(13, 16),
    ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Every attachment parse message, first send or recovery, goes through here. */
export function sendAttachmentParse(
  boss: Pick<PgBoss, 'send'>,
  job: { jobId: string; attempt: number; revision: number },
  options: Pick<SendOptions, 'db' | 'startAfter'> = {},
) {
  return boss.send(
    attachmentParseQueue,
    { jobId: job.jobId, attempt: job.attempt, revision: job.revision },
    {
      ...options,
      id: attachmentParseMessageId(job.jobId, job.revision),
      singletonKey: `${job.jobId}:${job.revision}`,
      retryLimit: 0,
    },
  );
}

export const attachmentParseRecoveryQueue = 'attachment-parse-recovery';
/** No queue retry: the runner settles every claimed attempt itself, and a new
 * attempt comes only from an explicit retry command. A job left queued without
 * a live message, or a claim whose runner died, is found by `recover`, once at
 * start and then every minute. */
export async function registerAttachmentParseJob(
  boss: Pick<PgBoss, 'createQueue' | 'work' | 'schedule'>,
  run: (payload: unknown) => Promise<unknown>,
  recover: () => Promise<unknown>,
): Promise<void> {
  await boss.createQueue(attachmentParseQueue, { retryLimit: 0 });
  await boss.work(attachmentParseQueue, async (jobs) => {
    for (const job of jobs)
      await run(attachmentJobPayloadSchema.parse(job.data));
  });
  await boss.createQueue(attachmentParseRecoveryQueue, { retryLimit: 0 });
  await boss.work(attachmentParseRecoveryQueue, async () => {
    await recover();
  });
  await boss.schedule(attachmentParseRecoveryQueue, '* * * * *');
  await recover();
}
