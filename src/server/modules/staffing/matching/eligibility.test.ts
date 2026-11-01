import { expect, it } from 'vitest';
import { z } from 'zod';
import { matchingFixture } from '../../../../../tests/fixtures/staffing-matching';
import { createMatchingService, projectMatchingRun } from './service';
import type { MatchRun, MatchScope } from './types';

type Fixture = ReturnType<typeof matchingFixture>;
const command = (operationId: string) => ({
  operationId,
  demandId: 'demand-a',
  expectedRevision: 2,
});
async function start(f: Fixture) {
  return z
    .object({ runId: z.string() })
    .parse(await f.service.start('account-hr', command('start'))).runId;
}
function scope(run: MatchRun): MatchScope {
  return {
    demand: run.demand,
    actor: { id: 'hr', name: '演示·HR' },
    candidates: run.candidates.map(({ person, evidence }) => ({
      person,
      evidence,
    })),
  };
}
function directService(f: Fixture, run: MatchRun) {
  let next = 0;
  return createMatchingService({
    store: f.store,
    scope: async () => structuredClone(scope(run)),
    jev: { decide: f.decide },
    reviewUnsupported: f.dependencies.reviewUnsupported,
    now: () => '2031-04-05T06:07:08.000Z',
    id: () => 'direct-' + ++next,
  });
}
const observationInputs: { label: string; mutate(f: Fixture): void }[] = [
  {
    label: '旧事件确认性质，即使record与field都标为evaluation',
    mutate: (f) => {
      f.facts.forEach((fact) => {
        fact.nature = 'management_observation';
      });
    },
  },
  {
    label: '独立观察投影的record分类',
    mutate: (f) => {
      f.records
        .filter((record) => record.kind !== 'person')
        .forEach((record) => {
          record.kind = 'management-observation';
        });
    },
  },
  {
    label: 'evaluation record中的观察behavior字段',
    mutate: (f) => {
      f.records.forEach((record) => {
        record.fields
          .filter((field) => field.name === 'behavior')
          .forEach((field) => {
            field.kind = 'management-observation';
          });
      });
    },
  },
  {
    label: '观察来源分类',
    mutate: (f) => {
      f.rawSources.forEach((source) => {
        source.kind = 'management-observation';
      });
    },
  },
  {
    label: '混合片段requiredKinds中的观察性质',
    mutate: (f) => {
      f.rawSources.forEach((source) => {
        source.requiredKinds = ['management-observation'];
      });
    },
  },
];
it.each(observationInputs)(
  '排除$label：同一正文不触发模型，也不伪造反证',
  async ({ mutate }) => {
    const f = matchingFixture();
    const originalText = f.sources.map((source) => source.excerpt);
    mutate(f);
    const runId = await start(f);
    await f.service.execute(runId, 1);
    expect(f.decide).not.toHaveBeenCalled();
    expect(f.sources.map((source) => source.excerpt)).toEqual(originalText);
    const cells = f.store.state.runs
      .get(runId)!
      .candidates.flatMap((candidate) => candidate.cells);
    expect(cells).toHaveLength(4);
    expect(
      cells.every(
        ({ match }) =>
          match.progress === 'awaiting_manual' &&
          match.aiJudgment === null &&
          match.humanJudgment === null,
      ),
    ).toBe(true);
  },
);
it('相同正文为已确认事实时仍可匹配；混合输入只发送有效事实', async () => {
  const valid = matchingFixture();
  await valid.service.execute(await start(valid), 1);
  expect(valid.decide).toHaveBeenCalledTimes(4);
  const mixed = matchingFixture();
  mixed.facts[0]!.nature = 'management_observation';
  expect(mixed.sources[0]!.excerpt).toBe(valid.sources[0]!.excerpt);
  const runId = await start(mixed);
  await mixed.service.execute(runId, 1);
  expect(mixed.decide).toHaveBeenCalledTimes(3);
  expect(JSON.stringify(mixed.decide.mock.calls)).not.toContain(
    'fragment-demo-a',
  );
  expect(JSON.stringify(mixed.decide.mock.calls)).toContain('fragment-demo-b');
  expect(
    mixed.store.state.runs.get(runId)!.candidates[0]!.cells[0]!.match,
  ).toMatchObject({
    progress: 'awaiting_manual',
    aiJudgment: null,
    humanJudgment: null,
  });
});
it('服务入口绕过loader时仍排除观察，不把通用授权当匹配资格', async () => {
  const f = matchingFixture();
  const runId = await start(f);
  const original = structuredClone(f.store.state.runs.get(runId)!);
  original.candidates.forEach((candidate) => {
    candidate.evidence.forEach((unit) => {
      unit.nature = 'management_observation';
    });
  });
  const service = directService(f, original);
  const next = z
    .object({ runId: z.string() })
    .parse(await service.start('account-hr', command('direct')));
  await service.execute(next.runId, 1);
  expect(f.decide).not.toHaveBeenCalled();
  expect(
    f.store.state.runs
      .get(next.runId)!
      .candidates.every((candidate) => candidate.evidence.length === 0),
  ).toBe(true);
});
it('旧run保留的观察不在新worker执行时外发', async () => {
  const f = matchingFixture();
  const runId = await start(f);
  const run = f.store.state.runs.get(runId)!;
  run.candidates.forEach((candidate) => {
    candidate.evidence.forEach((unit) => {
      unit.nature = 'management_observation';
    });
  });
  await directService(f, run).execute(runId, 1);
  expect(f.decide).not.toHaveBeenCalled();
  expect(
    f.store.state.runs
      .get(runId)!
      .candidates.every((candidate) =>
        candidate.cells.every(
          ({ match }) =>
            match.progress === 'awaiting_manual' && match.aiJudgment === null,
        ),
      ),
  ).toBe(true);
});
it('直接读取旧run时隐藏依赖观察产生的结论和出处', async () => {
  const f = matchingFixture();
  const runId = await start(f);
  await f.service.execute(runId, 1);
  const run = structuredClone(f.store.state.runs.get(runId)!);
  run.candidates.forEach((candidate) => {
    candidate.evidence.forEach((unit) => {
      unit.nature = 'management_observation';
    });
  });
  const projected = projectMatchingRun(run, scope(run));
  expect(
    projected.candidates.every((candidate) =>
      candidate.requirements.every(
        (match) =>
          match.progress === 'awaiting_manual' &&
          match.aiJudgment === null &&
          match.humanJudgment === null,
      ),
    ),
  ).toBe(true);
  expect(JSON.stringify(projected)).not.toContain('fragment-demo-');
});
