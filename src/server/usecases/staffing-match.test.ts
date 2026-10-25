import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  staffingPageSchema,
  staffingJudgmentResultSchema,
} from '../../contracts/staffing';
import { JevError } from '../integrations/jev';
import { applyJobCommand } from '../jobs/state';
import { sourceSchema } from '../../contracts/sources';
import { matchingFixture } from '../../../tests/fixtures/staffing-matching';

const input = {
  operationId: 'start-a',
  demandId: 'demand-a',
  expectedRevision: 2,
};
const startedSchema = z.object({
  status: z.literal('success'),
  runId: z.string(),
  replayed: z.boolean(),
});
const pageResultSchema = z.object({
  status: z.literal('success'),
  page: staffingPageSchema,
});
async function start(
  f: ReturnType<typeof matchingFixture>,
  operationId = 'start-a',
) {
  return startedSchema.parse(
    await f.service.start('account-hr', { ...input, operationId }),
  );
}
async function page(f: ReturnType<typeof matchingFixture>, id: string) {
  return pageResultSchema.parse(await f.service.read('account-hr', id)).page;
}
const judgment = {
  operationId: 'judge-a',
  demandId: 'demand-a',
  expectedRevision: 2,
  personId: 'demo-a',
  requirementId: 'required-a',
  conclusion: 'not_supported',
  rationale: '演示人工复核：本条证据未满足要求',
  sources: [
    {
      fragmentId: 'fragment-demo-a',
      originalVersionId: 'version-demo-a',
      location: { kind: 'document', paragraph: '段落-demo-a' },
    },
  ],
};

