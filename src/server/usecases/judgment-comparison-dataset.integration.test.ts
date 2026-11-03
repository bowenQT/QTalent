import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { createClock } from '../../lib/clock';
import { createDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import { cohorts, enrollments, evaluationRelations } from '../modules/programs';
import {
  attributionHypotheses,
  comparisonBatches,
  comparisonCases,
  standardAttributions,
} from '../modules/evaluation-system';
import { readJudgmentComparison } from '../modules/evaluation-system/judgment-comparison/read';
import type { ComparisonDataset } from '../modules/evaluation-system/judgment-comparison/ports';
import {
  confirmedStandardAttributionSchema,
  standardAttributionHypothesisSchema,
} from '../../contracts/standard-attribution';
import {
  prepareStandardIterationDemo,
  readStandardIterationFactFiles,
  type PreparedStandardIterationDemo,
} from '../db/seed/standard-iteration-demo/input';
import {
  DEMO_GRADUATION_REVIEWER,
  initializeStandardIterationDemo,
} from '../db/seed/standard-iteration-demo/init';
import { loadEvaluationContext } from './evaluation-context';
import { comparisonReadPorts } from '../queries/judge';
import { comparisonAccess } from '../queries/judge-access';
import {
  listComparisonBatches,
  readComparisonDataset,
} from './judgment-comparison-dataset';
import { readBatchAttributionState } from './standard-attribution/batch-state';

// The sixth-cohort batch is written by the real `--init`. Accounts, grants,
// enrollments and relations are synthetic test-only facts in an isolated _test
// database; they are not the demo environment's people or grants.
vi.setConfig({ testTimeout: 30_000 });
const clock = createClock('test');
const at = clock.now().toISOString();
const MANAGER = 'comparison-test-manager';
const HR = 'comparison-test-hr';
const RATER = 'comparison-test-rater';
const OUTSIDER = 'comparison-test-outsider';
const OUTSIDER_PERSON = 'comparison-test-outsider-person';
const databaseName = `qtalent_comparison_${randomUUID().replaceAll('-', '')}_test`;
let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
let plan: PreparedStandardIterationDemo;
let data: ComparisonDataset;
let raterId: string;
let hiddenPersonId: string;
function db() {
  if (!connection) throw new Error('Isolated test database unavailable');
  return connection.db;
}
const read = () =>
  db().transaction((tx) => readComparisonDataset(tx, plan.canonical.batch.id));
async function account(
  accountId: string,
  personId: string,
  role: 'manager' | 'hr' | 'mentor',
) {
  await db().insert(accountBindings).values({
    accountId,
    personId,
    isSystemAdmin: false,
  });
  await db()
    .insert(grants)
    .values({
      id: accountId + '-grant',
      accountId,
      role,
      scope: role === 'manager' ? 'company' : 'cohort',
      cohortId: role === 'manager' ? null : plan.cohort.id,
      validFrom: '2026-01-01',
    });
}
const page = (accountId: string, evaluatorId?: string) =>
  readJudgmentComparison(
    {
      batchId: plan.canonical.batch.id,
      ...(evaluatorId ? { evaluatorId } : {}),
    },
    comparisonReadPorts(db(), accountId, clock),
  );
async function visibleBatches(accountId: string) {
  const { context } = await loadEvaluationContext(db(), accountId, at);
  const access = comparisonAccess(context)!;
  return db().transaction((tx) => listComparisonBatches(tx, access));
}
function citation(caseId: string) {
  const unit = data.cases.find((c) => c.id === caseId)!;
  if (unit.front.state !== 'present') throw new Error('front stage required');
  return {
    caseId,
    side: 'front' as const,
    nodeId: unit.front.judgment.nodeId,
    standardVersionId: unit.front.judgment.standardVersionId,
    row: unit.front.judgment.row,
  };
}

beforeAll(async () => {
  plan = await prepareStandardIterationDemo(
    await readStandardIterationFactFiles(process.cwd()),
  );
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required; no skip or fake');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Isolated loopback _test database required');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), { migrationsFolder: 'src/server/db/migrations' });

  await db()
    .insert(organizations)
    .values([
      {
        id: 'comparison-test-org',
        name: '测试组织（演示）',
        shortName: '测试',
      },
      { id: 'tdc', name: '测试评审组织（演示）', shortName: '评审' },
    ]);
  await db()
    .insert(people)
    .values([
      ...plan.requiredPeople
        .filter((p) => p.id !== DEMO_GRADUATION_REVIEWER.id)
        .map((p) => ({
          ...p,
          organizationId: 'comparison-test-org',
          demo: true,
        })),
      DEMO_GRADUATION_REVIEWER,
    ]);
  await db().insert(cohorts).values(plan.cohort);
  const students = [...new Set(plan.canonical.cases.map((c) => c.personId))];
  // The rater is the front-stage evaluator with the most cases; a current
  // relation is given on both stages of their own cases only.
  const counts = new Map<string, number>();
  for (const unit of plan.canonical.cases)
    if (unit.front.state === 'present')
      counts.set(
        unit.front.evaluatorId,
        (counts.get(unit.front.evaluatorId) ?? 0) + 1,
      );
  raterId = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const staff = plan.requiredPeople
    .map((p) => p.id)
    .filter((id) => !students.includes(id) && id !== raterId);
  await account(MANAGER, staff[0], 'manager');
  const init = await initializeStandardIterationDemo(
    db(),
    process.cwd(),
    MANAGER,
    () => new Date('2026-11-01T00:00:00.000Z'),
  );
  expect(init.import).toMatchObject({ status: 'inserted' });

  // HR reads every enrolled student but one, whose cases stay out of scope.
  hiddenPersonId = students[0];
  await db()
    .insert(enrollments)
    .values(
      students
        .filter((id) => id !== hiddenPersonId)
        .map((personId) => ({
          id: 'enrollment-' + personId,
          cohortId: plan.cohort.id,
          personId,
          confirmed: true,
          validFrom: '2026-01-01',
        })),
    );
  await account(HR, staff[1], 'hr');

  await account(RATER, raterId, 'mentor');
  await db()
    .insert(evaluationRelations)
    .values(
      plan.canonical.cases
        .filter(
          (c) => c.front.state === 'present' && c.front.evaluatorId === raterId,
        )
        .flatMap((c) =>
          [c.frontNodeId, c.backNodeId].map((evaluationNodeId) => ({
            id: `relation-${evaluationNodeId}-${c.personId}`,
            evaluationNodeId,
            personId: c.personId,
            evaluatorId: raterId,
            kind: 'judge' as const,
            validFrom: '2026-01-01T00:00:00.000Z',
          })),
        ),
    );
  // --init gives every evaluator a judge relation on their own cases, so the
  // outsider is a mentor who judged nothing in this batch.
  await db().insert(people).values({
    id: OUTSIDER_PERSON,
    name: '旁观导师（演示）',
    organizationId: 'comparison-test-org',
    demo: true,
  });
  await account(OUTSIDER, OUTSIDER_PERSON, 'mentor');
  data = (await read())!;
}, 60_000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});

