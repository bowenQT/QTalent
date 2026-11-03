import { z } from 'zod';
import { MODELINK_MODEL } from '../../../src/server/integrations/maas';

const modelInput = z.object({
  personIds: z.array(z.string()).min(1),
  anchors: z.array(
    z.object({
      id: z.string(),
      dimensionId: z.string(),
      value: z.number(),
      text: z.string(),
      versionId: z.string(),
    }),
  ),
  sources: z
    .array(
      z.object({
        reference: z.unknown(),
        text: z.string().min(1),
        attributedPersonIds: z.array(z.string()),
      }),
    )
    .min(1),
});

/** Uses the production model HTTP adapter and its validators, replacing only
 * the provider response. No network credentials or real model are consulted. */
export function syntheticBusinessModel() {
  let calls = 0;
  const received: z.infer<typeof modelInput>[] = [];
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    calls++;
    const wire = z
      .object({
        messages: z.array(z.object({ role: z.string(), content: z.string() })),
      })
      .parse(JSON.parse(String(init?.body)));
    const message = wire.messages.find((item) => item.role === 'user');
    if (!message) throw new Error('Missing production model message');
    const input = modelInput.parse(JSON.parse(message.content));
    received.push(input);
    const source = input.sources[0]!;
    const anchor = input.anchors.find((candidate) => candidate.value === 3);
    if (!anchor)
      throw new Error('Production input must include a grounded anchor');
    const quote = source.text;
    const evidence = input.sources.map((item) => ({
      reference: item.reference,
      quote: item.text,
    }));
    const result = {
      events: [
        {
          eventKey: 'offline-business-event',
          personIds: input.personIds,
          sbi: {
            title: '演示附件事件',
            situation: '',
            behavior: quote,
            impact: '',
          },
          evidence,
          scores: input.personIds.map((personId) => ({
            state: 'suggested',
            personId,
            dimensionId: anchor.dimensionId,
            value: 3,
            anchor: {
              id: anchor.id,
              text: anchor.text,
              ruleVersion: anchor.versionId,
            },
            citations: evidence,
          })),
        },
      ],
      similarGroups: [],
    };
    return new Response(
      JSON.stringify({
        model: MODELINK_MODEL,
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify(result) },
          },
        ],
      }),
    );
  };
  return { fetch, calls: () => calls, received };
}

/** Narrow test-process composition of the actual registered production factories.
 * It is not the deployed src/worker/index.ts command and grants no authority. */
async function startBusinessWorker() {
  const { PgBoss } = await import('pg-boss');
  const { createDatabase } = await import('../../../src/server/db/client');
  const { testKodoFor } =
    await import('../../../src/server/integrations/kodo/test-kodo');
  const { createAttachmentParseWorker } =
    await import('../../../src/server/usecases/attachment-parse-worker');
  const { createParsedAttachmentWorker } =
    await import('../../../src/server/usecases/parsed-attachment-worker');
  const { createRecordArrangeModelClient, createRecordArrangeWorker } =
    await import('../../../src/server/usecases/record-arrange-worker');
  const { businessAt, wallAt } = await import('../../fixtures/bow-845/native');
  const url = new URL(z.string().url().parse(process.env.DATABASE_URL));
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Business test worker requires isolated loopback _test DB');
  const connection = createDatabase(url.toString());
  const boss = new PgBoss({ connectionString: url.toString() });
  boss.on('error', () => undefined);
  const storage = testKodoFor({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    BETTER_AUTH_URL: 'http://127.0.0.1:3000',
    DATABASE_URL: url.toString(),
  });
  if (!storage) throw new Error('Explicit test Kodo is unavailable');
  const model = syntheticBusinessModel();
  const fetch: typeof globalThis.fetch = async (...args) => {
    process.send?.({ type: 'model-call' });
    return model.fetch(...args);
  };
  const environment = {
    MODELINK_API_KEY: 'synthetic-business-regression-only',
  };
  const clocks = { businessNow: () => businessAt, now: () => new Date(wallAt) };
  try {
    await boss.start();
    const parsed = createParsedAttachmentWorker({
      db: connection.db,
      boss,
      ...clocks,
      client: createRecordArrangeModelClient(environment, { fetch }),
    });
    await parsed.register();
    await createRecordArrangeWorker(
      { db: connection.db, boss, environment, ...clocks },
      { fetch },
    ).register();
    await createAttachmentParseWorker({
      db: connection.db,
      boss,
      storage: storage.storage,
      demo: true,
      ...clocks,
      afterParse: parsed.afterParse,
      afterRecovery: parsed.recover,
    }).register();
  } catch (error) {
    await boss.stop();
    await connection.pool.end();
    throw error;
  }
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await boss.stop();
      await connection.pool.end();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => {
    void stop();
  });
  process.once('SIGINT', () => {
    void stop();
  });
  process.send?.({ type: 'ready' });
}

const { pathToFileURL } = await import('node:url');
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startBusinessWorker().catch(() => {
    // Never echo a connection string or an upstream response into test logs.
    process.send?.({ type: 'failed' });
    process.exit(1);
  });
}
