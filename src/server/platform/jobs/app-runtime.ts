import 'server-only';
import { PgBoss } from 'pg-boss';
import { getEnv } from '../../env';

export function createAppJobProducer(factory: () => Promise<PgBoss>) {
  let pending: Promise<PgBoss> | undefined;
  const queues = new Map<string, Promise<void>>();
  return {
    async get(queue: string): Promise<PgBoss> {
      pending ??= factory().catch((error) => { pending = undefined; throw error; });
      const boss = await pending;
      let ready = queues.get(queue);
      if (!ready) {
        ready = boss.createQueue(queue).then(() => undefined).catch((error) => {
          queues.delete(queue);
          throw error;
        });
        queues.set(queue, ready);
      }
      await ready;
      return boss;
    },
    async close() {
      const current = pending;
      pending = undefined;
      queues.clear();
      if (current) await (await current).stop();
    },
  };
}
const producer = createAppJobProducer(async () => {
  const boss = new PgBoss({ connectionString: getEnv().DATABASE_URL });
  boss.on('error', (error) => console.error('App queue database error', error.name));
  try { await boss.start(); return boss; }
  catch (error) { await boss.stop(); throw error; }
});
/** Server-owned queue names only; no public arbitrary enqueue or queue creation API. */
export async function getAppJobProducer(queue: string) {
  return producer.get(queue);
}