describe('BOW-854 authorized matching', () => {
  it('requires a current confirmed demand, not a completed generation or old revision', async () => {
    const f = matchingFixture();
    f.readDemand.mockImplementation(async () => ({
      id: f.demand.id,
      projectId: f.demand.projectId,
      revision: f.demand.revision,
      inputText: f.demand.inputText,
      requirements: f.demand.requirements,
      status: 'draft',
    }));
    expect(await f.service.start('account-hr', input)).toMatchObject({
      status: 'conflict',
    });
    expect(f.store.state.runs.size).toBe(0);
    expect(f.decide).not.toHaveBeenCalled();
  });
  it('rejects malformed inputs without accepting a client actor or confirmation time', async () => {
    const f = matchingFixture();
    expect(
      await f.service.start('account-hr', { ...input, actorId: 'manager' }),
    ).toMatchObject({ status: 'validation_error' });
    expect(
      await f.service.judge('account-hr', 'run-missing', {
        ...judgment,
        judgedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'validation_error' });
  });
  it('produces all four conclusions with exact sources; hidden people never reach the model', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(value.candidates.map((c) => c.person.id)).toEqual([
      'demo-a',
      'demo-b',
      'demo-c',
      'demo-d',
    ]);
    expect(
      value.candidates.map((c) => c.requirements[0]?.aiJudgment?.conclusion),
    ).toEqual(['supported', 'not_supported', 'insufficient', 'conflict']);
    expect(f.decide).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain('范围外');
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain(
      'fragment-hidden',
    );
    for (const candidate of value.candidates) {
      expect(candidate.requirements[0]?.aiJudgment?.sources).toEqual([
        f.sources.find(
          (source) => source.fragmentId === 'fragment-' + candidate.person.id,
        ),
      ]);
      expect(candidate.requirements[0]?.humanJudgment).toBeNull();
    }
    expect(JSON.stringify(value)).not.toMatch(
      /confidence|percentage|totalScore|rank/,
    );
  });
  it('uses business date for authorization and real wall time for jobs', async () => {
    const f = matchingFixture(),
      result = await start(f);
    expect(
      f.loadEvidence.mock.calls.every((call) => call[1] === '2026-09-04'),
    ).toBe(true);
    expect(f.store.state.jobs.get(result.runId)?.updatedAt).toBe(
      '2031-04-05T06:07:08.000Z',
    );
    expect(f.readDemand).toHaveBeenCalledWith('account-hr', 'demand-a', 2);
  });
  it('does not infer event confirmation from scores or pass drafts and AI suggestions', async () => {
    const f = matchingFixture();
    f.facts[0]!.state = 'draft';
    f.facts[1]!.active = false;
    f.records.find((r) => r.id === 'event-demo-c')!.kind = 'ai-inference';
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(
      value.candidates
        .slice(0, 3)
        .every(
          (c) =>
            c.requirements[0]?.progress === 'awaiting_manual' &&
            c.requirements[0]?.aiJudgment === null,
        ),
    ).toBe(true);
    expect(f.decide).toHaveBeenCalledTimes(1);
  });
  it('allows empty situation but requires behavior and rejects mixed unauthorized fragments', async () => {
    const f = matchingFixture();
    f.records
      .find((r) => r.id === 'event-demo-b')!
      .fields.find((field) => field.name === 'behavior')!.value = '';
    f.rawSources[0]!.subjects.push({
      personId: 'hidden',
      cohortId: 'cohort-b',
    });
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(value.candidates[0]?.requirements[0]?.aiJudgment).toBeNull();
    expect(value.candidates[1]?.requirements[0]?.aiJudgment).toBeNull();
    expect(f.decide).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain(
      'fragment-demo-a',
    );
  });
  it.each([
    'timeout',
    'invalid_response',
    'configuration',
    'outcome_unknown',
  ] as const)(
    'keeps %s as awaiting manual with no invented conclusion',
    async (kind) => {
      const f = matchingFixture();
      f.decide.mockRejectedValue(new JevError(kind));
      const result = await start(f);
      await f.service.execute(result.runId, 1);
      expect(
        (await page(f, result.runId)).candidates.every(
          (c) =>
            c.requirements[0]?.progress === 'awaiting_manual' &&
            c.requirements[0]?.aiJudgment === null,
        ),
      ).toBe(true);
      expect(f.store.state.jobs.get(result.runId)?.status).toBe(
        'awaiting_manual',
      );
      expect(f.decide).toHaveBeenCalledTimes(4);
    },
  );
  it('expires old judgments after demand revision changes and makes no further model call', async () => {
    const f = matchingFixture(),
      result = await start(f);
    f.demand.revision = 3;
    await f.service.execute(result.runId, 1);
    expect(await f.service.read('account-hr', result.runId)).toMatchObject({
      status: 'stale',
      demandRevision: 2,
    });
    expect(f.decide).not.toHaveBeenCalled();
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'conflict', input: judgment });
  });
  it('reauthorizes reads and idempotent replay after revocation', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 1);
    f.context.grants[0]!.revokedAt = '2026-09-03';
    expect(await f.service.read('account-hr', result.runId)).toMatchObject({
      status: 'forbidden',
    });
    expect(await f.service.start('account-hr', input)).toMatchObject({
      status: 'forbidden',
    });
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'forbidden' });
  });
  it('signs a manual conclusion server-side, preserves AI, and does not overwrite it with a second operation', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 1);
    const saved = staffingJudgmentResultSchema.parse(
      await f.service.judge('account-hr', result.runId, judgment),
    );
    expect(saved).toMatchObject({
      status: 'success',
      match: {
        aiJudgment: { conclusion: 'supported' },
        humanJudgment: {
          conclusion: 'not_supported',
          judgedBy: { id: 'hr', name: '演示·HR' },
          judgedAt: '2031-04-05T06:07:08.000Z',
        },
      },
    });
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'success', replayed: true });
    expect(
      await f.service.judge('account-hr', result.runId, {
        ...judgment,
        operationId: 'other',
      }),
    ).toMatchObject({ status: 'conflict' });
    expect(f.store.state.jobs.get(result.runId)?.status).toBe('completed');
  });
  it('binds human operation explicitly to a run and refuses forged or foreign sources', async () => {
    const f = matchingFixture(),
      first = await start(f),
      second = await start(f, 'start-b');
    await f.service.execute(first.runId, 1);
    await f.service.execute(second.runId, 1);
    expect(
      await f.service.judge('account-hr', first.runId, {
        ...judgment,
        sources: [{ ...judgment.sources[0], fragmentId: 'fragment-demo-b' }],
      }),
    ).toMatchObject({ status: 'conflict' });
    expect(
      await f.service.judge('account-hr', first.runId, judgment),
    ).toMatchObject({ status: 'success' });
    expect(
      (await page(f, second.runId)).candidates[0]?.requirements[0]
        ?.humanJudgment,
    ).toBeNull();
    expect(
      await f.service.judge('account-hr', second.runId, judgment),
    ).toMatchObject({ status: 'conflict' });
  });
  it('serializes duplicate starts and rolls back the run/job/operation if enqueue fails', async () => {
    const f = matchingFixture();
    const results = await Promise.all([start(f), start(f)]);
    expect(results[0]?.runId).toBe(results[1]?.runId);
    expect(f.store.state.enqueued).toHaveLength(1);
    expect(
      await f.service.start('account-hr', { ...input, expectedRevision: 3 }),
    ).toMatchObject({ status: 'conflict' });
    f.store.failEnqueue = true;
    await expect(
      f.service.start('account-hr', { ...input, operationId: 'failed-queue' }),
    ).rejects.toThrow('queue unavailable');
    expect(f.store.state.runs.size).toBe(1);
    expect(f.store.state.operations.size).toBe(1);
  });
  it('does not reissue completed or wrong-attempt deliveries', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 2);
    expect(f.decide).not.toHaveBeenCalled();
    await f.service.execute(result.runId, 1);
    await f.service.execute(result.runId, 1);
    expect(f.decide).toHaveBeenCalledTimes(4);
  });
  it('completes awaiting_manual through resume without another model enqueue', async () => {
    const f = matchingFixture();
    f.records.splice(
      0,
      f.records.length,
      ...f.records.filter((record) => record.subject.personId === 'demo-a'),
    );
    f.decide.mockRejectedValue(new JevError('timeout'));
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    const before = f.store.state.jobs.get(result.runId)!;
    expect(before.status).toBe('awaiting_manual');
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'success' });
    expect(f.store.state.jobs.get(result.runId)).toMatchObject({
      status: 'completed',
      revision: before.revision + 2,
    });
    expect(f.store.state.enqueued).toHaveLength(1);
    expect(f.decide).toHaveBeenCalledTimes(1);
  });
  it('cancellation during an in-flight model call prevents its late conclusion', async () => {
    const f = matchingFixture();
    let finish!: (value: { conclusion: 'supported' }) => void;
    f.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = await start(f),
      running = f.service.execute(result.runId, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    await f.store.transaction(result.runId, async (tx) => {
      const value = (await tx.load(result.runId))!;
      await tx.save(
        value.run,
        applyJobCommand(
          value.job,
          { action: 'cancel', expectedRevision: value.job.revision },
          '2031-04-05T06:08:00.000Z',
        ),
      );
    });
    finish({ conclusion: 'supported' });
    await running;
    expect(f.store.state.jobs.get(result.runId)?.status).toBe('cancelled');
    expect(
      f.store.state.runs
        .get(result.runId)
        ?.candidates.every(
          (candidate) => candidate.cells[0]?.match.aiJudgment === null,
        ),
    ).toBe(true);
    expect(f.decide).toHaveBeenCalledTimes(1);
  });
  it('acknowledges cancellation wake-up even when Jev has already entered awaiting_manual', async () => {
    const f = matchingFixture();
    f.decide.mockRejectedValue(new JevError('timeout'));
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    await f.store.transaction(result.runId, async (tx) => {
      const value = (await tx.load(result.runId))!;
      await tx.save(
        value.run,
        applyJobCommand(
          value.job,
          { action: 'cancel', expectedRevision: value.job.revision },
          '2031-04-05T06:08:00.000Z',
        ),
      );
    });
    await f.service.execute(result.runId, 1);
    expect(f.store.state.jobs.get(result.runId)?.status).toBe('cancelled');
    expect(f.decide).toHaveBeenCalledTimes(4);
  });
  it('a duplicate delivery claims each cell once even while a previous provider call is pending', async () => {
    const f = matchingFixture();
    let finish!: (value: { conclusion: 'supported' }) => void;
    f.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = await start(f),
      first = f.service.execute(result.runId, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    await f.service.execute(result.runId, 1);
    finish({ conclusion: 'supported' });
    await first;
    expect(f.decide).toHaveBeenCalledTimes(4);
    expect(
      new Set(f.decide.mock.calls.map(([call]) => call.evidence[0]?.sourceRef))
        .size,
    ).toBe(4);
  });
  it('never replaces a human decision with an in-flight model result', async () => {
    const f = matchingFixture();
    let finish!: (value: { conclusion: 'supported' }) => void;
    f.records.splice(
      0,
      f.records.length,
      ...f.records.filter((record) => record.subject.personId === 'demo-a'),
    );
    f.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = await start(f),
      running = f.service.execute(result.runId, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'success' });
    finish({ conclusion: 'supported' });
    await running;
    expect(
      (await page(f, result.runId)).candidates[0]?.requirements[0],
    ).toMatchObject({
      aiJudgment: null,
      humanJudgment: { conclusion: 'not_supported' },
    });
  });
  it('rechecks initiator authorization after dispatch and rejects revoked late work', async () => {
    const f = matchingFixture();
    let finish!: (value: { conclusion: 'supported' }) => void;
    f.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = await start(f),
      running = f.service.execute(result.runId, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    f.context.grants[0]!.revokedAt = '2026-09-03';
    finish({ conclusion: 'supported' });
    await running;
    expect(f.store.state.jobs.get(result.runId)).toMatchObject({
      status: 'failed',
      errorCode: 'input_changed',
      result: null,
    });
    expect(
      f.store.state.runs.get(result.runId)?.candidates[0]?.cells[0]?.match
        .aiJudgment,
    ).toBeNull();
  });
  it('suppresses a result if source text changes after dispatch, and requires manual judgment', async () => {
    const f = matchingFixture();
    let finish!: (value: { conclusion: 'supported' }) => void;
    f.decide.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const result = await start(f),
      running = f.service.execute(result.runId, 1);
    await vi.waitFor(() => expect(f.decide).toHaveBeenCalledTimes(1));
    f.sources[0]!.excerpt = '演示：已更正的来源';
    f.rawSources[0]!.excerpt = '演示：已更正的来源';
    finish({ conclusion: 'supported' });
    await running;
    expect(
      (await page(f, result.runId)).candidates.find(
        (candidate) => candidate.person.id === 'demo-a',
      )?.requirements[0],
    ).toMatchObject({ progress: 'awaiting_manual', aiJudgment: null });
  });
  it.each(['originalTitle', 'recordedByName'] as const)(
    'suppresses derived judgments when current source %s changes without inventing metadata',
    async (field) => {
      const f = matchingFixture(),
        result = await start(f);
      await f.service.execute(result.runId, 1);
      const before = (await page(f, result.runId)).candidates.find(
        (candidate) => candidate.person.id === 'demo-a',
      )!.requirements[0]!.aiJudgment!;
      expect(before.sources[0]).toMatchObject({
        originalTitle: '演示·接口验收记录',
        recordedByName: null,
      });
      f.sources[0]![field] =
        field === 'originalTitle' ? '演示·已更正的原件标题' : '演示·原件记录人';
      const current = (await page(f, result.runId)).candidates.find(
        (candidate) => candidate.person.id === 'demo-a',
      )!.requirements[0]!;
      expect(current).toMatchObject({
        progress: 'awaiting_manual',
        aiJudgment: null,
        humanJudgment: null,
      });
      expect(
        await f.service.judge('account-hr', result.runId, judgment),
      ).toMatchObject({ status: 'conflict' });
      expect(f.decide).toHaveBeenCalledTimes(4);
    },
  );
  it('orders only by supported required items and keeps unknowns and bonus items from becoming penalties', async () => {
    const f = matchingFixture();
    f.demand.requirements.push(
      { id: 'required-b', text: '第二项必须要求', priority: 'required' },
      { id: 'bonus-a', text: '加分要求', priority: 'bonus' },
    );
    f.decide.mockImplementation(async ({ requirement }) => {
      const data = JSON.parse(requirement) as {
        personId: string;
        requirementId: string;
      };
      return {
        conclusion:
          (data.personId === 'demo-b' &&
            data.requirementId.startsWith('required')) ||
          (data.requirementId === 'required-a' && data.personId !== 'demo-d') ||
          (data.personId === 'demo-d' && data.requirementId === 'bonus-a')
            ? 'supported'
            : data.personId === 'demo-c'
              ? 'not_supported'
              : 'insufficient',
      };
    });
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    expect(
      (await page(f, result.runId)).candidates.map(
        (candidate) => candidate.person.id,
      ),
    ).toEqual(['demo-b', 'demo-a', 'demo-c', 'demo-d']);
    expect(f.decide).toHaveBeenCalledTimes(12);
    const run = f.store.state.runs.get(result.runId)!;
    expect(run.inputFormatVersion).toBe('staffing-match-input-v1');
    expect(run.jevPromptVersion).toBe('requirement-match-v1');
    expect(JSON.stringify(f.decide.mock.calls)).toContain(
      'management_observation',
    );
  });
  it('filters stored derived judgments again when a shared source becomes unauthorized', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 1);
    f.rawSources[0]!.subjects.push({
      personId: 'hidden',
      cohortId: 'cohort-b',
    });
    const value = await page(f, result.runId),
      match = value.candidates.find(
        (candidate) => candidate.person.id === 'demo-a',
      )?.requirements[0];
    expect(match).toMatchObject({
      progress: 'awaiting_manual',
      aiJudgment: null,
      humanJudgment: null,
    });
    expect(JSON.stringify(value)).not.toContain('fragment-demo-a');
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'conflict' });
  });
  it.each([
    { kind: 'document' as const, page: 2, paragraph: '第七段' },
    { kind: 'spreadsheet' as const, sheet: '演示验收', cell: 'C4' },
    { kind: 'recording' as const, startMs: 1200, endMs: 2500 },
    {
      kind: 'snapshot_field' as const,
      fieldPath: 'events.demo-a.behavior',
      originalLocation: '固定演示快照',
    },
  ])(
    'preserves exact $kind references, including confirmed baseline evidence without inventing a confirmation time',
    async (location) => {
      const f = matchingFixture();
      f.records.splice(
        0,
        f.records.length,
        ...f.records.filter((record) => record.subject.personId === 'demo-a'),
      );
      const before = f.sources[0]!;
      f.sources[0] = sourceSchema.parse(
        location.kind === 'snapshot_field'
          ? {
              ...before,
              location,
              sourceCategory: 'prototype_baseline',
              sourceType: 'prototype_snapshot',
              displayNotice: '演示快照；不代表原始业务文件',
              demo: true,
            }
          : { ...before, location, sourceType: location.kind },
      );
      f.rawSources[0]!.location = location;
      if (location.kind === 'snapshot_field')
        f.facts[0]!.confirmation = {
          kind: 'prototype_baseline',
          id: 'baseline-confirmed-event',
          demo: true,
        };
      const result = await start(f);
      await f.service.execute(result.runId, 1);
      expect(
        (await page(f, result.runId)).candidates[0]?.requirements[0]?.aiJudgment
          ?.sources,
      ).toEqual([f.sources[0]]);
      const submitted = f.decide.mock.calls[0]![0];
      expect(submitted.evidence[0]?.sourceRef).toContain(location.kind);
      expect(submitted.evidence[0]?.text).not.toContain('confirmedAt');
    },
  );
  it('does not create a human confirmation timestamp or classify an original as a confirmed baseline', async () => {
    const f = matchingFixture();
    f.facts[0]!.confirmation = {
      kind: 'human',
      id: 'confirmed-a',
      actorId: 'hr',
      confirmedAt: '',
    };
    f.facts[1]!.confirmation = {
      kind: 'prototype_baseline',
      id: 'baseline-b',
      demo: true,
    };
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(
      value.candidates
        .slice(0, 2)
        .every((candidate) => candidate.requirements[0]?.aiJudgment === null),
    ).toBe(true);
    expect(f.decide).toHaveBeenCalledTimes(2);
  });
  it('does not expand a run when a broader manager reads it and always executes using the initiating account', async () => {
    const f = matchingFixture(),
      result = await start(f);
    f.context.grants.push({
      accountId: 'account-manager',
      role: 'manager',
      scope: 'company',
      cohortId: null,
      validFrom: '2026-01-01',
      validTo: null,
      revokedAt: null,
    });
    const managerPage = pageResultSchema.parse(
      await f.service.read('account-manager', result.runId),
    ).page;
    expect(
      managerPage.candidates.map((candidate) => candidate.person.id),
    ).toEqual(['demo-a', 'demo-b', 'demo-c', 'demo-d']);
    expect(
      await f.service.judge('account-manager', result.runId, {
        ...judgment,
        personId: 'hidden',
      }),
    ).toMatchObject({ status: 'not_found' });
    f.loadEvidence.mockClear();
    await f.service.execute(result.runId, 1);
    expect(
      f.loadEvidence.mock.calls.every(([account]) => account === 'account-hr'),
    ).toBe(true);
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain(
      'fragment-hidden',
    );
  });
  it('rejects a reused trusted snapshot bound to a different account or actor', async () => {
    const f = matchingFixture(),
      load = f.loadEvidence.getMockImplementation()!;
    f.loadEvidence.mockImplementation(async (account, today) => {
      const value = await load(account, today);
      value.snapshot.context.account.id = 'different-account';
      return value;
    });
    expect(await f.service.start('account-hr', input)).toMatchObject({
      status: 'forbidden',
    });
    expect(f.store.state.enqueued).toHaveLength(0);
    expect(f.decide).not.toHaveBeenCalled();
  });
  it('retains a safe category for unexpected provider exceptions and never discloses their evidence-bearing message', async () => {
    const f = matchingFixture();
    f.decide.mockRejectedValue(
      new Error('private-provider-payload-do-not-expose'),
    );
    const result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(
      value.candidates.every(
        (candidate) =>
          candidate.requirements[0]?.progress === 'awaiting_manual',
      ),
    ).toBe(true);
    expect(
      f.store.state.runs.get(result.runId)?.candidates[0]?.cells[0]
        ?.providerError,
    ).toBe('outcome_unknown');
    expect(JSON.stringify(value)).not.toContain('private-provider-payload');
  });
  it('does not replay a different human conclusion under the same operation id', async () => {
    const f = matchingFixture(),
      result = await start(f);
    await f.service.execute(result.runId, 1);
    expect(
      await f.service.judge('account-hr', result.runId, judgment),
    ).toMatchObject({ status: 'success' });
    expect(
      await f.service.judge('account-hr', result.runId, {
        ...judgment,
        conclusion: 'insufficient',
        sources: [],
      }),
    ).toMatchObject({ status: 'conflict' });
    expect(
      (await page(f, result.runId)).candidates.find(
        (candidate) => candidate.person.id === 'demo-a',
      )?.requirements[0]?.humanJudgment?.conclusion,
    ).toBe('not_supported');
  });
});
