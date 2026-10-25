import { z } from 'zod';
import type { PgBoss } from 'pg-boss';
const payloadSchema = z
  .object({ message: z.string().min(1).max(200) })
  .strict();
export const exampleQueue = 'foundation-example';
export async function runExample(payload: unknown) {
  const data = payloadSchema.parse(payload);
  return { received: data.message };
}
export async function registerExampleJob(boss: PgBoss) {
  await boss.createQueue(exampleQueue);
  await boss.work(exampleQueue, async (jobs) => {
    for (const job of jobs) await runExample(job.data);
  });
}