describe('the --init sixth-cohort batch through the comparison reads', () => {
  it('converts the canonical batch once: bound version, no precomputed outcome', async () => {
    expect(data.batch).toEqual({
      id: plan.canonical.batch.id,
      name: plan.canonical.batch.name,
      cohort: plan.cohort,
      selectionStandardVersionId: plan.selectionStandard.versionId,
      mappingVersionId: plan.canonical.mapping.versionId,
    });
    expect(data.cases).toHaveLength(93);
    expect(data.cases.some((c) => 'outcome' in c)).toBe(false);
    expect(data.confirmedAttributions).toEqual([]);
    expect(
      await db().transaction((tx) =>
        readComparisonDataset(tx, 'no-such-batch'),
      ),
    ).toBeNull();
  });

  it('manager: one aggregate per batch, no names, cases or per-rater numbers', async () => {
    const result = await page(MANAGER);
    expect(result.status).toBe('success');
    if (result.status !== 'success' || result.page.audience !== 'manager')
      throw new Error('manager page expected');
    expect(result.page.batches).toHaveLength(1);
    expect(Object.keys(result.page.batches[0]).sort()).toEqual([
      'attributionCategories',
      'batch',
      'discrepancyPeople',
    ]);
    expect(JSON.stringify(result.page)).not.toContain(raterId);
    expect(await page(MANAGER, raterId)).toMatchObject({ status: 'forbidden' });
    expect(await visibleBatches(MANAGER)).toEqual([data.batch]);
  });

  it('HR: only cases of enrolled students; each rater either 样本不足 or a distribution', async () => {
    const result = await page(HR);
    if (result.status !== 'success' || result.page.audience !== 'hr')
      throw new Error('HR page expected');
    const hidden = data.cases.filter((c) => c.person.id === hiddenPersonId);
    expect(hidden.length).toBeGreaterThan(0);
    expect(result.page.cases).toHaveLength(93 - hidden.length);
    expect(result.page.cases.map((c) => c.person.id)).not.toContain(
      hiddenPersonId,
    );
    expect(result.page.raters.length).toBeGreaterThan(0);
    for (const { sample } of result.page.raters)
      if (sample.state === 'insufficient_sample') {
        expect(sample.label).toBe('样本不足');
        expect(sample).not.toHaveProperty('distribution');
      } else expect(sample.comparableCaseCount).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(result.page)).not.toMatch(/accuracy|rank|准确率/);
    expect(await visibleBatches(HR)).toEqual([data.batch]);
  });

  it('rater: only their own front-stage cases; another evaluator is refused', async () => {
    const result = await page(RATER);
    if (result.status !== 'success' || result.page.audience !== 'rater')
      throw new Error('rater page expected');
    const own = data.cases.filter(
      (c) =>
        c.front.state === 'present' &&
        c.front.judgment.evaluator.id === raterId,
    );
    expect(result.page.cases.map((c) => c.id).sort()).toEqual(
      own.map((c) => c.id).sort(),
    );
    expect(result.page.cases.every((c) => c.outcome.state !== 'withheld')).toBe(
      true,
    );
    const other = data.cases.find(
      (c) =>
        c.front.state === 'present' &&
        c.front.judgment.evaluator.id !== raterId,
    )!;
    if (other.front.state !== 'present') throw new Error('unreachable');
    expect(await page(RATER, other.front.judgment.evaluator.id)).toMatchObject({
      status: 'forbidden',
    });
    expect(await visibleBatches(RATER)).toEqual([data.batch]);
  });

  it('a viewer with no grant on any case gets neither the batch nor its metadata', async () => {
    expect(await page(OUTSIDER)).toMatchObject({ status: 'not_found' });
    expect(await visibleBatches(OUTSIDER)).toEqual([]);
  });
});

