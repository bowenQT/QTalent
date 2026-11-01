import { describe, expect, it } from 'vitest';
import { validateCalibrationWrite } from './calibration-write';
import {
  ScoreReviewStoreConflict,
  type CalibrationWrite,
  type ReviewItem,
  type ScoreReviewRepository,
  type ScoreReviewWritePort,
} from './ports';
import { digest, resolveScoreReview } from './service';

const sharedCitation = {
  kind: 'source' as const,
  quote: '合成演示原文',
  reference: {
    fragmentId: 'demo-fragment',
    originalVersionId: 'demo-source-v1',
    location: { kind: 'document' as const, page: 1, paragraph: '1' },
  },
};
const firstCitation = {
  kind: 'input' as const,
  quote: '合成输入',
  start: 0,
  end: 4,
};
const secondCitation = {
  ...sharedCitation,
  reference: {
    ...sharedCitation.reference,
    fragmentId: 'demo-second-fragment',
  },
};

/** Capture the production service's plan through an explicit port double.
 * This does not model PostgreSQL CAS, current authorization, or source truth. */
async function serviceWrite(
  kind: ReviewItem['kind'] = 'rater_gap',
  keepScore = false,
): Promise<CalibrationWrite> {
  const anchor = (value: number) => ({
    id: `demo-anchor-${value}`,
    text: '演示行为锚点',
    ruleVersion: 'demo-rule-v1',
  });
  const human = {
    value: 4,
    anchor: anchor(4),
    citations: [sharedCitation, firstCitation],
    raterId: 'demo-rater-a',
    confirmedAt: '2026-10-31T18:00:00.000Z',
    reason: '',
  };
  const other = {
    value: 1,
    anchor: anchor(1),
    citations: [
      // The same citation with a different property insertion order.
      {
        reference: sharedCitation.reference,
        quote: sharedCitation.quote,
        kind: sharedCitation.kind,
      },
      secondCitation,
    ],
  };
  const base = {
    id: 'demo-review',
    revision: 7,
    eventId: 'demo-event',
    personId: 'demo-person',
    dimensionId: 'demo-dimension',
  };
  const original: ReviewItem =
    kind === 'rater_gap'
      ? {
          ...base,
          kind,
          sides: [
            human,
            {
              ...other,
              raterId: 'demo-rater-b',
              confirmedAt: human.confirmedAt,
              reason: '演示理由',
            },
          ],
        }
      : { ...base, kind, human, ai: other };
  const target: CalibrationWrite['target'] = {
    itemId: original.id,
    eventId: original.eventId,
    personId: original.personId,
    evaluationNodeId: 'demo-node',
    dimensionId: original.dimensionId,
    ruleVersion: 'demo-rule-v1',
    revision: original.revision,
    status: 'open',
  };
  let captured: CalibrationWrite | undefined;
  const port: ScoreReviewWritePort = {
    currentAuthority: async () => ({
      accountId: 'demo-account',
      personId: 'demo-hr',
      isSystemAdmin: false,
      hasHrRole: true,
    }),
    listOpenTargets: async () => [target],
    target: async () => target,
    canReview: async () => true,
    authorizedItem: async () => original,
    lockOperation: async () => {},
    lockEvent: async () => {},
    operation: async () => null,
    calibration: async () => null,
    anchor: async (_target, value) => ({
      ...anchor(value),
      value,
      dimensionId: target.dimensionId,
    }),
    applyCalibration: async (write) => {
      captured = write;
    },
  };
  const repository: ScoreReviewRepository = {
    read: (work) => work(port),
    transaction: (work) => work(port),
  };
  const common = {
    itemId: original.id,
    expected_revision: original.revision,
    operation_id: 'demo-operation',
    reason: '  演示复核理由  ',
  };
  const result = await resolveScoreReview(
    repository,
    'demo-account',
    keepScore
      ? { ...common, action: 'keep_score', kind: 'ai_gap' }
      : { ...common, action: 'calibrate', kind, value: 3 },
    () => new Date('2026-11-01T12:00:00.000Z'),
  );
  expect(result.status).toBe('success');
  if (!captured) throw new Error('Expected a production service write plan');
  return captured;
}

