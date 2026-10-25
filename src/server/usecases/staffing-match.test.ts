import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { staffingPageSchema, staffingJudgmentResultSchema } from '../../contracts/staffing';
import { JevError } from '../integrations/jev';
import { matchingFixture } from '../../../tests/fixtures/staffing-matching';

const input = { operationId: 'start-a', demandId: 'demand-a', expectedRevision: 2 };
const startedSchema = z.object({ status: z.literal('success'), runId: z.string(), replayed: z.boolean() });
const pageResultSchema = z.object({ status: z.literal('success'), page: staffingPageSchema });
async function start(f: ReturnType<typeof matchingFixture>, operationId = 'start-a') {
  return startedSchema.parse(await f.service.start('account-hr', { ...input, operationId }));
}
async function page(f: ReturnType<typeof matchingFixture>, id: string) {
  return pageResultSchema.parse(await f.service.read('account-hr', id)).page;
}
const judgment = { operationId: 'judge-a', demandId: 'demand-a', expectedRevision: 2, personId: 'demo-a', requirementId: 'required-a', conclusion: 'not_supported', rationale: '演示人工复核：本条证据未满足要求', sources: [{ fragmentId: 'fragment-demo-a', originalVersionId: 'version-demo-a', location: { kind: 'document', paragraph: '段落-demo-a' } }] };

