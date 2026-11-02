import type { JevInput } from '../../../integrations/jev';
import type { MatchStore } from './types';
import type { UnsupportedReview } from './review';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  matchingFixture,
  MemoryMatchStore,
} from '../../../../../tests/fixtures/staffing-matching';
import { createMatchingService } from './service';
import { MatchingError, type MatchScope } from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(people = 1, requirements = 1) {
  const source = matchingFixture();
  const base = source.sources[0]!;
  const store = new MemoryMatchStore();
  const scope: MatchScope = {
    demand: {
      ...source.demand,
      requirements: Array.from({ length: requirements }, (_, i) => ({
        id: 'r-' + i,
        text: '演示要求' + i,
        priority: 'required' as const,
      })),
    } as MatchScope['demand'],
    actor: { id: 'hr', name: '演示·HR' },
    candidates: Array.from({ length: people }, (_, i) => ({
      person: { id: 'demo-' + i, name: '演示·候选' + i, orgName: '演示组' },
      evidence: [
        {
          eventId: 'event-' + i,
          personId: 'demo-' + i,
          nature: 'original_fact' as const,
          behavior: '演示已确认行为',
          source: { ...base, fragmentId: 'fragment-' + i },
        },
      ],
    })),
  };
  let revoked = false,
    nextId = 0;
  const decide = vi.fn<
    (input: JevInput) => Promise<{ conclusion: 'supported' | 'not_supported' }>
  >(async () => ({
    conclusion: 'supported' as 'supported' | 'not_supported',
  }));
  const review = vi.fn<(input: JevInput) => Promise<UnsupportedReview>>(
    async () => ({
      status: 'confirmed',
      conclusion: 'not_supported',
      model: 'google/gemini-3.8-flash' as const,
      promptVersion: 'staffing-not-supported-review-v1',
      error: null,
    }),
  );
  const dependencies = {
    store,
    scope: async () => {
      if (revoked) throw new MatchingError('forbidden');
      return structuredClone(scope);
    },
    jev: { decide },
    reviewUnsupported: { review },
    now: () => '2031-04-05T06:07:08.000Z',
    id: () => 'run-' + ++nextId,
  };
  const service = createMatchingService(dependencies);
  return {
    store,
    scope,
    decide,
    review,
    dependencies,
    service,
    revoke: () => {
      revoked = true;
    },
  };
}
async function start(f: ReturnType<typeof fixture>) {
  return z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'start',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  ).runId;
}
it('10人×4要求跨重复worker最多4个在途单元，且确实并行而非逐格串行', async () => {
  const f = fixture(10, 4),
    gate = deferred<void>();
  let active = 0,
    maximum = 0;
  f.decide.mockImplementation(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await gate.promise;
    active--;
    return { conclusion: 'supported' };
  });
  const id = await start(f);
  const work = Promise.all([
    f.service.execute(id, 1),
    f.service.execute(id, 1),
  ]);
  try {
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(4), {
      timeout: 1000,
    });
  } finally {
    gate.resolve();
    await work;
  }
  expect(maximum).toBe(4);
  expect(f.decide).toHaveBeenCalledTimes(40);
  expect(f.store.state.jobs.get(id)?.status).toBe('completed');
  expect(f.review).not.toHaveBeenCalled();
});
it('Gemini复核尚未完成时不显示Jev不支持，完成并同意后才发布', async () => {
  const f = fixture(),
    gate = deferred<Awaited<ReturnType<typeof f.review>>>();
  f.decide.mockResolvedValue({ conclusion: 'not_supported' });
  f.review.mockImplementation(() => gate.promise);
  const id = await start(f),
    work = f.service.execute(id, 1);
  try {
    await vi.waitFor(() => expect(f.review).toHaveBeenCalledTimes(1));
    const response = await f.service.read('account-hr', id);
    expect(response).toMatchObject({
      status: 'success',
      page: {
        candidates: [
          {
            requirements: [
              { progress: 'judging', aiJudgment: null, humanJudgment: null },
            ],
          },
        ],
      },
    });
  } finally {
    gate.resolve({
      status: 'confirmed',
      conclusion: 'not_supported',
      model: 'google/gemini-3.8-flash',
      promptVersion: 'staffing-not-supported-review-v1',
      error: null,
    });
    await work;
  }
  expect(await f.service.read('account-hr', id)).toMatchObject({
    status: 'success',
    page: {
      candidates: [
        {
          requirements: [
            {
              progress: 'completed',
              aiJudgment: { conclusion: 'not_supported' },
            },
          ],
        },
      ],
    },
  });
  expect(
    f.store.state.runs.get(id)?.candidates[0]?.cells[0]?.review,
  ).toMatchObject({ status: 'confirmed', model: 'google/gemini-3.8-flash' });
});
it.each(['disputed', 'failed'] as const)(
  '复核%s进入待人工，不自行挑模型答案',
  async (status) => {
    const f = fixture();
    f.decide.mockResolvedValue({ conclusion: 'not_supported' });
    f.review.mockResolvedValue({
      status,
      conclusion: status === 'disputed' ? 'supported' : null,
      model: 'google/gemini-3.8-flash',
      promptVersion: 'staffing-not-supported-review-v1',
      error: status === 'failed' ? 'outcome_unknown' : null,
    });
    const id = await start(f);
    await f.service.execute(id, 1);
    expect(await f.service.read('account-hr', id)).toMatchObject({
      status: 'success',
      page: {
        candidates: [
          {
            requirements: [
              {
                progress: 'awaiting_manual',
                aiJudgment: null,
                humanJudgment: null,
              },
            ],
          },
        ],
      },
    });
    expect(f.store.state.jobs.get(id)?.status).toBe('awaiting_manual');
  },
);
it.each(['revoked', 'cancelled', 'input_changed'] as const)(
  'Jev之后%s时不把材料继续发往Gemini',
  async (mode) => {
    const f = fixture(),
      gate = deferred<{ conclusion: 'not_supported' }>();
    f.decide.mockImplementation(() => gate.promise);
    const id = await start(f),
      work = f.service.execute(id, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    if (mode === 'revoked') f.revoke();
    if (mode === 'cancelled')
      f.store.state.jobs.get(id)!.cancelRequestedAt =
        '2031-04-05T06:07:08.000Z';
    if (mode === 'input_changed')
      f.scope.candidates[0]!.evidence[0]!.behavior = '演示已变更';
    gate.resolve({ conclusion: 'not_supported' });
    await work;
    expect(f.review).not.toHaveBeenCalled();
    expect(
      f.store.state.runs.get(id)?.candidates[0]?.cells[0]?.match.aiJudgment,
    ).toBeNull();
  },
);
it('旧存量未复核的不支持读取时隐藏，但人工作出的不支持仍按合同保留', async () => {
  const f = fixture(),
    id = await start(f);
  const cell = f.store.state.runs.get(id)!.candidates[0]!.cells[0]!;
  cell.match = {
    requirementId: 'r-0',
    progress: 'completed',
    aiJudgment: {
      conclusion: 'not_supported',
      rationale: '演示旧判断',
      sources: [f.scope.candidates[0]!.evidence[0]!.source],
    },
    humanJudgment: null,
  };
  expect(await f.service.read('account-hr', id)).toMatchObject({
    status: 'success',
    page: {
      candidates: [
        { requirements: [{ progress: 'awaiting_manual', aiJudgment: null }] },
      ],
    },
  });
});

it.each(['revoked', 'cancelled', 'attempt_changed', 'source_changed'] as const)(
  'Gemini执行期间%s时不发布迟到结果',
  async (mode) => {
    const f = fixture(),
      gate = deferred<UnsupportedReview>();
    f.decide.mockResolvedValue({ conclusion: 'not_supported' });
    f.review.mockImplementation(() => gate.promise);
    const id = await start(f),
      work = f.service.execute(id, 1);
    await vi.waitFor(() => expect(f.review).toHaveBeenCalledTimes(1));
    if (mode === 'revoked') f.revoke();
    if (mode === 'cancelled')
      f.store.state.jobs.get(id)!.cancelRequestedAt =
        '2031-04-05T06:07:08.000Z';
    if (mode === 'attempt_changed') f.store.state.jobs.get(id)!.attempt++;
    if (mode === 'source_changed')
      f.scope.candidates[0]!.evidence[0]!.behavior = '演示变化';
    gate.resolve({
      status: 'confirmed',
      conclusion: 'not_supported',
      model: 'google/gemini-3.8-flash',
      promptVersion: 'staffing-not-supported-review-v1',
      error: null,
    });
    await work;
    expect(
      f.store.state.runs.get(id)!.candidates[0]!.cells[0]!.match.aiJudgment,
    ).toBeNull();
  },
);
it('缺Gemini复核端口构造失败，坏复核和异常只进入待人工', async () => {
  const f = fixture();
  expect(() =>
    createMatchingService({
      ...f.dependencies,
      reviewUnsupported: undefined,
    } as unknown as typeof f.dependencies),
  ).toThrow('Missing Gemini review port');
  f.decide.mockResolvedValue({ conclusion: 'not_supported' });
  f.review.mockRejectedValue(new Error('DO_NOT_LOG_PROVIDER'));
  const id = await start(f);
  await f.service.execute(id, 1);
  expect(f.store.state.runs.get(id)!.candidates[0]!.cells[0]).toMatchObject({
    error: 'review_failed',
    review: { status: 'failed', error: 'outcome_unknown' },
    match: { aiJudgment: null, progress: 'awaiting_manual' },
  });
  expect(JSON.stringify(f.store.state.runs.get(id))).not.toContain(
    'DO_NOT_LOG_PROVIDER',
  );
});

it('独立读取入口不把不一致的confirmed复核元数据当许可', async () => {
  const f = fixture(),
    id = await start(f),
    cell = f.store.state.runs.get(id)!.candidates[0]!.cells[0]!;
  cell.match = {
    requirementId: 'r-0',
    progress: 'completed',
    aiJudgment: {
      conclusion: 'not_supported',
      rationale: '演示旧判断',
      sources: [f.scope.candidates[0]!.evidence[0]!.source],
    },
    humanJudgment: null,
  };
  cell.review = {
    status: 'confirmed',
    conclusion: 'supported',
    model: 'google/gemini-3.8-flash',
    promptVersion: 'staffing-not-supported-review-v1',
    error: null,
  };
  expect(await f.service.read('account-hr', id)).toMatchObject({
    status: 'success',
    page: {
      candidates: [
        { requirements: [{ aiJudgment: null, progress: 'awaiting_manual' }] },
      ],
    },
  });
  const current = f.store.state.runs.get(id)!.candidates[0]!.cells[0]!;
  current.match.humanJudgment = {
    conclusion: 'not_supported',
    rationale: '演示显式人工决定',
    sources: [f.scope.candidates[0]!.evidence[0]!.source],
    judgedBy: f.scope.actor,
    judgedAt: '2031-04-05T06:07:08.000Z',
  };
  expect(await f.service.read('account-hr', id)).toMatchObject({
    status: 'success',
    page: {
      candidates: [
        {
          requirements: [
            {
              aiJudgment: null,
              humanJudgment: { conclusion: 'not_supported' },
              progress: 'completed',
            },
          ],
        },
      ],
    },
  });
});

const acceptedReview: UnsupportedReview = {
  status: 'confirmed',
  conclusion: 'not_supported',
  model: 'google/gemini-3.8-flash',
  promptVersion: 'staffing-not-supported-review-v1',
  error: null,
};
function humanCommand(f: ReturnType<typeof fixture>) {
  const source = f.scope.candidates[0]!.evidence[0]!.source;
  return {
    operationId: 'manual-a',
    demandId: f.scope.demand.id,
    expectedRevision: f.scope.demand.revision,
    personId: 'demo-0',
    requirementId: 'r-0',
    conclusion: 'not_supported',
    rationale: '演示·人工核对后的决定',
    sources: [
      {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
      },
    ],
  };
}
it.each(['jev', 'gemini'] as const)(
  '迟到%s结果不能写入已换claim的单元',
  async (provider) => {
    const f = fixture(),
      jev = deferred<{ conclusion: 'supported' | 'not_supported' }>(),
      gemini = deferred<UnsupportedReview>();
    if (provider === 'jev') f.decide.mockImplementation(() => jev.promise);
    else {
      f.decide.mockResolvedValue({ conclusion: 'not_supported' });
      f.review.mockImplementation(() => gemini.promise);
    }
    const id = await start(f),
      work = f.service.execute(id, 1);
    try {
      await vi.waitFor(() =>
        expect(provider === 'jev' ? f.decide : f.review).toHaveBeenCalledTimes(
          1,
        ),
      );
      await f.store.transaction(id, async (tx) => {
        const current = (await tx.load(id))!;
        current.run.candidates[0]!.cells[0]!.claim = 'replacement-owner';
        await tx.save(current.run, current.job);
      });
    } finally {
      jev.resolve({ conclusion: 'supported' });
      gemini.resolve(acceptedReview);
      await work;
    }
    const cell = f.store.state.runs.get(id)!.candidates[0]!.cells[0]!;
    expect(cell.claim).toBe('replacement-owner');
    expect(cell.match.aiJudgment).toBeNull();
    expect(cell.match.progress).toBe('judging');
  },
);
it.each(['claim', 'attempt'] as const)(
  'Jev之后%s已变化时不能额外计费调用Gemini',
  async (fence) => {
    const f = fixture(),
      gate = deferred<{ conclusion: 'not_supported' }>();
    f.decide.mockImplementation(() => gate.promise);
    const id = await start(f),
      work = f.service.execute(id, 1);
    try {
      await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
      await f.store.transaction(id, async (tx) => {
        const current = (await tx.load(id))!;
        if (fence === 'claim')
          current.run.candidates[0]!.cells[0]!.claim = 'new-owner';
        else current.job.attempt++;
        await tx.save(current.run, current.job);
      });
    } finally {
      gate.resolve({ conclusion: 'not_supported' });
      await work;
    }
    expect(f.review).not.toHaveBeenCalled();
    expect(
      f.store.state.runs.get(id)!.candidates[0]!.cells[0]!.match.aiJudgment,
    ).toBeNull();
  },
);
it.each(['jev', 'gemini'] as const)(
  '人工用真实judge入口完成后，迟到%s不覆盖人工结论',
  async (provider) => {
    const f = fixture(),
      jev = deferred<{ conclusion: 'supported' }>(),
      gemini = deferred<UnsupportedReview>();
    if (provider === 'jev') f.decide.mockImplementation(() => jev.promise);
    else {
      f.decide.mockResolvedValue({ conclusion: 'not_supported' });
      f.review.mockImplementation(() => gemini.promise);
    }
    const id = await start(f),
      work = f.service.execute(id, 1);
    try {
      await vi.waitFor(() =>
        expect(provider === 'jev' ? f.decide : f.review).toHaveBeenCalledTimes(
          1,
        ),
      );
      expect(
        await f.service.judge('account-hr', id, humanCommand(f)),
      ).toMatchObject({ status: 'success' });
    } finally {
      jev.resolve({ conclusion: 'supported' });
      gemini.resolve(acceptedReview);
      await work;
    }
    expect(
      f.store.state.runs.get(id)!.candidates[0]!.cells[0]!.match,
    ).toMatchObject({
      progress: 'completed',
      aiJudgment: null,
      humanJudgment: {
        conclusion: 'not_supported',
        judgedBy: { id: 'hr', name: '演示·HR' },
        rationale: '演示·人工核对后的决定',
      },
    });
  },
);
it('Jev不支持返回前人工已完成时，Gemini调用次数仍为0', async () => {
  const f = fixture(),
    gate = deferred<{ conclusion: 'not_supported' }>();
  f.decide.mockImplementation(() => gate.promise);
  const id = await start(f),
    work = f.service.execute(id, 1);
  try {
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    expect(
      await f.service.judge('account-hr', id, humanCommand(f)),
    ).toMatchObject({ status: 'success' });
  } finally {
    gate.resolve({ conclusion: 'not_supported' });
    await work;
  }
  expect(f.review).not.toHaveBeenCalled();
  expect(
    f.store.state.runs.get(id)!.candidates[0]!.cells[0]!.match.humanJudgment
      ?.conclusion,
  ).toBe('not_supported');
});
it('一个lane原生写失败后仍等待其他已发请求退出再抛错', async () => {
  const f = fixture(2),
    gate = deferred<{ conclusion: 'supported' }>();
  let writeFailed = false;
  f.decide.mockImplementation(async (input) =>
    JSON.parse(input.requirement).personId === 'demo-0'
      ? { conclusion: 'supported' }
      : gate.promise,
  );
  const store: MatchStore<null> = {
    transaction: (key, run) =>
      f.store.transaction(key, (tx) =>
        run({
          ...tx,
          save: async (run, job) => {
            if (run.candidates[0]!.cells[0]!.match.aiJudgment !== null) {
              writeFailed = true;
              throw new Error('synthetic write failed');
            }
            await tx.save(run, job);
          },
        }),
      ),
  };
  const service = createMatchingService({ ...f.dependencies, store });
  const id = z.object({ runId: z.string() }).parse(
    await service.start('account-hr', {
      operationId: 'start',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  ).runId;
  let settled = false;
  const work = service.execute(id, 1);
  void work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  try {
    await vi.waitFor(() => {
      expect(f.decide).toHaveBeenCalledTimes(2);
      expect(writeFailed).toBe(true);
    });
    expect(settled).toBe(false);
  } finally {
    gate.resolve({ conclusion: 'supported' });
    await expect(work).rejects.toThrow('synthetic write failed');
  }
  expect(settled).toBe(true);
});
it('Gemini收到与Jev逐项相同的全部已授权证据，不截成第一条', async () => {
  const f = fixture();
  const first = f.scope.candidates[0]!.evidence[0]!;
  f.scope.candidates[0]!.evidence.push({
    ...structuredClone(first),
    eventId: 'other-event',
    behavior: '演示·另一条已确认材料',
    source: { ...structuredClone(first.source), fragmentId: 'second-fragment' },
  });
  f.decide.mockResolvedValue({ conclusion: 'not_supported' });
  const id = await start(f);
  await f.service.execute(id, 1);
  expect(f.decide).toHaveBeenCalledTimes(1);
  expect(f.review).toHaveBeenCalledTimes(1);
  expect(f.review.mock.calls[0]![0]).toEqual(f.decide.mock.calls[0]![0]);
  expect(f.review.mock.calls[0]![0].evidence).toHaveLength(2);
});
