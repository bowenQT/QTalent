import type { PgBoss } from 'pg-boss';
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
export async function registerAttachmentParseJob(
  boss: PgBoss,
  run: (payload: unknown) => Promise<unknown>,
): Promise<void> {
  await boss.createQueue(attachmentParseQueue);
  await boss.work(attachmentParseQueue, async (jobs) => {
    for (const job of jobs)
      await run(attachmentJobPayloadSchema.parse(job.data));
  });
}