describe('readBatchAttributionState and confirmedAttributions', () => {
  const visibleCase = () =>
    data.cases.find(
      (c) => c.person.id !== hiddenPersonId && c.front.state === 'present',
    )!.id;
  const hiddenCase = () =>
    data.cases.find(
      (c) => c.person.id === hiddenPersonId && c.front.state === 'present',
    )!.id;
  const hypothesis = (id: string, caseId: string) =>
    standardAttributionHypothesisSchema.parse({
      id,
      batchId: data.batch.id,
      origin: 'ai_hypothesis',
      text: '演示假设',
      categories: ['evaluation_standard'],
      citations: [citation(caseId)],
      model: { service: 'synthetic', model: 'synthetic', promptVersion: 't' },
      generatedAt: '2026-09-01T00:00:00.000Z',
    });
  const attribution = (id: string, caseId: string, hypothesisId: string) =>
    confirmedStandardAttributionSchema.parse({
      id,
      revision: 1,
      batchId: data.batch.id,
      origin: 'human_conclusion',
      hypothesisId,
      categories: ['evaluation_standard', 'evaluator'],
      rationale: '演示归因',
      citations: [citation(caseId)],
      confirmedBy: {
        id: data.mapping.confirmedBy.id,
        name: data.mapping.confirmedBy.name,
      },
      confirmedAt: '2026-09-02T00:00:00.000Z',
    });

  beforeAll(async () => {
    const values = [
      hypothesis('h-visible', visibleCase()),
      hypothesis('h-hidden', hiddenCase()),
    ];
    await db()
      .insert(attributionHypotheses)
      .values(
        values.map((payload) => ({
          id: payload.id,
          batchId: payload.batchId,
          payload,
        })),
      );
    for (const payload of [
      attribution('a-visible', visibleCase(), 'h-visible'),
      attribution('a-hidden', hiddenCase(), 'h-hidden'),
    ])
      await db().insert(standardAttributions).values({
        id: payload.id,
        revision: 1,
        batchId: payload.batchId,
        hypothesisId: payload.hypothesisId,
        confirmedByPersonId: payload.confirmedBy.id,
        confirmedAt: payload.confirmedAt,
        payload,
      });
  });

  it('HR gets only items whose every citation is in its current scope', async () => {
    const state = await db().transaction((tx) =>
      readBatchAttributionState(tx, data.batch.id, HR, at),
    );
    expect(state?.hypotheses.map((h) => h.id)).toEqual(['h-visible']);
    expect(state?.attributions.map((a) => a.id)).toEqual(['a-visible']);
  });

  it('non-HR, unknown batch and revoked HR all read null, not an empty list', async () => {
    for (const accountId of [MANAGER, RATER, OUTSIDER])
      expect(
        await db().transaction((tx) =>
          readBatchAttributionState(tx, data.batch.id, accountId, at),
        ),
      ).toBeNull();
    expect(
      await db().transaction((tx) =>
        readBatchAttributionState(tx, 'no-such-batch', HR, at),
      ),
    ).toBeNull();
    await db()
      .update(grants)
      .set({ revokedAt: '2026-09-01' })
      .where(eq(grants.accountId, HR));
    try {
      expect(
        await db().transaction((tx) =>
          readBatchAttributionState(tx, data.batch.id, HR, at),
        ),
      ).toBeNull();
    } finally {
      await db()
        .update(grants)
        .set({ revokedAt: null })
        .where(eq(grants.accountId, HR));
    }
  });

  it('confirmedAttributions feed the manager summary only for readable cases', async () => {
    const dataset = (await read())!;
    expect(dataset.confirmedAttributions).toEqual(
      [visibleCase(), hiddenCase()]
        .flatMap((caseId) =>
          (['evaluation_standard', 'evaluator'] as const).map((category) => ({
            caseId,
            category,
          })),
        )
        .sort((a, b) =>
          JSON.stringify([a.caseId, a.category]) <
          JSON.stringify([b.caseId, b.category])
            ? -1
            : 1,
        ),
    );
    const result = await page(MANAGER);
    if (result.status !== 'success' || result.page.audience !== 'manager')
      throw new Error('manager page expected');
    expect(result.page.batches[0].attributionCategories.sort()).toEqual([
      'evaluation_standard',
      'evaluator',
    ]);
  });
});

