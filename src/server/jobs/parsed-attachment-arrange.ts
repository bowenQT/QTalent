import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

export const parsedAttachmentArrangeQueue = 'parsed-attachment-arrange';
const payloadSchema = z.strictObject({
  jobId: z.string().min(1),
  attempt: z.number().int().min(1).max(2),
});
/** Registration is composed once by the shared worker owner. No provider retry. */
export async function registerParsedAttachmentArrange(
  boss: Pick<PgBoss, 'createQueue' | 'work'>,
  handler: { run(jobId: string, attempt: number): Promise<string> },
) {
  await boss.createQueue(parsedAttachmentArrangeQueue, { retryLimit: 0 });
  await boss.work(parsedAttachmentArrangeQueue, async (jobs) => {
    for (const job of jobs) {
      const payload = payloadSchema.parse(job.data);
      await handler.run(payload.jobId, payload.attempt);
    }
  });
}
