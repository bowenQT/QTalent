import { describe, expect, it, vi } from 'vitest';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { Database } from '../db/client';
import { matchingFixture } from '../../../tests/fixtures/staffing-matching';
import { createStaffingMatchUsecase } from './staffing-match';
import { createStaffingMatchModels } from './staffing-match-models';
import { createStaffingMatchServerRuntime } from './staffing-match-runtime';

const keys = {
  QINIU_MAAS_API_KEY: 'synthetic-jev-key',
  MODELINK_API_KEY: 'synthetic-modelink-key',
};
const env = (over: Record<string, string> = {}) =>
  ({ APP_ENV: 'test', ...over }) as unknown as Parameters<
    typeof createStaffingMatchServerRuntime
  >[0]['env'];
function compose(environment = env()) {
  const queue = {
    createQueue: vi.fn(async () => undefined),
    work: vi.fn<(queue: string, handler: unknown) => Promise<string>>(
      async () => 'worker-id',
    ),
  };
  const boss = vi.fn(async () => queue as unknown as PgBoss);
  const runtime = createStaffingMatchServerRuntime({
    // Any query against this stub would throw.
    db: {} as Database,
    boss,
    environment: 'test',
    wallNow: () => new Date('2031-04-05T06:07:08.000Z'),
    env: environment,
  });
  return { runtime, boss, queue };
}

describe('BOW-854 matching server runtime', () => {
  it('composes without touching the queue, database or providers', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { runtime, boss } = compose(env(keys));
    expect(runtime.configured).toBe(true);
    expect(runtime.service).toMatchObject({
      start: expect.any(Function),
      read: expect.any(Function),
      judge: expect.any(Function),
    });
    expect(runtime.policy).toBeDefined();
    expect(boss).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it.each([
    ['no keys', {}],
    ['only the Jev key', { QINIU_MAAS_API_KEY: keys.QINIU_MAAS_API_KEY }],
    ['only the Modelink key', { MODELINK_API_KEY: keys.MODELINK_API_KEY }],
    ['a Modelink model it does not use', { ...keys, MODELINK_MODEL: 'other' }],
  ])('is not configured with %s', (_, over) => {
    expect(compose(env(over)).runtime.configured).toBe(false);
  });
  it('register creates the staffing-match queue and its handler only', async () => {
    const { runtime, boss, queue } = compose(env(keys));
    await runtime.register();
    expect(boss).toHaveBeenCalledExactlyOnceWith('staffing-match');
    expect(queue.createQueue).toHaveBeenCalledWith('staffing-match');
    expect(queue.work).toHaveBeenCalledOnce();
    expect(queue.work.mock.calls[0]![0]).toBe('staffing-match');
  });
});

// Deferred from #340: the real model ports, over a fake transport, keep an
// unrelated-evidence answer as 资料不足 and never send it to the Gemini review.
it('irrelevant evidence stays insufficient through the real model ports', async () => {
  const f = matchingFixture();
  const send = vi.fn<typeof fetch>(async (url) => {
    if (!String(url).endsWith('/systemone'))
      throw new Error('Gemini review must not be called');
    return Response.json({
      id: 'chatdecisions-synthetic',
      model: 'typesafe/jev-1.14',
      answers: {
        requirement_match: {
          type: 'choice',
          choice: 'insufficient',
          confidence: 0,
          probabilities: {
            supported: 0.1,
            not_supported: 0.1,
            insufficient: 0.7,
            conflicting: 0.1,
          },
        },
      },
      usage: { input_tokens: 20, output_tokens: 0 },
    });
  });
  const models = createStaffingMatchModels(keys, { fetch: send });
  const service = createStaffingMatchUsecase({
    ...f.dependencies,
    jev: models.jev,
    reviewUnsupported: models.reviewUnsupported,
  });
  const { runId } = z.object({ runId: z.string() }).parse(
    await service.start('account-hr', {
      operationId: 'start',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  await service.execute(runId, 1);
  const cells = f.store.state.runs
    .get(runId)!
    .candidates.flatMap((candidate) => candidate.cells);
  expect(cells.length).toBeGreaterThan(0);
  expect(
    cells.every(({ match }) => match.aiJudgment?.conclusion === 'insufficient'),
  ).toBe(true);
  expect(
    send.mock.calls.every(([url]) => String(url).endsWith('/systemone')),
  ).toBe(true);
});
