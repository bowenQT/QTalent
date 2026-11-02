import { describe, expect, it, vi } from 'vitest';
import { createRecordArrangeUsecase } from './record-arrange';
import { createFakeMaas, metadataFor } from '../integrations/maas';
import {
  exampleResponse,
  exampleSnapshot,
} from '../modules/records/arrange/examples';
import type { JobStore } from '../jobs/service';
import { applyJobCommand, newJob, type JobRecord } from '../jobs/state';
import type { RecordDraft } from '../../contracts/record';

const now = () => '2026-10-25T16:00:00.000Z';
function harness() {
  let record: JobRecord = newJob(
    {
      jobId: 'job-demo',
      kind: 'record_organize',
      resourceId: 'draft-demo-text',
      inputVersion: 'input-v1',
    },
    now(),
  );
  let saved: RecordDraft[] = [];
  const current = exampleSnapshot();
  let permitted = true;
  let tail: Promise<unknown> = Promise.resolve();
  const store: JobStore<{ drafts: RecordDraft[] }> = {
    locked(jobId, run) {
      const task = tail.then(async () => {
        if (jobId !== record.jobId) throw new Error('unexpected job');
        let pending = structuredClone(record);
        const context = { drafts: structuredClone(saved) };
        const value = await run({
          context,
          record: pending,
          save: async (next) => {
            pending = structuredClone(next);
          },
          operation: async () => null,
          saveOperation: async () => {},
        });
        record = pending;
        saved = context.drafts;
        return value;
      });
      tail = task.catch(() => undefined);
      return task;
    },
  };
  const load = vi.fn(async () => structuredClone(current));
  const authorize = vi.fn(async () => permitted);
  const persist = vi.fn(
    async (
      tx: { drafts: RecordDraft[] },
      input: { draft: Omit<RecordDraft, 'revision'> },
    ) => {
      const draft = { ...input.draft, revision: 1 };
      tx.drafts.push(draft);
      return draft;
    },
  );
  const client = createFakeMaas(exampleResponse());
  const generate = vi.spyOn(client, 'generateStructured');
  const service = createRecordArrangeUsecase({
    store,
    load,
    authorize,
    persistRecordDraft: persist,
    client,
    now,
  });
  return {
    service,
    load,
    authorize,
    persist,
    client,
    generate,
    store,
    get record() {
      return record;
    },
    get saved() {
      return saved;
    },
    change(fn: (s: typeof current) => void) {
      fn(current);
    },
    permit(value: boolean) {
      permitted = value;
    },
    setRecord(value: JobRecord) {
      record = value;
    },
  };
}
describe('record arrange job fences and persistence seam', () => {
  it('persists only a validated draft and all version metadata in the final transaction', async () => {
    const h = harness();
    expect(await h.service.run('job-demo', 1)).toBe('awaiting_manual');
    expect(h.record.status).toBe('awaiting_manual');
    expect(h.saved).toHaveLength(1);
    expect(h.persist.mock.calls[0]![0]).toHaveProperty('drafts');
    expect(h.persist.mock.calls[0]![1]).toMatchObject({
      promptVersion: 'record-arrange.v1',
      inputVersion: 'input-v1',
      ruleVersionId: 'rule-current',
    });
    expect(h.generate).toHaveBeenCalledOnce();
    expect(h.load).toHaveBeenCalledTimes(2);
  });
  it('claims a queued attempt once under concurrent duplicate delivery', async () => {
    const h = harness();
    await Promise.all([
      h.service.run('job-demo', 1),
      h.service.run('job-demo', 1),
    ]);
    expect(h.generate).toHaveBeenCalledOnce();
    expect(h.persist).toHaveBeenCalledOnce();
  });
  it.each(['input', 'rule', 'quote', 'binding', 'authorization'] as const)(
    'does not commit after %s changes during the model call',
    async (kind) => {
      const h = harness();
      const fake = createFakeMaas(exampleResponse());
      h.generate.mockImplementation(async (input) => {
        if (kind === 'input')
          h.change((s) => {
            s.inputVersion = 'input-v2';
          });
        if (kind === 'rule')
          h.change((s) => {
            s.ruleVersionId = 'rule-next';
          });
        if (kind === 'quote')
          h.change((s) => {
            s.authorization.sources[0]!.excerpt = '变更的来源';
          });
        if (kind === 'binding')
          h.change((s) => {
            s.requestedSources[0]!.attributedPersonIds = [];
          });
        if (kind === 'authorization') h.permit(false);
        return fake.generateStructured(input);
      });
      await h.service.run('job-demo', 1);
      expect(h.persist).not.toHaveBeenCalled();
      expect(h.record.status).toBe('failed');
      expect(h.record.result).toMatchObject({
        state: 'failure',
        failure: { retryable: false },
      });
    },
  );
  it('honors cancellation while a response is in flight', async () => {
    const h = harness();
    const fake = createFakeMaas(exampleResponse());
    h.generate.mockImplementation(async (input) => {
      h.setRecord(
        applyJobCommand(
          h.record,
          { action: 'cancel', expectedRevision: h.record.revision },
          now(),
        ),
      );
      return fake.generateStructured(input);
    });
    expect(await h.service.run('job-demo', 1)).toBe('cancelled');
    expect(h.record.status).toBe('cancelled');
    expect(h.persist).not.toHaveBeenCalled();
  });
  it('stores selection-required without a fake SBI or a model call', async () => {
    const h = harness();
    h.change((s) => {
      s.people = [
        { state: 'needs_selection', candidates: [], reason: '请选人' },
      ];
    });
    expect(await h.service.run('job-demo', 1)).toBe('awaiting_manual');
    expect(h.record.result).toEqual({
      state: 'selection_required',
      inputVersion: 'input-v1',
    });
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
  });
  it('does not call a model when current write authorization is absent', async () => {
    const h = harness();
    h.permit(false);
    await h.service.run('job-demo', 1);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
  });
  it('persists outcome_unknown and the attempt budget without automatic retry', async () => {
    const h = harness();
    h.generate.mockImplementation(async (input) => ({
      ok: false,
      kind: 'outcome_unknown',
      retryable: true,
      metadata: metadataFor(input),
    }));
    await h.service.run('job-demo', 1);
    expect(h.record.result).toEqual({
      state: 'failure',
      inputVersion: 'input-v1',
      attemptsUsed: 1,
      failure: { kind: 'outcome_unknown', retryable: false },
    });
    await h.service.run('job-demo', 1);
    expect(h.generate).toHaveBeenCalledOnce();
  });
  it('rejects old deliveries and exhausted attempts without a model call', async () => {
    const h = harness();
    expect(await h.service.run('job-demo', 2)).toBe('ignored');
    h.setRecord({ ...h.record, attempt: 3 });
    expect(await h.service.run('job-demo', 3)).toBe('ignored');
    expect(h.generate).not.toHaveBeenCalled();
  });
  it('rolls back the draft and job transition when the persistence port fails', async () => {
    const h = harness();
    h.persist.mockImplementation(async (tx) => {
      tx.drafts.push({
        ...exampleResponse(),
        ...exampleSnapshot().originalInput,
      } as unknown as RecordDraft);
      throw new Error('db unavailable');
    });
    await expect(h.service.run('job-demo', 1)).rejects.toThrow(
      'db unavailable',
    );
    expect(h.saved).toEqual([]);
    expect(h.record.status).toBe('running');
  });
});
