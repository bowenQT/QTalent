import { describe, expect, it } from 'vitest';
import { mapPrototypeSeed, readPrototypeSeed } from './index';
import { historicalEvaluationRequiredKind } from '../../queries/historical-evaluation-policy';

const seed = () => mapPrototypeSeed(readPrototypeSeed(process.cwd()));
describe('BOW-834 pinned graduation seed access facts', () => {
  it('retains every restricted graduation scale without synthesizing dimension confirmations', () => {
    const mapped = seed();
    const restricted = mapped.raw.EVENTS.filter(
      (row) =>
        row.kind === 'hist' &&
        row.restricted === true &&
        row.histType === '结营评审',
    );
    expect(restricted).toHaveLength(93);
    for (const event of restricted) {
      const history = mapped.evidence.historicalEvaluations.find(
        (row) => row.sourceRecordId === event.id,
      );
      expect(history).toBeDefined();
      expect(history && historicalEvaluationRequiredKind(history)).toBe(
        'performance',
      );
      expect(history).toMatchObject({
        kind: '结营评审',
        sourceCategory: 'prototype_baseline',
      });
      expect(history?.scale).toEqual(event.scale);
      expect(history?.ruleVersionId).toBeNull();
      expect(
        mapped.evidence.confirmations.filter((row) => row.eventId === event.id),
      ).toEqual([]);
    }
  });
  it('retains the ordinary weekly history instead of hiding every legacy evaluation', () => {
    const mapped = seed();
    const weekly = mapped.evidence.historicalEvaluations.filter(
      (row) => row.kind === '训练营周评',
    );
    expect(weekly.length).toBeGreaterThan(0);
    expect(
      weekly.every(
        (row) => historicalEvaluationRequiredKind(row) === 'evaluation',
      ),
    ).toBe(true);
  });
  it('creates only the explicit newcomer/mentor pairs and never blanket cohort assignments', () => {
    const mapped = seed();
    const expected = mapped.raw.BATCHES.filter(
      (row) => row.kind === 'landing',
    ).flatMap((batch) =>
      (batch.newcomers ?? []).flatMap(([studentId, , mentors]) =>
        mentors.map((personId) => [batch.id, personId, studentId].join(':')),
      ),
    );
    expect(
      mapped.assignments
        .map((row) => [row.cohortId, row.personId, row.studentId].join(':'))
        .sort(),
    ).toEqual(expected.sort());
    const mentor = mapped.accounts.find((row) => row.role === 'mentor')!;
    const owned = mapped.assignments.filter(
      (row) => row.personId === mentor.personId,
    );
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.length).toBeLessThan(93);
    // Cohort teaching pairs do not state an evaluation/review node or grant one.
    expect(owned.every((row) => !('evaluationNodeId' in row))).toBe(true);
  });
});
