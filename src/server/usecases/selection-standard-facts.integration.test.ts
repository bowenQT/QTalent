import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../db/client';
import {
  organizations,
  people,
  accountBindings,
  grants,
} from '../modules/directory';
import {
  cohorts,
  enrollments,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../modules/programs';
import { originals, originalVersions, fragments } from '../modules/records';
import {
  canonicalInputFiles,
  standardAttributions,
  selectionDraftProposals,
  type CanonicalComparisonImport,
} from '../modules/evaluation-system';
import { selectionRevisions } from '../modules/evaluation-system/selection/schema';
import { selectionRevisionSchema } from '../../contracts/selection-standard';
import { writeCanonicalComparisonBatch } from './judgment-comparison-canonical';
import {
  initializeReviewedSelectionBaseline,
  bindExistingSelectionCohort,
  createNativeSelectionLifecycle,
  loadSelectionAuthority,
} from './selection-standard-native';
import { createAttributionPostgresStore } from './standard-attribution/postgres';
import { createStandardAttributionUsecases } from './standard-attribution/hypotheses';
import { readSelectionCohortVersion } from './selection-standard';
import { readNativeSelectionImpact } from './selection-standard-facts';
import { readCurrentSelectionStandard } from '../modules/evaluation-system/selection/postgres';
import type { AttributionModel } from './standard-attribution/ports';
import type { ComparisonDataset } from '../modules/evaluation-system/judgment-comparison/ports';

let admin: Pool | undefined;
let connection: ReturnType<typeof createDatabase> | undefined;
const databaseName = `qtalent_selection_facts_${randomUUID().replaceAll('-', '')}_test`;
const db = () => {
  if (!connection) throw new Error('Real PG required');
  return connection.db;
};
const now = '2026-10-31T10:00:00.000Z';
const clock = () => new Date(now);
const hash = 'c'.repeat(64),
  commit = 'a'.repeat(40);
const content = {
  reviewPoints: [
    { id: 'point', title: '作品（演示）', description: '演示要点' },
  ],
};
const next = {
  id: 'next-demo',
  name: '下一期（合成测试）',
  sourceReference: 'synthetic:explicit-planning-fact',
};
let attributionId = '',
  proposalId = '';
const command = () => ({
  operationId: 'create',
  attributionId,
  expectedAttributionRevision: 1,
  baseVersionId: 'xe-select-v1',
  reason: '演示修订理由',
});
const app = () =>
  createNativeSelectionLifecycle(db(), { nextCohort: next, clock });
function fixture(): CanonicalComparisonImport {
  const source = (side: string) => ({
    fragmentId: side + '-row',
    originalVersionId: side + '-version',
    rowPersonId: 'person',
    row: 2,
  });
  return {
    batch: {
      id: 'batch',
      name: '对照（演示）',
      cohortId: 'cohort',
      mappingVersionId: 'map-xe-select-v1',
      sourceCommit: commit,
      contractSha: 'b'.repeat(40),
      fixtureVersion: 'bow-923-v2',
      inputFileHashes: Object.fromEntries(
        canonicalInputFiles.map((path) => [path, hash]),
      ) as CanonicalComparisonImport['batch']['inputFileHashes'],
      inputCaseCount: 1,
      nature: 'demo_rebuilt',
    },
    mapping: {
      versionId: 'map-xe-select-v1',
      frontScaleId: 'selection',
      backScaleId: 'graduation',
      rows: [
        { frontGrade: '高', frontPosition: 'highest', backGrade: '建议留用' },
        { frontGrade: '中', frontPosition: 'middle', backGrade: '继续观察' },
        { frontGrade: '低', frontPosition: 'just_passed', backGrade: '不建议' },
      ],
      confirmedById: 'hr',
      confirmedAt: '2026-01-01T00:00:00.000001Z',
      sourceCommit: commit,
      sourceFileSha256: hash,
      nature: 'demo_human_confirmation',
    },
    cases: [
      {
        id: 'case',
        personId: 'person',
        judgment: { id: 'judgment', name: '原表对照（演示）' },
        frontNodeId: 'front',
        backNodeId: 'back',
        work: { kind: 'team', workId: 'work', teamId: 'team' },
        front: {
          state: 'present',
          source: source('front'),
          judgmentId: 'front-judgment',
          sourceStandardReference: 'xe-select-v1',
          scaleId: 'selection',
          grade: '高',
          evaluatorId: 'rater',
          evaluatedAt: '2026-02-01T00:00:00.000001Z',
          confirmation: 'human_confirmed',
        },
        back: {
          state: 'present',
          source: source('back'),
          judgmentId: 'back-judgment',
          sourceStandardReference: 'graduation-v1',
          scaleId: 'graduation',
          grade: '不建议',
          evaluatorId: 'rater',
          evaluatedAt: '2026-06-01T00:00:00.000002Z',
          confirmation: 'human_confirmed',
        },
      },
    ],
    manualMarks: [
      {
        id: 'mark',
        caseId: 'case',
        batchId: 'batch',
        personId: 'person',
        frontNodeId: 'front',
        backNodeId: 'back',
        reason: '工作边界改变（演示）',
        markedById: 'hr',
        markedAt: '2026-06-01T00:00:00.000003Z',
        sourceFileSha256: hash,
        nature: 'demo_human_mark',
      },
    ],
  };
}
beforeAll(async () => {
  const source = process.env.TEST_DATABASE_URL;
  if (!source) throw new Error('TEST_DATABASE_URL required');
  const url = new URL(source);
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !url.pathname.endsWith('_test')
  )
    throw new Error('Loopback _test required');
  admin = new Pool({ connectionString: source, max: 2 });
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  url.pathname = '/' + databaseName;
  connection = createDatabase(url.toString());
  await migrate(db(), {
    migrationsFolder:
      process.env.BOW_918_TEST_MIGRATIONS_DIR ?? 'src/server/db/migrations',
  });
}, 30000);
afterAll(async () => {
  await connection?.pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
    await admin.end();
  }
});
beforeEach(async () => {
  // Only this suite's isolated database; no DDL/schema replacement.
  await db().execute(
    sql`truncate evaluation_attribution_operations, evaluation_selection_draft_proposals, evaluation_standard_attributions, evaluation_attribution_hypotheses, evaluation_comparison_manual_marks, evaluation_comparison_stages, evaluation_comparison_cases, evaluation_comparison_batches, evaluation_comparison_mappings, evaluation_selection_operations, evaluation_selection_cohort_bindings, evaluation_selection_category_head, evaluation_selection_publications, evaluation_selection_revisions, evaluation_selection_version_content, evaluation_rule_version_applicability, evaluation_rule_versions, records_fragments, records_original_versions, records_originals, programs_evaluation_node_subjects, programs_evaluation_nodes, programs_enrollments, programs_cohorts, directory_grants, directory_account_bindings, directory_people, directory_organizations, audit_events cascade`,
  );
  await db()
    .insert(organizations)
    .values({ id: 'org', name: '演示组织', shortName: '演示' });
  await db()
    .insert(people)
    .values(
      ['person', 'hr', 'rater', 'manager'].map((id) => ({
        id,
        name: id + '（演示）',
        organizationId: 'org',
        demo: true,
      })),
    );
  await db()
    .insert(accountBindings)
    .values(['hr', 'manager'].map((id) => ({ accountId: id, personId: id })));
  await db()
    .insert(grants)
    .values([
      {
        id: 'manager',
        accountId: 'manager',
        role: 'manager',
        scope: 'company',
        validFrom: '2026-01-01',
      },
      ...['cohort', next.id].map((cohortId) => ({
        id: 'hr-' + cohortId,
        accountId: 'hr',
        role: 'hr' as const,
        scope: 'cohort' as const,
        cohortId,
        validFrom: '2026-01-01',
      })),
    ]);
  await db()
    .insert(cohorts)
    .values({ id: 'cohort', name: '合成持久化测试期（演示）' });
  await db().insert(enrollments).values({
    id: 'enrollment',
    cohortId: 'cohort',
    personId: 'person',
    confirmed: true,
    validFrom: '2026-01-01',
  });
  await db()
    .insert(evaluationNodes)
    .values([
      {
        id: 'front',
        name: '合成面试（演示）',
        kind: 'interview',
        cohortId: 'cohort',
      },
      {
        id: 'back',
        name: '合成答辩（演示）',
        kind: 'defense',
        cohortId: 'cohort',
      },
    ]);
  await db()
    .insert(evaluationNodeSubjects)
    .values(
      ['front', 'back'].map((evaluationNodeId) => ({
        evaluationNodeId,
        personId: 'person',
      })),
    );
  await initializeReviewedSelectionBaseline(
    db(),
    'manager',
    {
      versionId: 'xe-select-v1',
      periodId: 'baseline',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      nextVersionOrdinal: 2,
      content,
      sourceCommit: commit,
      sourceReference: 'synthetic:baseline',
    },
    clock,
  );
  await bindExistingSelectionCohort(db(), 'manager', 'cohort', clock);
  for (const [side, path] of [
    ['front', canonicalInputFiles[6]],
    ['back', canonicalInputFiles[7]],
  ] as const) {
    await db()
      .insert(originals)
      .values({
        id: side + '-original',
        title: side + '（演示）',
        kind: 'original',
        displayNotice: '化名重建的演示原表',
      });
    await db()
      .insert(originalVersions)
      .values({
        id: side + '-version',
        originalId: side + '-original',
        version: 1,
        contentDigest: hash,
        sourceCommit: commit,
        sourcePath: path,
      });
    await db()
      .insert(fragments)
      .values({
        id: side + '-row',
        originalVersionId: side + '-version',
        location: { kind: 'spreadsheet', sheet: '演示', cell: 'A2:P2' },
        excerpt: '该原件独有的片段正文（演示）',
      });
  }
  const input = fixture();
  input.manualMarks = [];
  await db().transaction((tx) => writeCanonicalComparisonBatch(tx, input));
  // Upstream921 receives explicitly authored synthetic comparison facts for its
  // existing adapter;918 below reads the actual919 canonical store independently.
  // This is not evidence of the yet-unassigned shared canonical→Web/921 converter.
  const actor = (id: string) => ({ id, name: id + '（演示）' });
  const unit = input.cases[0];
  const stage = (side: 'front' | 'back') => {
    const value = unit[side];
    if (value.state !== 'present') throw new Error('Test source missing');
    return {
      state: 'present' as const,
      judgment: {
        judgmentId: value.judgmentId,
        nodeId: unit[side === 'front' ? 'frontNodeId' : 'backNodeId'],
        cohortId: 'cohort',
        standardVersionId: value.sourceStandardReference,
        scaleId: value.scaleId,
        grade: value.grade,
        evaluator: actor(value.evaluatorId),
        evaluatedAt: value.evaluatedAt,
        confirmation: 'human_confirmed' as const,
        row: {
          personId: 'person',
          row: 2,
          source: {
            fragmentId: side + '-row',
            originalVersionId: side + '-version',
            location: {
              kind: 'spreadsheet' as const,
              sheet: '演示',
              cell: 'A2:P2',
            },
            excerpt: '该原件独有的片段正文（演示）',
            originalTitle: side + '（演示）',
            recordedByName: null,
            sourceCategory: 'original' as const,
            sourceType: 'spreadsheet' as const,
            demo: true,
          },
        },
      },
    };
  };
  const data: ComparisonDataset = {
    batch: {
      id: 'batch',
      name: input.batch.name,
      cohort: { id: 'cohort', name: '合成持久化测试期（演示）' },
      selectionStandardVersionId: 'xe-select-v1',
      mappingVersionId: input.mapping.versionId,
    },
    mapping: {
      versionId: input.mapping.versionId,
      frontScaleId: input.mapping.frontScaleId,
      backScaleId: input.mapping.backScaleId,
      rows: input.mapping.rows,
      confirmedBy: actor('hr'),
      confirmedAt: input.mapping.confirmedAt,
    },
    cases: [
      {
        id: 'case',
        batchId: 'batch',
        person: actor('person'),
        judgment: unit.judgment,
        cohort: { id: 'cohort', name: '合成持久化测试期（演示）' },
        selectionStandardVersionId: 'xe-select-v1',
        mappingVersionId: input.mapping.versionId,
        frontNodeId: 'front',
        backNodeId: 'back',
        work: unit.work,
        front: stage('front'),
        back: stage('back'),
      },
    ],
    confirmedAttributions: [],
  };
  const upstream = createAttributionPostgresStore(db(), {
    readCanonicalComparisonBatch: async () => data,
    readSelectionStandard: (tx, id) =>
      readCurrentSelectionStandard(tx, id, clock),
  });
  const model: AttributionModel = {
    expectedModel: 'synthetic-gemini-model',
    client: {
      async generateStructured(request) {
        return {
          ok: true as const,
          value: request.schema.parse({
            changes: [
              {
                kind: 'add',
                after: {
                  id: 'ai-point',
                  title: 'AI建议（演示）',
                  description: '核对个人交付',
                },
              },
            ],
          }),
          metadata: {
            model: 'synthetic-gemini-model',
            promptVersion: request.promptVersion,
          },
        };
      },
    },
  };
  let sequence = 0;
  const sourceApp = createStandardAttributionUsecases(upstream, model, {
    now: clock,
    newId: () => `synthetic-artifact-${++sequence}`,
  });
  const confirmed = await sourceApp.confirmAttribution('hr', {
    operationId: 'confirm',
    batchId: 'batch',
    hypothesisId: null,
    categories: ['evaluation_standard'],
    rationale: '核对个人贡献（演示）',
    caseIds: ['case'],
  });
  if (confirmed.status !== 'success')
    throw new Error('Actual921 confirmation failed: ' + confirmed.status);
  attributionId = confirmed.result.id;
  const proposal = await sourceApp.draftSelectionProposal('hr', {
    ...command(),
    operationId: 'model-draft',
  });
  if (proposal.status !== 'success')
    throw new Error('Actual921 proposal failed: ' + proposal.status);
  proposalId = proposal.result.id;
});