function expectConflict(input: unknown) {
  let failure: unknown;
  try {
    validateCalibrationWrite(input);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ScoreReviewStoreConflict);
  expect(failure).toMatchObject({
    name: 'ScoreReviewStoreConflict',
    message: '评分复核状态已变化',
  });
  expect(failure).not.toHaveProperty('cause');
  expect(failure).not.toHaveProperty('issues');
  expect(JSON.stringify(failure)).not.toContain('合成演示原文');
}

describe('validateCalibrationWrite', () => {
  it.each(['rater_gap', 'ai_gap'] as const)(
    'accepts the real service %s plan and preserves both originals without mutating input',
    async (kind) => {
      const write = await serviceWrite(kind);
      const before = structuredClone(write);
      const validated = validateCalibrationWrite(write);
      expect(validated).toEqual(before);
      expect(write).toEqual(before);
      expect(validated).not.toBe(write);
      expect(validated.result.original).not.toBe(write.result.original);
      expect(validated.result.score.citations).toEqual([
        sharedCitation,
        firstCitation,
        secondCitation,
      ]);
      expect(validated.result.score.anchor.id).toBe('demo-anchor-3');
      expect(validated.result.score.reason).toBe('演示复核理由');
    },
  );

  it('accepts keep_score without guessing action semantics from the result', async () => {
    const write = await serviceWrite('ai_gap', true);
    expect(validateCalibrationWrite(write).result.score.value).toBe(4);
    write.fingerprint = '0'.repeat(64);
    expect(validateCalibrationWrite(write).fingerprint).toBe(write.fingerprint);
  });

  it('compares citation union membership, not output ordering or quote text alone', async () => {
    const write = await serviceWrite();
    write.result.score.citations.reverse();
    expect(validateCalibrationWrite(write).result.score.citations).toEqual([
      secondCitation,
      firstCitation,
      sharedCitation,
    ]);
  });

  it.each([undefined, null, 1, '合成演示原文', [], {}])(
    'fails malformed envelope safely: %j',
    (input) => {
      expectConflict(input);
    },
  );

  it.each(['accountId', 'operationId', 'actorPersonId'] as const)(
    'requires nonempty %s',
    async (key) => {
      const write = await serviceWrite();
      write[key] = '   ';
      expectConflict(write);
    },
  );

  it.each(['fingerprint', 'scopeFingerprint', 'originalFingerprint'] as const)(
    'requires a canonical sha256 shape for %s',
    async (key) => {
      for (const invalid of [
        '',
        'a'.repeat(63),
        'a'.repeat(65),
        'g'.repeat(64),
        'A'.repeat(64),
        ' '.repeat(64),
      ]) {
        const write = await serviceWrite();
        write[key] = invalid;
        expectConflict(write);
      }
    },
  );

  it.each(['resolved', 'withdrawn'] as const)(
    'rejects a %s target',
    async (status) => {
      const write = await serviceWrite();
      write.target.status = status;
      expectConflict(write);
    },
  );

  it.each([
    'itemId',
    'eventId',
    'personId',
    'evaluationNodeId',
    'dimensionId',
    'ruleVersion',
  ] as const)('binds the scope digest to target %s', async (key) => {
    const write = await serviceWrite();
    write.target[key] += '-changed';
    expectConflict(write);
  });

  it.each(['scopeFingerprint', 'originalFingerprint'] as const)(
    'rejects a well-shaped but stale %s',
    async (key) => {
      const write = await serviceWrite();
      write[key] = '0'.repeat(64);
      expectConflict(write);
    },
  );

  it.each(['id', 'eventId', 'personId', 'dimensionId'] as const)(
    'binds original %s to target even with a recomputed original digest',
    async (key) => {
      const write = await serviceWrite();
      write.result.original[key] += '-changed';
      write.originalFingerprint = digest(write.result.original);
      expectConflict(write);
    },
  );

  it.each([
    [
      'receipt item',
      (write: CalibrationWrite) => {
        write.result.itemId = 'other-item';
      },
    ],
    [
      'original revision',
      (write: CalibrationWrite) => {
        write.result.original.revision++;
        write.originalFingerprint = digest(write.result.original);
      },
    ],
    [
      'unchanged result revision',
      (write: CalibrationWrite) => {
        write.result.revision = write.target.revision;
      },
    ],
    [
      'skipped result revision',
      (write: CalibrationWrite) => {
        write.result.revision = write.target.revision + 2;
      },
    ],
    [
      'actor',
      (write: CalibrationWrite) => {
        write.result.score.raterId = 'other-actor';
      },
    ],
    [
      'empty reason',
      (write: CalibrationWrite) => {
        write.result.score.reason = '';
      },
    ],
    [
      'whitespace reason',
      (write: CalibrationWrite) => {
        write.result.score.reason = ' \n\t ';
      },
    ],
    [
      'new-rule anchor',
      (write: CalibrationWrite) => {
        write.result.score.anchor.ruleVersion = 'new-rule';
      },
    ],
    [
      'empty anchor',
      (write: CalibrationWrite) => {
        write.result.score.anchor.id = ' ';
      },
    ],
    [
      'empty anchor text',
      (write: CalibrationWrite) => {
        write.result.score.anchor.text = ' ';
      },
    ],
    [
      'invalid score',
      (write: CalibrationWrite) => {
        write.result.score.value = 6;
      },
    ],
    [
      'invalid timestamp',
      (write: CalibrationWrite) => {
        write.result.score.confirmedAt = 'yesterday';
      },
    ],
    [
      'invalid target revision',
      (write: CalibrationWrite) => {
        write.target.revision = 0;
      },
    ],
  ] as const)('rejects inconsistent %s', async (_label, mutate) => {
    const write = await serviceWrite();
    mutate(write);
    expectConflict(write);
  });

  it.each(['rater_gap', 'ai_gap'] as const)(
    'checks the original rule version on both %s sides',
    async (kind) => {
      for (const index of [0, 1]) {
        const write = await serviceWrite(kind);
        const original = write.result.original;
        const sides =
          original.kind === 'rater_gap'
            ? original.sides
            : [original.human, original.ai];
        sides[index].anchor.ruleVersion = 'other-rule';
        write.originalFingerprint = digest(original);
        expectConflict(write);
      }
    },
  );

  it.each(['rater_gap', 'ai_gap'] as const)(
    'rejects lost, extra, duplicate and altered citations for %s',
    async (kind) => {
      const plan = await serviceWrite(kind);
      for (const citations of [
        [sharedCitation, firstCitation],
        [sharedCitation, secondCitation],
        [
          ...plan.result.score.citations,
          { ...firstCitation, quote: '额外合成引用' },
        ],
        [sharedCitation, firstCitation, firstCitation],
        [...plan.result.score.citations, sharedCitation],
        [
          sharedCitation,
          firstCitation,
          {
            ...secondCitation,
            reference: {
              ...secondCitation.reference,
              originalVersionId: 'other-version',
            },
          },
        ],
      ]) {
        const write = structuredClone(plan);
        write.result.score.citations = citations;
        expectConflict(write);
      }
    },
  );

  it('rejects changed original content when its digest is stale', async () => {
    const write = await serviceWrite('ai_gap');
    if (write.result.original.kind !== 'ai_gap')
      throw new Error('Expected ai_gap');
    write.result.original.ai.anchor.text = '另一合成锚点';
    expectConflict(write);
  });

  it('reuses original schema restrictions instead of inventing a third review kind', async () => {
    const write = await serviceWrite('ai_gap');
    if (write.result.original.kind !== 'ai_gap')
      throw new Error('Expected ai_gap');
    write.result.original.human.reason = '已有人工评分理由';
    write.originalFingerprint = digest(write.result.original);
    expectConflict(write);
    expectConflict({
      ...write,
      result: {
        ...write.result,
        original: { kind: 'recalibration', status: 'not_connected' },
      },
    });
  });

  it('rejects unknown fields at the envelope, target and public result boundaries', async () => {
    const write = await serviceWrite();
    expectConflict({ ...write, sourceTruth: true });
    expectConflict({ ...write, target: { ...write.target, authorized: true } });
    expectConflict({
      ...write,
      result: { ...write.result, profileVersion: 'forged' },
    });
  });

  it('sanitizes unexpected input access failures without retaining their cause', () => {
    const input = Object.defineProperty({}, 'accountId', {
      enumerable: true,
      get() {
        throw new Error('合成演示原文');
      },
    });
    expectConflict(input);
  });
});
