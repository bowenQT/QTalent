import { describe, expect, it } from 'vitest';
import { deriveReferencePosition, type PositionScore } from './derive';
const score = (
  eventId: string,
  dimensionId: string,
  value: number,
  axis: 'prof' | 'pot' = 'pot',
  core = true,
  occurredOn = '2026-06-01',
): PositionScore => ({
  eventId,
  dimensionId,
  value,
  axis,
  core,
  occurredOn,
  ruleVersionId: 'rubric-v1',
});
const ready = [
  score('a', 'prof', 3, 'prof'),
  score('b', 'prof', 4, 'prof'),
  score('a', 'mot', 4),
  score('b', 'grit', 3),
];
const derive = (scores: PositionScore[]) =>
  deriveReferencePosition(scores, '2026-07-01');
describe('reference position from authorized confirmations', () => {
  it('requires distinct events and two potential core dimensions', () => {
    expect(derive([]).status).toBe('insufficient_evidence');
    const sameEvent = ready.map((s) => ({ ...s, eventId: 'one' }));
    expect(derive(sameEvent).status).toBe('insufficient_evidence');
    const oneCore = ready.filter((s) => s.dimensionId !== 'grit');
    expect(derive(oneCore).status).toBe('insufficient_evidence');
  });
  it('averages by dimension and ignores bonus dimensions', () => {
    const bonus = score('c', 'lead', 1, 'pot', false);
    expect(derive([...ready, bonus])).toEqual({
      status: 'ready',
      data: {
        kind: 'reference',
        bonus: false,
        quadrant: 'high_professional_high_potential',
      },
    });
    const extras = [score('c', 'mot', 4), score('d', 'mot', 4)];
    expect(derive([...ready, ...extras])).toEqual(derive(ready));
  });
  it('sets the bonus flag from extra items without moving the quadrant', () => {
    const quadrant = (rows: PositionScore[]) =>
      (derive(rows) as { data: { quadrant: string } }).data.quadrant;
    const flagged = [
      score('c', 'lead', 4, 'pot', false),
      score('d', 'open', 5, 'pot', false),
    ];
    expect(derive([...ready, ...flagged])).toHaveProperty('data.bonus', true);
    expect(quadrant([...ready, ...flagged])).toBe(quadrant(ready));
    expect(
      derive([...ready, score('c', 'lead', 3, 'pot', false)]),
    ).toHaveProperty('data.bonus', false);
    expect(derive(ready)).toHaveProperty('data.bonus', false);
  });
  it('uses a 12-month inclusive window and excludes future events', () => {
    const withDate = (occurredOn: string) =>
      ready.map((s) => ({ ...s, occurredOn }));
    expect(derive(withDate('2025-07-01')).status).toBe('ready');
    for (const date of ['2025-06-30', '2026-07-02'])
      expect(derive(withDate(date)).status).toBe('insufficient_evidence');
  });
  it('returns four categories without exact axes or a total', () => {
    for (const prof of [2, 4])
      for (const pot of [2, 4]) {
        const rows = ready.map((s) => ({
          ...s,
          value: s.axis === 'prof' ? prof : pot,
        }));
        const x = prof >= 3.5 ? 'high' : 'low';
        const y = pot >= 3.5 ? 'high' : 'low';
        expect(derive(rows)).toEqual({
          status: 'ready',
          data: {
            kind: 'reference',
            bonus: false,
            quadrant: `${x}_professional_${y}_potential`,
          },
        });
      }
  });
  it('checks compatibility only inside the placement window', () => {
    const unknown = {
      ...score('c', 'mot', 4),
      ruleVersionId: 'future-rule',
    };
    expect(derive([...ready, unknown]).status).toBe('unknown');
    const bonus = {
      ...score('c', 'lead', 1, 'pot', false),
      ruleVersionId: 'future-rule',
    };
    expect(derive([...ready, bonus])).toEqual(derive(ready));
    for (const occurredOn of ['2025-06-01', '2026-07-02']) {
      const outside = { ...unknown, occurredOn };
      expect(derive([...ready, outside])).toEqual(derive(ready));
    }
  });
});
