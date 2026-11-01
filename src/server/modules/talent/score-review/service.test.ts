import { describe, expect, it } from 'vitest';
import { reviewQueueResultSchema } from '../../../../contracts/review-queue';
import { readScoreReviewQueueForCurrentUser } from '../../../queries/score-review';
import { resolveScoreReviewRequest } from './request';
import {
  readScoreReviewQueue,
  resolveScoreReview,
  scoreReviewFingerprint,
} from './service';
import {
  ScoreReviewForbiddenError,
  ScoreReviewStoreConflict,
  type Calibration,
  type ReviewAuthority,
  type ReviewItem,
  type ReviewOperation,
  type ReviewTarget,
  type ScoreReviewReadPort,
  type ScoreReviewRepository,
  type ScoreReviewWritePort,
} from './ports';

const now = () => new Date('2026-10-31T18:00:00.000Z');
function item(
  id = 'review-1',
  kind: ReviewItem['kind'] = 'rater_gap',
): ReviewItem {
  const score = (value: number) => ({
    value,
    anchor: {
      id: `demo-anchor-${value}`,
      text: '演示行为锚点',
      ruleVersion: 'demo-rule-v1',
    },
    citations: [
      {
        kind: 'source' as const,
        quote: '合成演示行为',
        reference: {
          fragmentId: 'demo-fragment',
          originalVersionId: 'demo-original-v1',
          location: { kind: 'document' as const, page: 1, paragraph: '1' },
        },
      },
    ],
  });
  const human = {
    ...score(4),
    raterId: 'demo-mentor-a',
    confirmedAt: '2026-10-30T18:00:00.000Z',
    reason: '',
  };
  const base = {
    id,
    revision: 1,
    eventId: 'demo-event-' + id,
    personId: 'demo-person-' + id,
    dimensionId: 'demo-dimension',
  };
  return kind === 'ai_gap'
    ? { ...base, kind, human, ai: score(1) }
    : {
        ...base,
        kind,
        sides: [
          human,
          {
            ...score(1),
            raterId: 'demo-mentor-b',
            confirmedAt: human.confirmedAt,
            reason: '合成演示理由',
          },
        ],
      };
}
const action = (itemId = 'review-1', operation_id = 'operation-1') => ({
  action: 'calibrate' as const,
  kind: 'rater_gap' as const,
  itemId,
  operation_id,
  expected_revision: 1,
  value: 3,
  reason: '  合成证据支持这一锚点  ',
});
type State = {
  targets: ReviewTarget[];
  items: Record<string, ReviewItem>;
  calibrations: Record<string, Calibration>;
  operations: Record<string, ReviewOperation>;
  projections: Record<string, Calibration['score']>;
  todos: string[];
  audits: string[];
  profileVersions: string[];
  frozenPosition: string;
};

