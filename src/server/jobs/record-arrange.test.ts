import type { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import {
  createRecordArrangePolicy,
  recordArrangeQueue,
  registerRecordArrangeJob,
} from './record-arrange';
import { newJob, type JobRecord } from './state';
import {
  exampleResponse,
  exampleSnapshot,
} from '../modules/records/arrange/examples';
import {
  arrangeRecord,
  prepareArrange,
  type ArrangeSnapshot,
} from '../modules/records/arrange';
import { createFakeMaas } from '../integrations/maas';

const now = '2026-10-25T16:00:00.000Z';
function job(): JobRecord {
  return newJob(
    {
      jobId: 'job-demo',
      kind: 'record_organize',
      resourceId: 'draft-demo-text',
      inputVersion: 'input-v1',
    },
    now,
  );
}
function policyHarness() {
  const snapshot = exampleSnapshot();
  const authorize = vi.fn(async () => true);
  const enqueue = vi.fn(async () => {});
  const load = vi.fn(async (): Promise<ArrangeSnapshot | null> =>
    structuredClone(snapshot),
  );
  return {
    snapshot,
    authorize,
    enqueue,
    load,
    policy: createRecordArrangePolicy({
      authorize,
      enqueue,
      load,
      currentInputVersion: async () => snapshot.inputVersion,
    }),
  };
}
describe('record arrange consumer definition', () => {
  it('disables queue retries and validates only jobId/attempt payloads', async () => {
    const boss = { createQueue: vi.fn(), work: vi.fn() };
    const run = vi.fn(async () => 'ignored');
    await registerRecordArrangeJob(boss as unknown as PgBoss, { run });
    expect(boss.createQueue).toHaveBeenCalledWith(recordArrangeQueue, {
      retryLimit: 0,
    });
    const callback = boss.work.mock.calls[0]![1] as (
      jobs: { data: unknown }[],
    ) => Promise<void>;
    await callback([{ data: { jobId: 'job-demo', attempt: 1 } }]);
    expect(run).toHaveBeenCalledWith('job-demo', 1);
    await expect(
      callback([
        { data: { jobId: 'job-demo', attempt: 1, text: 'client text' } },
      ]),
    ).rejects.toThrow();
    expect(run).toHaveBeenCalledOnce();
  });
  it.each(['outcome_unknown', 'invalid_response', 'permission'] as const)(
    'does not offer retry for %s even if a persisted flag says retryable',
    async (kind) => {
      const h = policyHarness();
      const current = {
        ...job(),
        status: 'failed' as const,
        result: {
          state: 'failure',
          inputVersion: 'input-v1',
          attemptsUsed: 1,
          failure: { kind, retryable: true },
        },
      };
      expect(await h.policy.can({}, 'demo-account', current, 'retry')).toBe(
        false,
      );
    },
  );
  it('offers one explicit safe network retry and enqueues in the supplied context', async () => {
    const h = policyHarness();
    const current = {
      ...job(),
      status: 'failed' as const,
      result: {
        state: 'failure',
        inputVersion: 'input-v1',
        attemptsUsed: 1,
        failure: { kind: 'network', retryable: true },
      },
    };
    expect(await h.policy.can({}, 'demo-account', current, 'retry')).toBe(true);
    expect(
      await h.policy.can(
        {},
        'demo-account',
        {
          ...current,
          attempt: 2,
          result: { ...current.result, attemptsUsed: 2 },
        },
        'retry',
      ),
    ).toBe(false);
    const context = { transaction: 'same' };
    await h.policy.enqueue(context, current, 'retry');
    expect(h.enqueue).toHaveBeenCalledWith(context, current, 'retry');
  });
  it('requires explicit control authority independently of read/model input', async () => {
    const h = policyHarness();
    h.authorize.mockResolvedValue(false);
    expect(await h.policy.can({}, 'demo-account', job(), 'read')).toBe(false);
    expect(await h.policy.can({}, 'demo-account', job(), 'cancel')).toBe(false);
    expect(h.load).not.toHaveBeenCalled();
  });
  it('projects only a public draft and hides private versions, subjects and failure classifications', async () => {
    const h = policyHarness();
    const output = await arrangeRecord(
      async () => h.snapshot,
      createFakeMaas(exampleResponse()),
    );
    const prepared = await prepareArrange(h.snapshot);
    if (output.status !== 'arranged' || prepared.status !== 'ready')
      throw new Error('fixture');
    const draft = { ...output.value.draft, revision: 1 };
    const record = {
      ...job(),
      status: 'awaiting_manual' as const,
      result: {
        state: 'draft',
        draft,
        fingerprint: prepared.fingerprint,
        inputVersion: 'input-v1',
        promptVersion: output.value.promptVersion,
        modelVersion: output.value.modelVersion,
        ruleVersionId: 'rule-current',
      },
    };
    expect(await h.policy.project({}, 'demo-account', record)).toEqual({
      result: draft,
      progress: null,
    });
    h.snapshot.authorization.sources[0]!.subjects.push({
      personId: 'hidden',
      cohortId: 'other',
    });
    expect(await h.policy.can({}, 'demo-account', record, 'read')).toBe(false);
    expect(await h.policy.project({}, 'demo-account', record)).toEqual({
      result: null,
      progress: null,
    });
    expect(
      await h.policy.project({}, 'demo-account', {
        ...job(),
        result: { state: 'selection_required', inputVersion: 'input-v1' },
      }),
    ).toEqual({ result: null, progress: null });
  });
  it('does not resume completed drafts or unbound selection results', async () => {
    const h = policyHarness();
    expect(await h.policy.canResume({}, job())).toBe(false);
    expect(await h.policy.can({}, 'demo-account', job(), 'resume')).toBe(false);
    expect(await h.policy.inputVersion({}, job())).toBe('input-v1');
  });
  it('returns cancelled history without reloading a superseded input or exposing its old selection', async () => {
    const h = policyHarness();
    h.load.mockResolvedValue(null);
    const cancelled = {
      ...job(),
      status: 'cancelled' as const,
      result: { state: 'selection_required', inputVersion: 'input-v1' },
    };
    expect(await h.policy.can({}, 'demo-account', cancelled, 'read')).toBe(
      true,
    );
    expect(await h.policy.project({}, 'demo-account', cancelled)).toEqual({
      result: null,
      progress: null,
    });
    expect(h.load).not.toHaveBeenCalled();
    h.authorize.mockResolvedValue(false);
    expect(await h.policy.can({}, 'demo-account', cancelled, 'read')).toBe(
      false,
    );
  });
  it('projects current authorized selection candidates and reasons without SBI', async () => {
    const h = policyHarness();
    h.snapshot.people = [
      {
        state: 'needs_selection',
        candidates: [{ id: 'demo-lin', label: '林舟（演示）' }],
        reason: '请选人',
      },
    ];
    const pending = {
      ...job(),
      status: 'awaiting_manual' as const,
      result: { state: 'selection_required', inputVersion: 'input-v1' },
    };
    const result = await h.policy.project({}, 'demo-account', pending);
    expect(result.result).toMatchObject({
      state: 'selection_required',
      draftId: 'draft-demo-text',
      inputVersion: 'input-v1',
      people: [{ state: 'needs_selection', reason: '请选人' }],
    });
    expect(result.result).not.toHaveProperty('sbi');
    h.snapshot.inputVersion = 'changed';
    expect(await h.policy.project({}, 'demo-account', pending)).toEqual({
      result: null,
      progress: null,
    });
  });
});