describe('BOW-854 authorized matching', () => {
  it('requires a current confirmed demand, not a completed generation or old revision', async () => {
    const f = matchingFixture();
    f.demand.status = 'draft';
    expect(await f.service.start('account-hr', input)).toMatchObject({ status: 'conflict' });
    expect(f.store.state.runs.size).toBe(0);
    expect(f.decide).not.toHaveBeenCalled();
  });
  it('rejects malformed inputs without accepting a client actor or confirmation time', async () => {
    const f = matchingFixture();
    expect(await f.service.start('account-hr', { ...input, actorId: 'manager' })).toMatchObject({ status: 'validation_error' });
    expect(await f.service.judge('account-hr', 'run-missing', { ...judgment, judgedAt: '2026-01-01T00:00:00.000Z' })).toMatchObject({ status: 'validation_error' });
  });
  it('produces all four conclusions with exact sources; hidden people never reach the model', async () => {
    const f = matchingFixture(), result = await start(f);
    await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(value.candidates.map((c) => c.person.id)).toEqual(['demo-a', 'demo-b', 'demo-c', 'demo-d']);
    expect(value.candidates.map((c) => c.requirements[0]?.aiJudgment?.conclusion)).toEqual(['supported', 'not_supported', 'insufficient', 'conflict']);
    expect(f.decide).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain('范围外');
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain('fragment-hidden');
    for (const candidate of value.candidates) {
      expect(candidate.requirements[0]?.aiJudgment?.sources).toEqual([f.sources.find((source) => source.fragmentId === 'fragment-' + candidate.person.id)]);
      expect(candidate.requirements[0]?.humanJudgment).toBeNull();
    }
    expect(JSON.stringify(value)).not.toMatch(/confidence|percentage|totalScore|rank/);
  });
  it('uses business date for authorization and real wall time for jobs', async () => {
    const f = matchingFixture(), result = await start(f);
    expect(f.loadEvidence.mock.calls.every((call) => call[1] === '2026-09-04')).toBe(true);
    expect(f.store.state.jobs.get(result.runId)?.updatedAt).toBe('2031-04-05T06:07:08.000Z');
    expect(f.readDemand).toHaveBeenCalledWith('account-hr', 'demand-a', 2);
  });
  it('does not infer event confirmation from scores or pass drafts and AI suggestions', async () => {
    const f = matchingFixture();
    f.facts[0]!.state = 'draft'; f.facts[1]!.active = false;
    f.records.find((r) => r.id === 'event-demo-c')!.kind = 'ai-inference';
    const result = await start(f); await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(value.candidates.slice(0, 3).every((c) => c.requirements[0]?.progress === 'awaiting_manual' && c.requirements[0]?.aiJudgment === null)).toBe(true);
    expect(f.decide).toHaveBeenCalledTimes(1);
  });
  it('allows empty situation but requires behavior and rejects mixed unauthorized fragments', async () => {
    const f = matchingFixture();
    f.records.find((r) => r.id === 'event-demo-b')!.fields.find((field) => field.name === 'behavior')!.value = '';
    f.rawSources[0]!.subjects.push({ personId: 'hidden', cohortId: 'cohort-b' });
    const result = await start(f); await f.service.execute(result.runId, 1);
    const value = await page(f, result.runId);
    expect(value.candidates[0]?.requirements[0]?.aiJudgment).toBeNull();
    expect(value.candidates[1]?.requirements[0]?.aiJudgment).toBeNull();
    expect(f.decide).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.decide.mock.calls)).not.toContain('fragment-demo-a');
  });
  it.each(['timeout', 'invalid_response', 'configuration', 'outcome_unknown'] as const)('keeps %s as awaiting manual with no invented conclusion', async (kind) => {
    const f = matchingFixture(); f.decide.mockRejectedValue(new JevError(kind));
    const result = await start(f); await f.service.execute(result.runId, 1);
    expect((await page(f, result.runId)).candidates.every((c) => c.requirements[0]?.progress === 'awaiting_manual' && c.requirements[0]?.aiJudgment === null)).toBe(true);
    expect(f.store.state.jobs.get(result.runId)?.status).toBe('awaiting_manual');
    expect(f.decide).toHaveBeenCalledTimes(4);
  });
  it('expires old judgments after demand revision changes and makes no further model call', async () => {
    const f = matchingFixture(), result = await start(f); f.demand.revision = 3;
    await f.service.execute(result.runId, 1);
    expect(await f.service.read('account-hr', result.runId)).toMatchObject({ status: 'stale', demandRevision: 2 });
    expect(f.decide).not.toHaveBeenCalled();
    expect(await f.service.judge('account-hr', result.runId, judgment)).toMatchObject({ status: 'conflict', input: judgment });
  });
  it('reauthorizes reads and idempotent replay after revocation', async () => {
    const f = matchingFixture(), result = await start(f); await f.service.execute(result.runId, 1);
    f.context.grants[0]!.revokedAt = '2026-09-03';
    expect(await f.service.read('account-hr', result.runId)).toMatchObject({ status: 'forbidden' });
    expect(await f.service.start('account-hr', input)).toMatchObject({ status: 'forbidden' });
    expect(await f.service.judge('account-hr', result.runId, judgment)).toMatchObject({ status: 'forbidden' });
  });
  it('signs a manual conclusion server-side, preserves AI, and does not overwrite it with a second operation', async () => {
    const f = matchingFixture(), result = await start(f); await f.service.execute(result.runId, 1);
    const saved = staffingJudgmentResultSchema.parse(await f.service.judge('account-hr', result.runId, judgment));
    expect(saved).toMatchObject({ status: 'success', match: { aiJudgment: { conclusion: 'supported' }, humanJudgment: { conclusion: 'not_supported', judgedBy: { id: 'hr', name: '演示·HR' }, judgedAt: '2031-04-05T06:07:08.000Z' } } });
    expect(await f.service.judge('account-hr', result.runId, judgment)).toMatchObject({ status: 'success', replayed: true });
    expect(await f.service.judge('account-hr', result.runId, { ...judgment, operationId: 'other' })).toMatchObject({ status: 'conflict' });
    expect(f.store.state.jobs.get(result.runId)?.status).toBe('completed');
  });
  it('binds human operation explicitly to a run and refuses forged or foreign sources', async () => {
    const f = matchingFixture(), first = await start(f), second = await start(f, 'start-b');
    await f.service.execute(first.runId, 1); await f.service.execute(second.runId, 1);
    expect(await f.service.judge('account-hr', first.runId, { ...judgment, sources: [{ ...judgment.sources[0], fragmentId: 'fragment-demo-b' }] })).toMatchObject({ status: 'conflict' });
    expect(await f.service.judge('account-hr', first.runId, judgment)).toMatchObject({ status: 'success' });
    expect((await page(f, second.runId)).candidates[0]?.requirements[0]?.humanJudgment).toBeNull();
    expect(await f.service.judge('account-hr', second.runId, judgment)).toMatchObject({ status: 'conflict' });
  });
  it('serializes duplicate starts and rolls back the run/job/operation if enqueue fails', async () => {
    const f = matchingFixture();
    const results = await Promise.all([start(f), start(f)]);
    expect(results[0]?.runId).toBe(results[1]?.runId); expect(f.store.state.enqueued).toHaveLength(1);
    expect(await f.service.start('account-hr', { ...input, expectedRevision: 3 })).toMatchObject({ status: 'conflict' });
    f.store.failEnqueue = true;
    await expect(f.service.start('account-hr', { ...input, operationId: 'failed-queue' })).rejects.toThrow('queue unavailable');
    expect(f.store.state.runs.size).toBe(1); expect(f.store.state.operations.size).toBe(1);
  });
  it('does not reissue completed or wrong-attempt deliveries', async () => {
    const f = matchingFixture(), result = await start(f);
    await f.service.execute(result.runId, 2); expect(f.decide).not.toHaveBeenCalled();
    await f.service.execute(result.runId, 1); await f.service.execute(result.runId, 1);
    expect(f.decide).toHaveBeenCalledTimes(4);
  });
});