/** Test-only serialized, rollback-capable port double. NOT a PostgreSQL adapter. */
class MemoryRepository implements ScoreReviewRepository {
  state: State;
  authority: ReviewAuthority | null = {
    accountId: 'hr-a',
    personId: 'demo-hr-a',
    isSystemAdmin: false,
    hasHrRole: true,
  };
  allowedNodes = new Set(['demo-node']);
  allowedPeople: Set<string>;
  hiddenEvidence = new Set<string>();
  payloadReads: string[] = [];
  calls: string[] = [];
  afterEventLock?: (state: State) => void;
  failure?:
    'after_projection' | 'after_closure' | 'after_receipt' | 'store_conflict';
  private tail: Promise<unknown> = Promise.resolve();
  constructor(items = [item(), item('review-ai', 'ai_gap')]) {
    this.state = {
      targets: items.map((value) => ({
        itemId: value.id,
        eventId: value.eventId,
        personId: value.personId,
        evaluationNodeId: 'demo-node',
        dimensionId: value.dimensionId,
        ruleVersion: 'demo-rule-v1',
        revision: 1,
        status: 'open',
      })),
      items: Object.fromEntries(items.map((value) => [value.id, value])),
      calibrations: {},
      operations: {},
      projections: {},
      todos: items.map((value) => value.id),
      audits: [],
      profileVersions: ['frozen-profile-v1'],
      frozenPosition: 'unchanged-frozen-position',
    };
    this.allowedPeople = new Set(items.map((value) => value.personId));
  }
  key(accountId: string, operationId: string) {
    return JSON.stringify([accountId, operationId]);
  }
  port(state: State): ScoreReviewWritePort {
    return {
      currentAuthority: async (account) => {
        this.calls.push('authority');
        return this.authority?.accountId === account
          ? structuredClone(this.authority)
          : null;
      },
      listOpenTargets: async () => state.targets,
      target: async (id) =>
        structuredClone(
          state.targets.find((value) => value.itemId === id) ?? null,
        ),
      canReview: async (_authority, target) =>
        this.allowedNodes.has(target.evaluationNodeId) &&
        this.allowedPeople.has(target.personId),
      authorizedItem: async (_authority, target) => {
        this.payloadReads.push(target.itemId);
        return this.hiddenEvidence.has(target.itemId)
          ? null
          : structuredClone(state.items[target.itemId]);
      },
      lockOperation: async () => {
        this.calls.push('operation-lock');
      },
      lockEvent: async () => {
        this.calls.push('event-lock');
        this.afterEventLock?.(state);
      },
      operation: async (account, operationId) =>
        structuredClone(
          state.operations[this.key(account, operationId)] ?? null,
        ),
      calibration: async (id) =>
        structuredClone(state.calibrations[id] ?? null),
      anchor: async (target, value) => ({
        id: `demo-anchor-${value}`,
        text: '演示行为锚点',
        ruleVersion: target.ruleVersion,
        dimensionId: target.dimensionId,
        value,
      }),
      applyCalibration: async (write) => {
        if (this.failure === 'store_conflict')
          throw new ScoreReviewStoreConflict();
        state.calibrations[write.target.itemId] = structuredClone(write.result);
        state.projections[write.target.itemId] = structuredClone(
          write.result.score,
        );
        if (this.failure === 'after_projection')
          throw new Error('synthetic storage failure');
        const target = state.targets.find(
          (value) => value.itemId === write.target.itemId,
        )!;
        target.status = 'resolved';
        target.revision = write.result.revision;
        state.todos = state.todos.filter((id) => id !== target.itemId);
        if (this.failure === 'after_closure')
          throw new Error('synthetic storage failure');
        state.operations[this.key(write.accountId, write.operationId)] =
          structuredClone(write);
        state.audits.push(write.actorPersonId);
        if (this.failure === 'after_receipt')
          throw new Error('synthetic storage failure');
      },
    };
  }
  async read<T>(work: (port: ScoreReviewReadPort) => Promise<T>): Promise<T> {
    return work(this.port(this.state));
  }
  transaction<T>(work: (port: ScoreReviewWritePort) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const result = await work(this.port(draft));
      this.state = draft;
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
const resolve = (db: MemoryRepository, input: unknown = action()) =>
  resolveScoreReview(db, 'hr-a', input, now);
function success(result: Awaited<ReturnType<typeof resolveScoreReview>>) {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error('Expected success');
  return result;
}

describe('HR score review use cases on explicit adapter ports', () => {
  it('reads both existing kinds, preserves sides, and leaves formal-position recalibration unconnected', async () => {
    const db = new MemoryRepository();
    const result = await readScoreReviewQueue(db, 'hr-a');
    expect(result.items).toEqual(Object.values(db.state.items));
    expect(result.recalibration).toEqual({
      kind: 'recalibration',
      status: 'not_connected',
    });
    expect(db.state.calibrations).toEqual({});
  });
  it.each([
    'no-session',
    'manager',
    'mentor',
    'system-admin',
    'mixed-admin-hr',
  ])('denies queue and writes for %s', async (role) => {
    const db = new MemoryRepository();
    if (role === 'no-session') db.authority = null;
    else
      db.authority = {
        accountId: 'hr-a',
        personId: 'demo-person',
        hasHrRole: role === 'mixed-admin-hr',
        isSystemAdmin: role.includes('admin'),
      };
    await expect(readScoreReviewQueue(db, 'hr-a')).rejects.toBeInstanceOf(
      ScoreReviewForbiddenError,
    );
    expect(await resolve(db)).toEqual({
      status: 'forbidden',
      message: '当前账号无权处理评分复核',
    });
    expect(db.payloadReads).toEqual([]);
    expect(db.state.calibrations).toEqual({});
  });
  it('filters node AND person scope before hydrating payloads or exposing hidden counts', async () => {
    const db = new MemoryRepository([
      item(),
      item('other-node'),
      item('other-person'),
    ]);
    db.state.targets[1].evaluationNodeId = 'denied-node';
    db.allowedPeople.delete(db.state.targets[2].personId);
    const result = await readScoreReviewQueue(db, 'hr-a');
    expect(result.items.map((value) => value.id)).toEqual(['review-1']);
    expect(db.payloadReads).toEqual(['review-1']);
    expect(JSON.stringify(result)).not.toContain('other-node');
    expect(await resolve(db, action('other-node'))).toEqual(
      await resolve(db, action('missing')),
    );
    expect(db.payloadReads).toEqual(['review-1']);
  });
  it('excludes resolved, duplicate and unreadable-evidence items without inventing a formal-position count', async () => {
    const db = new MemoryRepository();
    db.hiddenEvidence.add('review-1');
    db.state.targets[1].status = 'resolved';
    db.state.targets.push(structuredClone(db.state.targets[0]));
    expect(await readScoreReviewQueue(db, 'hr-a')).toEqual({
      items: [],
      recalibration: { kind: 'recalibration', status: 'not_connected' },
    });
    expect(db.payloadReads).toEqual(['review-1']);
    expect((await resolve(db)).status).toBe('not_found');
  });
  it.each(['', '   '])(
    'requires a real calibration reason: %j',
    async (reason) => {
      const db = new MemoryRepository();
      const result = await resolve(db, { ...action(), reason });
      expect(result).toMatchObject({
        status: 'validation_error',
        fieldErrors: { reason: ['请填写复核理由'] },
      });
      expect(db.calls).toEqual([]);
    },
  );
  it.each([
    { value: 0 },
    { value: 6 },
    { expected_revision: 0 },
    { raterId: 'forged-person' },
    { confirmedAt: '2026-01-01T00:00:00Z' },
    { kind: 'recalibration' },
    { action: 'keep_score', kind: 'rater_gap', value: undefined },
  ])(
    'rejects invalid scores, forged server fields and unsupported recalibration: %j',
    async (patch) => {
      const db = new MemoryRepository();
      expect((await resolve(db, { ...action(), ...patch })).status).toBe(
        'validation_error',
      );
      expect(db.calls).toEqual([]);
    },
  );
  it('creates a new signed HR calibration, preserves both originals, updates projection and closes one queue/todo', async () => {
    const db = new MemoryRepository();
    const original = structuredClone(db.state.items['review-1']);
    const result = success(await resolve(db));
    expect(result.replayed).toBe(false);
    expect(reviewQueueResultSchema.safeParse(result).success).toBe(true);
    expect(result.result).toMatchObject({
      itemId: 'review-1',
      revision: 2,
      original,
      score: {
        value: 3,
        raterId: 'demo-hr-a',
        confirmedAt: now().toISOString(),
        reason: action().reason.trim(),
        anchor: { ruleVersion: 'demo-rule-v1', id: 'demo-anchor-3' },
      },
    });
    expect(result.result.score.citations).toHaveLength(1);
    expect(db.state.items['review-1']).toEqual(original);
    expect(db.state.projections['review-1']).toEqual(result.result.score);
    expect(db.state.todos).toEqual(['review-ai']);
    expect(
      (await readScoreReviewQueue(db, 'hr-a')).items.map((value) => value.id),
    ).toEqual(['review-ai']);
    expect(db.state.profileVersions).toEqual(['frozen-profile-v1']);
    expect(db.state.frozenPosition).toBe('unchanged-frozen-position');
    expect(db.calls.slice(0, 4)).toEqual([
      'operation-lock',
      'authority',
      'event-lock',
      'authority',
    ]);
  });
  it('keeps the human score on ai_gap with a new HR reason without attributing the AI suggestion to a human', async () => {
    const db = new MemoryRepository();
    const result = success(
      await resolve(db, {
        action: 'keep_score',
        kind: 'ai_gap',
        itemId: 'review-ai',
        operation_id: 'keep',
        expected_revision: 1,
        reason: '合成证据支持原分',
      }),
    );
    expect(result.result.score).toMatchObject({
      value: 4,
      raterId: 'demo-hr-a',
      reason: '合成证据支持原分',
    });
    expect(result.result.original).toMatchObject({
      kind: 'ai_gap',
      human: { raterId: 'demo-mentor-a' },
      ai: { value: 1 },
    });
    if (result.result.original.kind === 'ai_gap')
      expect(result.result.original.ai).not.toHaveProperty('raterId');
  });
  it('calibrates ai_gap to a selected value under the original rule version', async () => {
    const db = new MemoryRepository();
    expect(
      success(await resolve(db, { ...action('review-ai'), kind: 'ai_gap' }))
        .result.score.value,
    ).toBe(3);
  });
  it('replays a normalized same operation after resolution without a second calibration/audit', async () => {
    const db = new MemoryRepository();
    const first = success(await resolve(db));
    const replay = success(
      await resolve(db, { ...action(), reason: action().reason.trim() }),
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(db.state.audits).toEqual(['demo-hr-a']);
  });
  it.each([{ value: 2 }, { reason: '另一种理由' }, { expected_revision: 2 }])(
    'same operation with different semantics conflicts and preserves input: %j',
    async (patch) => {
      const db = new MemoryRepository();
      await resolve(db);
      const input = { ...action(), ...patch };
      expect(await resolve(db, input)).toMatchObject({
        status: 'conflict',
        input: { ...input, reason: input.reason.trim() },
      });
      expect(db.state.audits).toHaveLength(1);
    },
  );
  it('does not treat a different operation as another opportunity to calibrate the same item', async () => {
    const db = new MemoryRepository();
    await resolve(db);
    expect((await resolve(db, action('review-1', 'operation-2'))).status).toBe(
      'conflict',
    );
    expect(Object.keys(db.state.operations)).toHaveLength(1);
  });
  it('same-key concurrent requests through the serialized port double produce one write and a replay', async () => {
    const db = new MemoryRepository();
    const results = await Promise.all([resolve(db), resolve(db)]);
    expect(results.map((result) => success(result).replayed)).toEqual([
      false,
      true,
    ]);
    expect(db.state.audits).toHaveLength(1);
  });
  it('different-key concurrent requests through the port double cannot both resolve an item', async () => {
    const db = new MemoryRepository();
    const results = await Promise.all([
      resolve(db),
      resolve(db, action('review-1', 'other')),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'success',
      'conflict',
    ]);
    expect(db.state.audits).toHaveLength(1);
  });
  it('checks current authority after waiting for the event lock and before replay', async () => {
    const db = new MemoryRepository();
    await resolve(db);
    db.afterEventLock = () => {
      db.authority = null;
    };
    expect((await resolve(db)).status).toBe('forbidden');
    expect(db.state.audits).toHaveLength(1);
  });
  it('revoked node or source permission cannot disclose a stored replay', async () => {
    const db = new MemoryRepository();
    await resolve(db);
    db.allowedNodes.clear();
    expect((await resolve(db)).status).toBe('not_found');
    db.allowedNodes.add('demo-node');
    db.hiddenEvidence.add('review-1');
    expect((await resolve(db)).status).toBe('not_found');
  });
  it('rejects an old revision, changed kind, withdrawn item, or existing business calibration', async () => {
    for (const variant of ['revision', 'kind', 'withdrawn', 'calibration']) {
      const db = new MemoryRepository();
      let input: unknown = action();
      if (variant === 'revision') input = { ...action(), expected_revision: 2 };
      if (variant === 'kind') input = { ...action(), kind: 'ai_gap' };
      if (variant === 'withdrawn') db.state.targets[0].status = 'withdrawn';
      if (variant === 'calibration') {
        db.state.calibrations['review-1'] = success(
          await resolve(new MemoryRepository()),
        ).result;
      }
      expect((await resolve(db, input)).status).toBe('conflict');
      expect(db.state.audits).toEqual([]);
    }
  });
  it('does not apply under a changed target binding, or replay after evidence changes', async () => {
    const db = new MemoryRepository();
    db.afterEventLock = (state) => {
      state.targets[0].eventId = 'moved-event';
    };
    expect((await resolve(db)).status).toBe('conflict');
    const second = new MemoryRepository();
    await resolve(second);
    const raw = second.state.items['review-1'];
    if (raw.kind === 'rater_gap') raw.sides[0].anchor.text = '变更后的合成锚点';
    expect((await resolve(second)).status).toBe('conflict');
  });
  it.each(['missing', 'wrong-version', 'wrong-dimension', 'wrong-value'])(
    'requires the exact original-version anchor: %s',
    async (variant) => {
      const db = new MemoryRepository();
      const originalPort = db.port.bind(db);
      db.port = (state) => {
        const port = originalPort(state);
        port.anchor = async () =>
          variant === 'missing'
            ? null
            : {
                id: 'anchor',
                text: '合成锚点',
                ruleVersion:
                  variant === 'wrong-version'
                    ? 'newly-published-version'
                    : 'demo-rule-v1',
                dimensionId:
                  variant === 'wrong-dimension'
                    ? 'other-dimension'
                    : 'demo-dimension',
                value: variant === 'wrong-value' ? 5 : 3,
              };
        return port;
      };
      expect((await resolve(db)).status).toBe('conflict');
      expect(db.state.audits).toEqual([]);
    },
  );
  it.each(['after_projection', 'after_closure', 'after_receipt'] as const)(
    'port-double rollback at %s leaves every effect unchanged',
    async (failure) => {
      const db = new MemoryRepository();
      const before = structuredClone(db.state);
      db.failure = failure;
      await expect(resolve(db)).rejects.toThrow('synthetic storage failure');
      expect(db.state).toEqual(before);
      db.failure = undefined;
      expect(success(await resolve(db)).replayed).toBe(false);
    },
  );
  it('maps explicit store compare/unique conflicts but propagates infrastructure failures', async () => {
    const db = new MemoryRepository();
    db.failure = 'store_conflict';
    expect((await resolve(db)).status).toBe('conflict');
    expect(db.state.audits).toEqual([]);
    db.read = async () => {
      throw new Error('synthetic unavailable');
    };
    await expect(readScoreReviewQueue(db, 'hr-a')).rejects.toThrow(
      'synthetic unavailable',
    );
  });
  it('does not silently expose malformed authorized data or a foreign actor receipt', async () => {
    const db = new MemoryRepository();
    db.state.targets[0].personId = 'mismatch';
    db.allowedPeople.add('mismatch');
    await expect(readScoreReviewQueue(db, 'hr-a')).rejects.toThrow(
      '可信来源不一致',
    );
    const other = new MemoryRepository();
    await resolve(other);
    other.state.operations[other.key('hr-a', 'operation-1')].accountId =
      'other-account';
    await expect(resolve(other)).rejects.toThrow('回执归属不一致');
  });
  it('rejects malformed versions and does not silently relabel prior-rule evidence', async () => {
    const db = new MemoryRepository();
    db.state.targets[0].revision = 2;
    await expect(readScoreReviewQueue(db, 'hr-a')).rejects.toThrow(
      '版本不一致',
    );
    db.state.targets[0].revision = 1;
    db.state.targets[0].ruleVersion = 'new-rule';
    await expect(resolve(db)).rejects.toThrow('可信来源不一致');
  });
  it('isolates actor keys and obtains identity only from the server composition seam', async () => {
    const db = new MemoryRepository();
    const ports = { repository: db, now, currentAccountId: async () => 'hr-a' };
    expect(
      (await readScoreReviewQueueForCurrentUser(ports)).items,
    ).toHaveLength(2);
    expect(
      success(await resolveScoreReviewRequest(action(), ports)).result.score
        .raterId,
    ).toBe('demo-hr-a');
    db.authority = {
      accountId: 'hr-b',
      personId: 'demo-hr-b',
      isSystemAdmin: false,
      hasHrRole: true,
    };
    const result = success(
      await resolveScoreReview(
        db,
        'hr-b',
        { ...action('review-ai'), kind: 'ai_gap' },
        now,
      ),
    );
    expect(result.replayed).toBe(false);
    expect(result.result.score.raterId).toBe('demo-hr-b');
    expect(Object.keys(db.state.operations)).toHaveLength(2);
  });
  it('preserves the receiver of the trusted server clock composition port', async () => {
    const db = new MemoryRepository();
    const serverPorts = {
      repository: db,
      serverTime: now(),
      now() {
        return this.serverTime;
      },
      currentAccountId: async () => 'hr-a',
    };
    const result = success(
      await resolveScoreReviewRequest(action(), serverPorts),
    );
    expect(result.result.score.confirmedAt).toBe(
      serverPorts.serverTime.toISOString(),
    );
  });
  it('operation fingerprints are semantic and independent of key/object ordering', () => {
    const first = action();
    expect(scoreReviewFingerprint(first)).toBe(
      scoreReviewFingerprint({ ...first, operation_id: 'another-key' }),
    );
    expect(scoreReviewFingerprint(first)).not.toBe(
      scoreReviewFingerprint({ ...first, value: 5 }),
    );
  });
});