describe('918 native canonical/attribution/lifecycle composition', () => {
  it('actual persisted HR basis produces real impact and only an unedited draft', async () => {
    const result = await app().execute('hr', {
      action: 'create',
      input: command(),
    });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const revision = selectionRevisionSchema.parse(result.result);
    expect(revision.humanVersion).toBeNull();
    expect(revision.aiDraft).toBeNull();
    expect(revision.basis.id).toBe(attributionId);
    expect(revision.impactPreview.existingResults).toEqual([
      { cohortId: 'cohort', standardVersionId: 'xe-select-v1', count: 1 },
    ]);
    expect(revision.impactPreview.preservedBindings).toHaveLength(1);
    const [stored] = await db().select().from(selectionRevisions);
    expect(stored.record.managerBasis[0].discrepancyPeople).toBe(1);
  });
  it('AI adoption retains the original; HR save, submit, publish run through the existing native transaction', async () => {
    const service = app();
    const adopted = await service.adoptProposal('hr', proposalId, command());
    expect(adopted.status).toBe('success');
    if (adopted.status !== 'success') return;
    let revision = selectionRevisionSchema.parse(adopted.result);
    expect(revision.aiDraft?.origin).toBe('ai_draft');
    expect(revision.humanVersion).toBeNull();
    const originalAi = revision.aiDraft;
    const saved = await service.execute('hr', {
      action: 'save',
      input: {
        operationId: 'save',
        draftId: revision.id,
        expectedRevision: revision.revision,
        reason: 'HR核对（演示）',
        changes: [
          {
            kind: 'add',
            after: {
              id: 'hr-point',
              title: 'HR修改（演示）',
              description: '使用本人实际交付',
            },
          },
        ],
      },
    });
    expect(saved.status).toBe('success');
    if (saved.status !== 'success') return;
    revision = selectionRevisionSchema.parse(saved.result);
    expect(revision.humanVersion?.origin).toBe('hr_edited');
    expect(revision.aiDraft).toEqual(originalAi);
    await service.adoptProposal('hr', proposalId, command());
    expect(
      (await db().select().from(selectionRevisions))[0].record.revision
        .humanVersion,
    ).toEqual(revision.humanVersion);
    const submitted = await service.execute('hr', {
      action: 'submit',
      input: {
        operationId: 'submit',
        draftId: revision.id,
        expectedRevision: revision.revision,
        expectedPreviewId: revision.impactPreview.id,
      },
    });
    expect(submitted.status).toBe('success');
    if (submitted.status !== 'success') return;
    revision = selectionRevisionSchema.parse(submitted.result);
    const published = await service.execute('manager', {
      action: 'publish',
      input: {
        operationId: 'publish',
        draftId: revision.id,
        expectedRevision: revision.revision,
        expectedPreviewId: revision.impactPreview.id,
      },
    });
    expect(published.status).toBe('success');
    expect((await db().select().from(selectionRevisions))[0].state).toBe(
      'active',
    );
  });
  it('missing trusted next-cohort fact is not an empty/default preview', async () => {
    await expect(
      createNativeSelectionLifecycle(db(), { nextCohort: null, clock }).execute(
        'hr',
        { action: 'create', input: command() },
      ),
    ).rejects.toThrow('Selection persistence unavailable');
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('revoked current HR cannot reuse historical confirmation or an AI proposal', async () => {
    await db()
      .update(grants)
      .set({ revokedAt: '2026-10-31' })
      .where(eq(grants.id, 'hr-cohort'));
    expect(
      (await app().adoptProposal('hr', proposalId, command())).status,
    ).toBe('forbidden');
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('current node subject access is required even for historical HR citations', async () => {
    await db().update(enrollments).set({ revokedAt: '2026-10-31' });
    expect(
      (await app().execute('hr', { action: 'create', input: command() }))
        .status,
    ).toBe('forbidden');
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('actual canonical source drift fails closed and rolls back version reservation', async () => {
    await db()
      .update(fragments)
      .set({ excerpt: '变化后的原文（演示）' })
      .where(eq(fragments.id, 'front-row'));
    await expect(
      app().execute('hr', { action: 'create', input: command() }),
    ).rejects.toThrow();
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('a pre-created next cohort is not silently adopted or relabelled as future', async () => {
    await db().insert(cohorts).values({ id: next.id, name: next.name });
    expect(
      (await app().execute('hr', { action: 'create', input: command() }))
        .status,
    ).toBe('conflict');
  });
  it('an AI proposal with a different full basis cannot be adopted', async () => {
    const [row] = await db().select().from(selectionDraftProposals);
    await db()
      .update(selectionDraftProposals)
      .set({
        payload: {
          ...row.payload,
          aiDraft: {
            ...row.payload.aiDraft,
            basis: {
              ...row.payload.aiDraft.basis,
              rationale: '不同依据（演示）',
            },
          },
        },
      });
    expect(
      (await app().adoptProposal('hr', proposalId, command())).status,
    ).toBe('conflict');
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('non-standard attribution is never an eligible basis', async () => {
    const [row] = await db().select().from(standardAttributions);
    await db()
      .update(standardAttributions)
      .set({
        payload: { ...row.payload, categories: ['person_or_environment'] },
      });
    await expect(
      app().execute('hr', { action: 'create', input: command() }),
    ).rejects.toThrow();
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
});

describe('native reader and stale input boundaries', () => {
  it('readonly lifecycle store reads the stored cohort without write locks', async () => {
    const result = await readSelectionCohortVersion(
      app().store.ports,
      'hr',
      { cohortId: 'cohort' },
      clock,
    );
    expect(result.status).toBe('success');
    if (result.status === 'success')
      expect(result.binding.standardVersionId).toBe('xe-select-v1');
    expect(
      (
        await readSelectionCohortVersion(
          app().store.ports,
          'unknown',
          { cohortId: 'cohort' },
          clock,
        )
      ).status,
    ).toBe('forbidden');
  });
  it.each([
    ['unknown attribution', { attributionId: 'absent' }, 'not_found'],
    ['stale revision', { expectedAttributionRevision: 2 }, 'conflict'],
    ['noncurrent standard', { baseVersionId: 'xe-select-v99' }, 'conflict'],
  ])('%s does not reserve a draft', async (_name, change, status) => {
    const result = await app().execute('hr', {
      action: 'create',
      input: { ...command(), ...change },
    });
    expect(result.status).toBe(status);
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('missing proposal is not a manual or empty AI draft', async () => {
    expect((await app().adoptProposal('hr', 'absent', command())).status).toBe(
      'not_found',
    );
    expect(await db().select().from(selectionRevisions)).toEqual([]);
  });
  it('one selection judgment referenced by two batches counts once', async () => {
    const input = fixture();
    input.manualMarks = [];
    input.batch.id = 'second-batch';
    input.cases[0].id = 'second-case';
    await db().transaction((tx) => writeCanonicalComparisonBatch(tx, input));
    const result = await app().execute('hr', {
      action: 'create',
      input: command(),
    });
    expect(result.status).toBe('success');
    if (result.status === 'success')
      expect(
        selectionRevisionSchema.parse(result.result).impactPreview
          .existingResults,
      ).toEqual([
        { cohortId: 'cohort', standardVersionId: 'xe-select-v1', count: 1 },
      ]);
  });
  it('current front-node visibility governs HR impact; company manager gets only counts', async () => {
    await db().update(enrollments).set({ revokedAt: '2026-10-31' });
    const read = (account: string) =>
      db().transaction(async (tx) => {
        const who = await loadSelectionAuthority(tx, account, clock);
        return readNativeSelectionImpact(tx, who, next, ['cohort']);
      });
    expect((await read('hr')).existingResults[0].count).toBe(0);
    const manager = await read('manager');
    expect(manager.existingResults).toEqual([
      { cohortId: 'cohort', standardVersionId: 'xe-select-v1', count: 1 },
    ]);
    expect(Object.keys(manager).sort()).toEqual([
      'existingResults',
      'nextCohort',
      'preservedBindings',
    ]);
  });
  it('trusted next-cohort change invalidates the saved preview before HR save', async () => {
    const created = await app().execute('hr', {
      action: 'create',
      input: command(),
    });
    expect(created.status).toBe('success');
    if (created.status !== 'success') return;
    const revision = selectionRevisionSchema.parse(created.result);
    const changed = createNativeSelectionLifecycle(db(), {
      nextCohort: { ...next, name: '改名的下一期（演示）' },
      clock,
    });
    const result = await changed.execute('hr', {
      action: 'save',
      input: {
        operationId: 'changed-next',
        draftId: revision.id,
        expectedRevision: revision.revision,
        reason: 'HR核对（演示）',
        changes: [
          {
            kind: 'add',
            after: { id: 'extra', title: '新增（演示）', description: '说明' },
          },
        ],
      },
    });
    expect(result.status).toBe('conflict');
    expect(
      (await db().select().from(selectionRevisions))[0].record.revision
        .humanVersion,
    ).toBeNull();
  });
});

describe('current authority and binding assembly', () => {
  it('a changed account-to-person binding cannot reuse an earlier authority', async () => {
    await expect(
      db().transaction(async (tx) => {
        const who = await loadSelectionAuthority(tx, 'hr', clock);
        await tx
          .update(accountBindings)
          .set({ personId: 'rater' })
          .where(eq(accountBindings.accountId, 'hr'));
        return readNativeSelectionImpact(tx, who, next, ['cohort']);
      }),
    ).rejects.toMatchObject({ status: 'forbidden' });
  });
  it('an absent scope is unavailable rather than a complete zero-impact preview', async () => {
    await expect(
      db().transaction(async (tx) => {
        const who = await loadSelectionAuthority(tx, 'hr', clock);
        return readNativeSelectionImpact(tx, who, next, []);
      }),
    ).rejects.toThrow('Selection persistence unavailable');
  });
  it('native store binding consumes the actual cohort and replays its stored version', async () => {
    const service = app();
    const bound = await service.store.ports.transact(
      {
        category: 'xe_selection',
        accountId: 'manager',
        operationId: 'existing-binding',
      },
      (tx) => service.store.bindCohort(tx, 'manager', 'cohort', clock),
    );
    expect(bound.cohort).toEqual({
      id: 'cohort',
      name: '合成持久化测试期（演示）',
    });
    expect(bound.standardVersionId).toBe('xe-select-v1');
    const result = await readSelectionCohortVersion(
      service.store.ports,
      'manager',
      { cohortId: 'cohort' },
      clock,
    );
    expect(result.status).toBe('success');
  });
  it('native store does not invent a missing cohort during binding', async () => {
    const service = app();
    await expect(
      service.store.ports.transact(
        {
          category: 'xe_selection',
          accountId: 'manager',
          operationId: 'missing-binding',
        },
        (tx) => service.store.bindCohort(tx, 'manager', 'absent', clock),
      ),
    ).rejects.toMatchObject({ status: 'not_found' });
  });
});
