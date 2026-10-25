import { expect, it } from 'vitest';
import { z } from 'zod';
import { matchingFixture } from '../../../../../tests/fixtures/staffing-matching';
import { matchRunSchema, matchOperationSchema } from './storage';

async function run() {
  const f = matchingFixture();
  const { runId } = z.object({ runId: z.string() }).parse(
    await f.service.start('account-hr', {
      operationId: 'start',
      demandId: 'demand-a',
      expectedRevision: 2,
    }),
  );
  return f.store.state.runs.get(runId)!;
}
it('validates persisted identity, exact requirement coverage and per-person evidence', async () => {
  const value = await run();
  expect(matchRunSchema.safeParse(value).success).toBe(true);
  const unknownVersion = structuredClone(value);
  unknownVersion.inputFormatVersion = 'unknown';
  expect(matchRunSchema.safeParse(unknownVersion).success).toBe(false);
  const wrongRequirement = structuredClone(value);
  wrongRequirement.candidates[0]!.cells[0]!.match.requirementId = 'unknown';
  expect(matchRunSchema.safeParse(wrongRequirement).success).toBe(false);
  const duplicate = structuredClone(value);
  duplicate.candidates.push(duplicate.candidates[0]!);
  expect(matchRunSchema.safeParse(duplicate).success).toBe(false);
  const wrongPerson = structuredClone(value);
  wrongPerson.candidates[0]!.evidence[0]!.personId = 'another';
  expect(matchRunSchema.safeParse(wrongPerson).success).toBe(false);
  const wrongDemand = structuredClone(value);
  wrongDemand.demand.requirements[0]!.text = 'changed';
  expect(matchRunSchema.safeParse(wrongDemand).success).toBe(false);
});
it('requires a claim for judging and keeps blank failures separate from four-state conclusions', async () => {
  const value = await run(),
    cell = value.candidates[0]!.cells[0]!;
  cell.match.progress = 'judging';
  expect(matchRunSchema.safeParse(value).success).toBe(false);
  cell.claim = 'claim-a';
  expect(matchRunSchema.safeParse(value).success).toBe(true);
  cell.match.progress = 'awaiting_manual';
  expect(matchRunSchema.safeParse(value).success).toBe(false);
  cell.claim = null;
  cell.error = 'jev_failed';
  expect(matchRunSchema.safeParse(value).success).toBe(true);
  expect(
    matchOperationSchema.safeParse({
      fingerprint: 'request',
      runId: value.id,
      judgment: { status: 'success', confidence: 0.9 },
    }).success,
  ).toBe(false);
});
