import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { and, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../../modules/programs';
import {
  ruleVersions,
  standardAttributions,
  attributionHypotheses,
  selectionDraftProposals,
  attributionOperations,
} from '../../modules/evaluation-system';
import { auditEvents } from '../../platform/audit/schema';
import * as audit from '../../platform/audit';
import { dataset } from '../../modules/evaluation-system/judgment-comparison/test-fixtures';
import { createStandardAttributionUsecases } from './hypotheses';
import {
  createAttributionPostgresStore,
  type AttributionTransaction,
} from './postgres';
import type { AttributionModel, AttributionOperation } from './ports';
import type { AttributionReadServices } from './read-adapter';

const databaseName =
  'qtalent_b921_' + randomUUID().replaceAll('-', '') + '_test';
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const db = () => connection!.db;
const ACCOUNT = 'demo-hr-account',
  NOW = '2026-11-01T00:00:00.000Z';
let facts = dataset(),
  clock = NOW;
let afterModel: undefined | (() => Promise<void>);
let modelCalls = 0,
  ids = 0,
  modelFailure = false;
const standard = {
  version: {
    category: 'xe_selection' as const,
    versionId: 'xe-select-v1',
    provenance: 'published' as const,
    effectiveFrom: '2026-01-01T00:00:00Z',
    effectiveUntil: null,
  },
  content: {
    reviewPoints: [
      {
        id: 'demo-point',
        title: '合成要点',
        description: '演示：核对实际作品',
      },
    ],
  },
};
const readers: AttributionReadServices = {
  // Explicit synthetic canonical/918 facts. Permissions, ledger, artifacts and
  // audits below use real PG; this does not claim the 919 production reader.
  async readCanonicalComparisonBatch(_tx, batchId) {
    return batchId === facts.batch.id ? structuredClone(facts) : null;
  },
  async readSelectionStandard(_tx, id) {
    return id === 'xe-select-v1' ? structuredClone(standard) : null;
  },
};
const model: AttributionModel = {
  expectedModel: 'google/gemini-3.8-flash',
  client: {
    async generateStructured(input) {
      modelCalls++;
      await afterModel?.();
      const value = input.promptVersion.includes('hypotheses')
        ? {
            hypotheses: [
              {
                text: '演示假设',
                categories: ['evaluation_standard'],
                citations: [{ caseId: 'case-1', side: 'front' }],
              },
            ],
          }
        : {
            changes: [
              {
                kind: 'add',
                after: {
                  id: 'new-point',
                  title: '演示核验',
                  description: '核对个人交付',
                },
              },
            ],
          };
      const metadata = {
        model: model.expectedModel,
        promptVersion: input.promptVersion,
        requestId: 'demo-request',
      };
      return modelFailure
        ? { ok: false as const, metadata }
        : { ok: true as const, value: input.schema.parse(value), metadata };
    },
  },
};
function make() {
  const ports = createAttributionPostgresStore(db(), readers);
  const app = createStandardAttributionUsecases(ports, model, {
    now: () => new Date(clock),
    newId: () => 'demo-created-' + ++ids,
  });
  return { ports, app };
}
const generate = { operationId: 'generate', batchId: 'batch' };
const confirm = {
  operationId: 'confirm',
  batchId: 'batch',
  hypothesisId: null,
  categories: ['evaluation_standard'],
  rationale: '演示：核对作品与个人表现',
  caseIds: ['case-1'],
};
const counts = async () => ({
  hypotheses: (await db().select().from(attributionHypotheses)).length,
  attributions: (await db().select().from(standardAttributions)).length,
  proposals: (await db().select().from(selectionDraftProposals)).length,
  audits: (await db().select().from(auditEvents)).length,
  operations: (await db().select().from(attributionOperations)).length,
});
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source)
    throw new Error(
      'BOW-921 requires TEST_DATABASE_URL; no skip/mock fallback',
    );
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('BOW-921 requires isolated loopback _test database');
  admin = new Pool({ connectionString: source, max: 3 });
  await admin.query('CREATE DATABASE "' + databaseName + '"');
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder: 'src/server/db/migrations',
  });
}, 30_000);
afterAll(async () => {
  try {
    await connection?.pool.end();
  } finally {
    if (admin) {
      await admin.query('DROP DATABASE IF EXISTS "' + databaseName + '"');
      await admin.end();
    }
  }
});
beforeEach(async () => {
  vi.restoreAllMocks();
  facts = dataset();
  facts.cases = facts.cases.slice(0, 2);
  clock = NOW;
  modelCalls = 0;
  ids = 0;
  afterModel = undefined;
  modelFailure = false;
  await db().delete(attributionOperations);
  await db().delete(selectionDraftProposals);
  await db().delete(standardAttributions);
  await db().delete(attributionHypotheses);
  await db().execute(
    sql.raw(
      'TRUNCATE directory_organizations, programs_cohorts, audit_events CASCADE',
    ),
  );
  await db()
    .insert(organizations)
    .values({ id: 'demo-org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      ['hr', 'other-hr', ...facts.cases.map((c) => c.person.id)].map((id) => ({
        id,
        name: id + '（演示）',
        organizationId: 'demo-org',
      })),
    );
  await db()
    .insert(accountBindings)
    .values({ accountId: ACCOUNT, personId: 'hr' });
  await db().insert(cohorts).values({ id: 'cohort6', name: '第六期（演示）' });
  await db().insert(grants).values({
    id: 'hr-grant',
    accountId: ACCOUNT,
    role: 'hr',
    scope: 'cohort',
    cohortId: 'cohort6',
    validFrom: '2026-01-01',
  });
  await db()
    .insert(enrollments)
    .values(
      facts.cases.map((c) => ({
        id: 'enroll-' + c.person.id,
        personId: c.person.id,
        cohortId: 'cohort6',
        confirmed: true,
        validFrom: '2026-01-01',
      })),
    );
  // Synthetic supported node kinds only, NOT the undecided production 923 mapping.
  await db()
    .insert(evaluationNodes)
    .values([
      {
        id: 'selection',
        name: '合成前段',
        kind: 'interview',
        cohortId: 'cohort6',
      },
      {
        id: 'graduation',
        name: '合成后段',
        kind: 'defense',
        cohortId: 'cohort6',
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values(
      facts.cases.flatMap((c) =>
        ['selection', 'graduation'].map((evaluationNodeId) => ({
          evaluationNodeId,
          personId: c.person.id,
        })),
      ),
    );
  await db()
    .insert(ruleVersions)
    .values({ id: 'xe-select-v1', provenance: 'published' })
    .onConflictDoNothing();
});
it('真实RC及账号操作锁；新实例重放原归因且每次人工确认新id/revision1', async () => {
  const { app, ports } = make();
  await ports.transaction(ACCOUNT, 'isolation', async (tx) => {
    expect(
      (await tx.db.execute(sql`show transaction_isolation`)).rows[0],
    ).toMatchObject({ transaction_isolation: 'read committed' });
  });
  const a = await app.confirmAttribution(ACCOUNT, confirm);
  expect(a.status).toBe('success');
  expect(await make().app.confirmAttribution(ACCOUNT, confirm)).toEqual({
    ...a,
    replayed: true,
  });
  const b = await app.confirmAttribution(ACCOUNT, {
    ...confirm,
    operationId: 'second',
  });
  expect(b.status).toBe('success');
  if (a.status !== 'success' || b.status !== 'success')
    throw Error('expected signed facts');
  expect(a.result.id).not.toBe(b.result.id);
  expect([a.result.revision, b.result.revision]).toEqual([1, 1]);
  expect(await counts()).toMatchObject({
    attributions: 2,
    audits: 2,
    operations: 2,
  });
  // The account and person ids differ in this fixture on purpose.
  expect(
    (await db().select().from(auditEvents)).map((row) => row.actorId),
  ).toEqual([ACCOUNT, ACCOUNT]);
  expect(modelCalls).toBe(0);
});
it('跨连接并发同key只写一次并返回原版本', async () => {
  const replies = await Promise.all([
    make().app.confirmAttribution(ACCOUNT, confirm),
    make().app.confirmAttribution(ACCOUNT, confirm),
  ]);
  expect(replies.every((r) => r.status === 'success')).toBe(true);
  expect(
    replies.filter((r) => r.status === 'success' && r.replayed),
  ).toHaveLength(1);
  expect(await counts()).toMatchObject({
    attributions: 1,
    audits: 1,
    operations: 1,
  });
});
it('同key不同语义拒绝；已完成回执不可覆盖', async () => {
  const { app, ports } = make();
  await app.confirmAttribution(ACCOUNT, confirm);
  expect(
    (await app.confirmAttribution(ACCOUNT, { ...confirm, rationale: '改语义' }))
      .status,
  ).toBe('conflict');
  await expect(
    ports.transaction(ACCOUNT, 'confirm', async (tx) => {
      const receipt = await ports.readOperation(tx, ACCOUNT, 'confirm');
      await ports.writeOperation(tx, ACCOUNT, 'confirm', receipt!);
    }),
  ).rejects.toMatchObject({ kind: 'conflict' });
});
it('模型在事务外；并发pending不会再次调用；成功假设和回执可跨实例重放', async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const seen = new Promise<void>((r) => {
    started = r;
  });
  afterModel = async () => {
    started();
    await gate;
  };
  const first = make().app.generateHypotheses(ACCOUNT, generate);
  await seen;
  try {
    expect(
      (await make().app.generateHypotheses(ACCOUNT, generate)).status,
    ).toBe('conflict');
    expect((await db().select().from(attributionOperations))[0].state).toBe(
      'pending',
    );
  } finally {
    release();
  }
  const result = await first;
  expect(result.status).toBe('success');
  expect(await make().app.generateHypotheses(ACCOUNT, generate)).toEqual({
    ...result,
    replayed: true,
  });
  expect(modelCalls).toBe(1);
  expect(await counts()).toEqual({
    hypotheses: 1,
    attributions: 0,
    proposals: 0,
    audits: 1,
    operations: 1,
  });
});
it('完成时审计实际插入后失败，成果/审计一起回滚，pending保留且不自动计费重试', async () => {
  const real = audit.recordAudit;
  vi.spyOn(audit, 'recordAudit').mockImplementation(async (tx, event) => {
    await real(tx, event);
    throw Error('synthetic audit failure');
  });
  await expect(
    make().app.generateHypotheses(ACCOUNT, generate),
  ).rejects.toThrow('synthetic audit failure');
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 0,
    operations: 1,
  });
  expect((await make().app.generateHypotheses(ACCOUNT, generate)).status).toBe(
    'conflict',
  );
  expect(modelCalls).toBe(1);
});
it('人工归因审计晚失败整笔回滚，无伪成功回执', async () => {
  const real = audit.recordAudit;
  vi.spyOn(audit, 'recordAudit').mockImplementation(async (tx, event) => {
    await real(tx, event);
    throw Error('synthetic audit failure');
  });
  await expect(
    make().app.confirmAttribution(ACCOUNT, confirm),
  ).rejects.toThrow();
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 0,
    operations: 0,
  });
});
it.each(['reservationId', 'fingerprint', 'evidenceFingerprint'] as const)(
  'pending三重CAS拒绝迟到%s',
  async (field) => {
    const { ports } = make();
    const reservation: AttributionOperation = {
      state: 'pending',
      reservationId: 'r1',
      fingerprint: 'f1',
      evidenceFingerprint: 'e1',
    };
    await ports.transaction(ACCOUNT, 'cas', async (tx) => {
      await ports.loadHrBatch(tx, ACCOUNT, 'batch', clock);
      await ports.writeOperation(tx, ACCOUNT, 'cas', reservation);
    });
    await expect(
      ports.transaction(ACCOUNT, 'cas', (tx) =>
        ports.writeOperation(tx, ACCOUNT, 'cas', {
          ...reservation,
          [field]: 'changed',
          state: 'finished',
          result: { status: 'model_failed', message: '演示失败' },
        }),
      ),
    ).rejects.toMatchObject({ kind: 'conflict' });
    expect((await db().select().from(attributionOperations))[0].state).toBe(
      'pending',
    );
  },
);
it.each(['revoked', 'expired'] as const)(
  '真实grant%s后禁止授权重放',
  async (mode) => {
    const { app } = make();
    await app.confirmAttribution(ACCOUNT, confirm);
    await db()
      .update(grants)
      .set(
        mode === 'revoked'
          ? { revokedAt: '2026-11-01' }
          : { validTo: '2026-11-01' },
      );
    expect((await app.confirmAttribution(ACCOUNT, confirm)).status).toBe(
      'forbidden',
    );
    expect(await counts()).toMatchObject({
      attributions: 1,
      audits: 1,
      operations: 1,
    });
  },
);
it('模型迟到时真实撤权，结果只收口forbidden而不保存AI成果', async () => {
  afterModel = async () => {
    await db().update(grants).set({ revokedAt: '2026-11-01' });
  };
  expect((await make().app.generateHypotheses(ACCOUNT, generate)).status).toBe(
    'forbidden',
  );
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 0,
    operations: 1,
  });
  expect((await db().select().from(attributionOperations))[0].state).toBe(
    'finished',
  );
});
it('模型期间账号重绑不能完成旧预留，也不能重放旧人的成果', async () => {
  afterModel = async () => {
    await db().update(accountBindings).set({ personId: 'other-hr' });
  };
  await expect(
    make().app.generateHypotheses(ACCOUNT, generate),
  ).rejects.toMatchObject({ kind: 'forbidden' });
  expect((await db().select().from(attributionOperations))[0].state).toBe(
    'pending',
  );
  afterModel = undefined;
  await expect(
    make().app.generateHypotheses(ACCOUNT, generate),
  ).rejects.toMatchObject({ kind: 'forbidden' });
  expect(modelCalls).toBe(1);
});
it('模型失败可重放但不生成草稿/审计', async () => {
  modelFailure = true;
  expect((await make().app.generateHypotheses(ACCOUNT, generate)).status).toBe(
    'model_failed',
  );
  expect((await make().app.generateHypotheses(ACCOUNT, generate)).status).toBe(
    'model_failed',
  );
  expect(modelCalls).toBe(1);
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 0,
    operations: 1,
  });
});
it('提案绑定精确人工归因revision与真实标准FK，AI和人工分表持久', async () => {
  const { app } = make();
  const a = await app.confirmAttribution(ACCOUNT, confirm);
  if (a.status !== 'success') throw Error('expected attribution');
  const command = {
    operationId: 'draft',
    attributionId: a.result.id,
    expectedAttributionRevision: 1,
    baseVersionId: 'xe-select-v1',
    reason: '演示调整',
  };
  expect(
    (
      await app.draftSelectionProposal(ACCOUNT, {
        ...command,
        expectedAttributionRevision: 2,
      })
    ).status,
  ).toBe('conflict');
  expect(
    (
      await app.draftSelectionProposal(ACCOUNT, {
        ...command,
        baseVersionId: 'xe-select-v2',
      })
    ).status,
  ).toBe('not_found');
  const p = await app.draftSelectionProposal(ACCOUNT, command);
  expect(p.status).toBe('success');
  expect(await make().app.draftSelectionProposal(ACCOUNT, command)).toEqual({
    ...p,
    replayed: true,
  });
  const [saved] = await db().select().from(selectionDraftProposals);
  expect(saved.payload.aiDraft.basis).toEqual(a.result);
  expect(saved.payload.humanVersion).toBeNull();
  expect(modelCalls).toBe(1);
  expect(await counts()).toMatchObject({
    attributions: 1,
    proposals: 1,
    audits: 2,
    operations: 2,
  });
});
it('跨批假设/引用与伪造归因basis均拒绝', async () => {
  const { app, ports } = make();
  const h = await app.generateHypotheses(ACCOUNT, generate);
  if (h.status !== 'success') throw Error('expected hypotheses');
  await ports.transaction(ACCOUNT, 'read-other', async (tx) => {
    await ports.loadHrBatch(tx, ACCOUNT, 'batch', clock);
    await expect(
      ports.readHypothesis(tx, 'other-batch', h.result[0].id),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
  const a = await app.confirmAttribution(ACCOUNT, confirm);
  if (a.status !== 'success') throw Error('expected attribution');
  await ports.transaction(ACCOUNT, 'bad-basis', async (tx) => {
    await ports.loadDraftContext(
      tx,
      ACCOUNT,
      a.result.id,
      'xe-select-v1',
      clock,
    );
    await expect(
      ports.saveProposal(tx, {
        id: 'bad',
        attributionId: a.result.id,
        baseVersionId: 'xe-select-v1',
        humanVersion: null,
        aiDraft: {
          origin: 'ai_draft',
          basis: { ...a.result, rationale: '篡改' },
          changes: [
            {
              kind: 'add',
              after: { id: 'new', title: '演示', description: '演示' },
            },
          ],
          model: {
            service: 'Modelink',
            model: model.expectedModel,
            promptVersion: 'demo',
          },
          generatedAt: clock,
        },
      }),
    ).rejects.toMatchObject({ kind: 'conflict' });
  });
});
it('失去任一节点/目标HR范围的案例不进模型，未接reader显式失败', async () => {
  await db()
    .delete(evaluationNodeSubjects)
    .where(
      and(
        eq(evaluationNodeSubjects.evaluationNodeId, 'graduation'),
        eq(evaluationNodeSubjects.personId, 'person-2'),
      ),
    );
  const { ports } = make();
  await ports.transaction(ACCOUNT, 'scope', async (tx) => {
    const b = await ports.loadHrBatch(tx, ACCOUNT, 'batch', clock);
    expect(b?.authorizedCaseIds).toEqual(['case-1']);
  });
  const broken = createAttributionPostgresStore(db(), {
    ...readers,
    readCanonicalComparisonBatch: async () => {
      throw Error('canonical unavailable');
    },
  });
  await expect(
    broken.transaction(ACCOUNT, 'unavailable', (tx) =>
      broken.loadHrBatch(tx, ACCOUNT, 'batch', clock),
    ),
  ).rejects.toThrow('canonical unavailable');
});
it('真实等操作锁后重新读取撤销权限', async () => {
  let unlock!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => {
    unlock = r;
  });
  const seen = new Promise<void>((r) => {
    locked = r;
  });
  const holder = make().ports.transaction(ACCOUNT, 'confirm', async () => {
    locked();
    await gate;
  });
  await seen;
  const pending = make().app.confirmAttribution(ACCOUNT, confirm);
  try {
    await vi.waitFor(async () => {
      const q = await db().execute(
        sql`select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%pg_advisory_xact_lock%'`,
      );
      expect(Number(q.rows[0].n)).toBeGreaterThan(0);
    });
    await db().update(grants).set({ revokedAt: '2026-11-01' });
  } finally {
    unlock();
  }
  await holder;
  expect((await pending).status).toBe('forbidden');
  expect(await counts()).toMatchObject({ attributions: 0, operations: 0 });
});
it('事务外令牌/错误账号或缺审计ledger不能绕过编排', async () => {
  const { ports } = make();
  let expired!: AttributionTransaction;
  await ports.transaction(ACCOUNT, 'capture', async (tx) => {
    expired = tx;
  });
  await expect(
    ports.readOperation(expired, ACCOUNT, 'capture'),
  ).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(
    ports.transaction(ACCOUNT, 'x', (tx) =>
      ports.readOperation(tx, 'other', 'x'),
    ),
  ).rejects.toMatchObject({ kind: 'forbidden' });
  await expect(
    ports.transaction(ACCOUNT, 'x', async (tx) => {
      const b = await ports.loadHrBatch(tx, ACCOUNT, 'batch', clock);
      const unit = b!.candidates[0],
        stage = unit.front;
      if (stage.state !== 'present') throw Error('fixture');
      await ports.saveHypotheses(tx, [
        {
          id: 'missing-ledger',
          batchId: 'batch',
          origin: 'ai_hypothesis',
          text: '演示',
          categories: ['method_or_information'],
          citations: [
            {
              caseId: unit.id,
              side: 'front',
              nodeId: stage.judgment.nodeId,
              standardVersionId: stage.judgment.standardVersionId,
              row: stage.judgment.row,
            },
          ],
          model: {
            service: 'Modelink',
            model: model.expectedModel,
            promptVersion: 'demo',
          },
          generatedAt: clock,
        },
      ]);
    }),
  ).rejects.toMatchObject({ kind: 'conflict' });
  expect(await counts()).toMatchObject({
    hypotheses: 0,
    audits: 0,
    operations: 0,
  });
});
it('直接存储不允许空白身份、管理员或不存在账号', async () => {
  const { ports } = make();
  await expect(
    ports.transaction('missing', 'x', async () => null),
  ).rejects.toMatchObject({ kind: 'forbidden' });
  await db().update(accountBindings).set({ isSystemAdmin: true });
  await expect(
    ports.transaction(ACCOUNT, 'x', async () => null),
  ).rejects.toMatchObject({ kind: 'forbidden' });
});

it('canonical读取等待期间撤权，返回前必须重查当前HR范围', async () => {
  const services: AttributionReadServices = {
    ...readers,
    async readCanonicalComparisonBatch(tx, batchId) {
      const value = await readers.readCanonicalComparisonBatch(tx, batchId);
      await db().update(grants).set({ revokedAt: '2026-11-01' });
      return value;
    },
  };
  const ports = createAttributionPostgresStore(db(), services);
  await ports.transaction(ACCOUNT, 'read-revoke', async (tx) => {
    expect(await ports.loadHrBatch(tx, ACCOUNT, 'batch', clock)).toBeNull();
  });
});
it('基准正文读取等待期间撤权，不能返回完整私有归因', async () => {
  const a = await make().app.confirmAttribution(ACCOUNT, confirm);
  if (a.status !== 'success') throw Error('expected attribution');
  const ports = createAttributionPostgresStore(db(), {
    ...readers,
    async readSelectionStandard(tx, id) {
      const value = await readers.readSelectionStandard(tx, id);
      await db().update(grants).set({ revokedAt: '2026-11-01' });
      return value;
    },
  });
  await ports.transaction(ACCOUNT, 'base-revoke', async (tx) => {
    expect(
      await ports.loadDraftContext(
        tx,
        ACCOUNT,
        a.result.id,
        'xe-select-v1',
        clock,
      ),
    ).toBeNull();
  });
});

it('完成回执真实插入后失败时成果与审计回滚，原pending完整保留', async () => {
  const { ports } = make();
  const original = ports.writeOperation.bind(ports);
  vi.spyOn(ports, 'writeOperation').mockImplementation(
    async (tx, account, operation, value) => {
      await original(tx, account, operation, value);
      if (value.state === 'finished')
        throw Error('synthetic receipt late failure');
    },
  );
  const app = createStandardAttributionUsecases(ports, model, {
    now: () => new Date(clock),
    newId: () => 'demo-' + ++ids,
  });
  await expect(app.generateHypotheses(ACCOUNT, generate)).rejects.toThrow(
    'synthetic receipt late failure',
  );
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 0,
    operations: 1,
  });
  expect((await db().select().from(attributionOperations))[0].state).toBe(
    'pending',
  );
});
it('当前hypothesis出处变化不可用于人工归因；未知归因与批次真实返回null', async () => {
  const { app, ports } = make();
  const h = await app.generateHypotheses(ACCOUNT, generate);
  if (h.status !== 'success') throw Error('expected hypothesis');
  const front = facts.cases[0].front;
  if (front.state !== 'present') throw Error('fixture');
  front.judgment.row.source.excerpt = '演示：实际原行内容发生变化';
  expect(
    (
      await app.confirmAttribution(ACCOUNT, {
        ...confirm,
        hypothesisId: h.result[0].id,
      })
    ).status,
  ).toBe('not_found');
  await ports.transaction(ACCOUNT, 'missing', async (tx) => {
    expect(
      await ports.loadHrBatch(tx, ACCOUNT, 'missing-batch', clock),
    ).toBeNull();
    expect(
      await ports.loadDraftContext(
        tx,
        ACCOUNT,
        'missing-attribution',
        'xe-select-v1',
        clock,
      ),
    ).toBeNull();
  });
});
it('空的合法模型假设仍持久化成功回执而不是model_failed', async () => {
  const empty: AttributionModel = {
    expectedModel: model.expectedModel,
    client: {
      async generateStructured(input) {
        return {
          ok: true,
          value: input.schema.parse({ hypotheses: [] }),
          metadata: {
            model: model.expectedModel,
            promptVersion: input.promptVersion,
          },
        };
      },
    },
  };
  const { ports } = make();
  const app = createStandardAttributionUsecases(ports, empty, {
    now: () => new Date(clock),
  });
  expect(await app.generateHypotheses(ACCOUNT, generate)).toEqual({
    status: 'success',
    replayed: false,
    result: [],
  });
  expect(await counts()).toEqual({
    hypotheses: 0,
    attributions: 0,
    proposals: 0,
    audits: 1,
    operations: 1,
  });
});