describe('listComparisonBatches within one cohort', () => {
  // Two more batches of the same cohort with one case each, granted to
  // different viewers: the hidden student's case the rater judged (rater, not
  // HR), and a case of an enrolled student the rater has no relation on (HR,
  // not rater). Only the list reads them, so case rows suffice.
  const RATER_ONLY = 'comparison-test-rater-batch';
  const HR_ONLY = 'comparison-test-hr-batch';
  beforeAll(async () => {
    const [stored] = await db()
      .select()
      .from(comparisonBatches)
      .where(eq(comparisonBatches.id, plan.canonical.batch.id));
    const rated = (c: (typeof plan.canonical.cases)[number]) =>
      c.front.state === 'present' && c.front.evaluatorId === raterId;
    const related = new Set(
      plan.canonical.cases
        .filter(rated)
        .flatMap((c) =>
          [c.frontNodeId, c.backNodeId].map((n) => n + c.personId),
        ),
    );
    const raterCase = plan.canonical.cases.find(
      (c) => c.personId === hiddenPersonId && rated(c),
    );
    const hrCase = plan.canonical.cases.find(
      (c) =>
        c.personId !== hiddenPersonId &&
        !related.has(c.frontNodeId + c.personId) &&
        !related.has(c.backNodeId + c.personId),
    );
    if (!raterCase || !hrCase) throw new Error('fixture cases expected');
    const later = (days: number) =>
      new Date(Date.parse(stored.importedAt) + days * 86_400_000).toISOString();
    await db()
      .insert(comparisonBatches)
      .values([
        {
          ...stored,
          id: HR_ONLY,
          name: '对照批次二（演示）',
          importedAt: later(1),
        },
        {
          ...stored,
          id: RATER_ONLY,
          name: '对照批次三（演示）',
          importedAt: later(2),
        },
      ]);
    const row = (batchId: string, unit: typeof hrCase) => ({
      id: batchId + '-case',
      batchId,
      personId: unit.personId,
      judgmentId: unit.judgment.id,
      judgmentName: unit.judgment.name,
      frontNodeId: unit.frontNodeId,
      backNodeId: unit.backNodeId,
      workKind: unit.work.kind,
      workId: unit.work.workId,
      teamId: unit.work.kind === 'team' ? unit.work.teamId : null,
    });
    await db()
      .insert(comparisonCases)
      .values([row(HR_ONLY, hrCase), row(RATER_ONLY, raterCase)]);
  });

  it('lists only batches with a case in the current grant, newest first', async () => {
    const ids = async (accountId: string) =>
      (await visibleBatches(accountId)).map((b) => b.id);
    expect(await ids(MANAGER)).toEqual([RATER_ONLY, HR_ONLY, data.batch.id]);
    expect(await ids(HR)).toEqual([HR_ONLY, data.batch.id]);
    expect(await ids(RATER)).toEqual([RATER_ONLY, data.batch.id]);
    expect(await ids(OUTSIDER)).toEqual([]);
    // A withheld batch's metadata is not in the narrower list either.
    expect(JSON.stringify(await visibleBatches(HR))).not.toContain(
      '对照批次三',
    );
    expect(JSON.stringify(await visibleBatches(RATER))).not.toContain(
      '对照批次二',
    );
  });
});
