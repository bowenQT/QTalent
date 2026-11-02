import { describe, it, expect } from 'vitest';
import {
  createObservationInputSchema,
  managementObservationSchema,
  observationFingerprint,
  observationWhenSchema,
} from './model';
import { manual, imported, observation, reference } from './__tests__/fixtures';
describe('independent observation input and attribution', () => {
  it('accepts a view without SBI, keeps date precision and literal zero-like text', () => {
    expect(
      createObservationInputSchema.parse({ ...manual(), text: '0' }).text,
    ).toBe('0');
    expect(observationWhenSchema.parse('2026-10-01')).toBe('2026-10-01');
    expect(observationWhenSchema.parse('2026-10-01T17:30:00+08:00')).toBe(
      '2026-10-01T17:30:00+08:00',
    );
  });
  it.each([
    {},
    { ...manual(), text: ' ' },
    { ...manual(), author: { personId: 'guessed' } },
    { ...manual(), score: 5 },
    { ...manual(), situation: 'fake' },
    { ...manual(), occurredAt: '2026-02-30' },
    { ...manual(), sources: [reference, reference] },
    { ...imported(), sources: [] },
  ])('rejects malformed or forged structured input %#', (input) =>
    expect(createObservationInputSchema.safeParse(input).success).toBe(false),
  );
  it('canonicalizes source set order but never erases meaningful content or original versions', () => {
    const input = {
      ...manual(),
      sources: [
        reference,
        { fragmentId: 'demo-second', originalVersionId: 'v2' },
      ],
    };
    expect(observationFingerprint(input)).toBe(
      observationFingerprint({
        ...input,
        sources: [...input.sources].reverse(),
      }),
    );
    expect(observationFingerprint(input)).not.toBe(
      observationFingerprint({ ...input, text: input.text + ' ' }),
    );
    expect(observationFingerprint(input)).not.toBe(
      observationFingerprint({
        ...input,
        sources: [{ ...reference, originalVersionId: 'changed' }],
      }),
    );
  });
  it('rejects a forged human-confirmation flag or importer pretending to be author', () => {
    const row = observation();
    expect(
      managementObservationSchema.safeParse({ ...row, authorUnconfirmed: true })
        .success,
    ).toBe(false);
    expect(
      managementObservationSchema.safeParse({
        ...row,
        origin: 'interview_import',
        importedBy: {
          accountId: row.recordedByAccountId,
          personId: 'demo-hr',
          name: '演示HR',
        },
        attributionId: 'demo-a',
        sources: [reference],
        authorUnconfirmed: false,
      }).success,
    ).toBe(false);
  });
});
