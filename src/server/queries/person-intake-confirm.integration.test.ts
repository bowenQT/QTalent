import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { eq } from 'drizzle-orm';
import { expect, it } from 'vitest';
import {
  nativeDatabase,
  seedNativeRules,
  seedNativeCase,
  syntheticBatchClient,
  businessAt,
  wallAt,
} from '../../../tests/fixtures/bow-845/native';
import { createRecordArrangeApplication } from '../usecases/record-arrange-application';
import { saveRecordDraft } from '../usecases/record-save';
import { arrangeInputs, recordDrafts } from '../modules/records';
import { enrollments, evaluationRelations } from '../modules/programs';
import { grants } from '../modules/directory';
import { recordArrangeQueue } from '../jobs/record-arrange';
import { loadPersonData, talentSources } from './person-data';
import { sourceFromData } from './sources';
import { personFromData } from './person-projection';
import { quickViewFromData } from './people';
import { buildAuthorizedModelInput } from '../authz/talent';
import { createPostgresTalentExportStore } from '../usecases/talent-export/postgres';
import { projectPersonExport } from '../usecases/talent-export/policy';

it('actual arranged A-only draft retains shared A/B intake authority after save and revocation', async () => {
  const connection = await nativeDatabase();
  const boss = new PgBoss({ connectionString: connection.testUrl });
  boss.on('error', () => undefined);
  try {
    await seedNativeRules(connection.db);
    const h = await seedNativeCase(connection.db);
    await boss.start();
    await boss.createQueue(recordArrangeQueue, { retryLimit: 0 });
    const model = syntheticBatchClient();
    const app = createRecordArrangeApplication({
      db: connection.db,
      boss,
      client: model.client,
      businessNow: () => businessAt,
      now: () => new Date(wallAt),
    });
    const created = await app.requests.create(h.account, h.input);
    if (created.status !== 'success') throw new Error('Native intake required');
    const [intake] = await connection.db
      .select()
      .from(arrangeInputs)
      .where(eq(arrangeInputs.batchId, created.result.batchId));
    expect(await app.runner.run(intake.jobId, 1)).toBe('awaiting_manual');
    const [stored] = await connection.db
      .select()
      .from(recordDrafts)
      .where(eq(recordDrafts.batchId, created.result.batchId));
    expect(stored.draft.personIds).toEqual([h.target]);
    // Native immutable intake provenance can be more restrictive than AI attribution.
    const contexts = structuredClone(intake.sourceContexts);
    contexts[0].subjects.push({
      personId: h.other,
      evaluationNodeId: h.otherNode,
      cohortId: h.cohort,
    });
    await connection.db
      .update(arrangeInputs)
      .set({ sourceContexts: contexts })
      .where(eq(arrangeInputs.id, intake.id));
    const relation = randomUUID();
    await connection.db.insert(evaluationRelations).values({
      id: relation,
      evaluationNodeId: h.otherNode,
      personId: h.other,
      evaluatorId: h.evaluator,
      kind: 'judge',
      validFrom: '2026-01-01T00:00:00.000Z',
    });
    const saved = await saveRecordDraft(
      connection.db,
      h.account,
      {
        operation_id: randomUUID(),
        expected_revision: stored.revision,
        draftId: stored.draftId,
        personIds: stored.draft.personIds,
        projectId: stored.draft.projectId,
        sbi: stored.draft.sbi,
        // One confirmed score gives the export a row to withhold later.
        decisions: stored.draft.scores.map((score, index) =>
          index === 0
            ? {
                personId: score.personId,
                dimensionId: score.dimensionId,
                action: 'edit' as const,
                value: 3 as const,
                reason: '评价人按原话给分（演示）',
              }
            : {
                personId: score.personId,
                dimensionId: score.dimensionId,
                action: 'unknown' as const,
                reason: '资料不足（演示）',
              },
        ),
      },
      { businessNow: () => businessAt, wallNow: () => wallAt },
    );
    expect(saved.result.events.map((row) => row.personId)).toEqual([h.target]);
    const reference = stored.draft.sourceReferences[0];
    const before = await loadPersonData(connection.db, h.account, businessAt);
    expect(await sourceFromData(before, reference)).toHaveProperty(
      'status',
      'success',
    );
    await connection.db
      .update(evaluationRelations)
      .set({ revokedAt: businessAt })
      .where(eq(evaluationRelations.id, relation));
    const after = await loadPersonData(connection.db, h.account, businessAt);
    expect(await sourceFromData(after, reference)).toHaveProperty(
      'status',
      'not_found',
    );
    expect(JSON.stringify(await personFromData(after, h.target))).not.toContain(
      reference.fragmentId,
    );
    expect(
      JSON.stringify(await quickViewFromData(after, h.target)),
    ).not.toContain(reference.fragmentId);
    const subject = {
      personId: h.target,
      evaluationNodeId: h.node,
      cohortId: h.cohort,
    };
    expect(
      await buildAuthorizedModelInput(async () => ({
        context: after.context,
        sources: talentSources(after),
        records: [
          {
            id: 'demo-derived',
            subject,
            kind: 'evaluation',
            fields: [
              {
                name: 'text',
                kind: 'evaluation',
                value: '演示事实',
                subjects: [],
                sources: [reference],
              },
            ],
          },
        ],
      })),
    ).toEqual({ items: [] });
    expect(model.calls()).toBe(1);

    // Export reads its own snapshot and must apply the same intake restriction.
    await connection.db.insert(grants).values({
      id: h.prefix + '-hr',
      accountId: h.account,
      role: 'hr',
      scope: 'cohort',
      cohortId: h.cohort,
      validFrom: '2026-01-01',
    });
    const exportStore = createPostgresTalentExportStore(connection.db);
    const exported = () =>
      exportStore.transaction(async (tx) =>
        JSON.stringify(
          await projectPersonExport(
            await exportStore.readSnapshot(tx, h.account, businessAt),
            h.target,
          ),
        ),
      );
    const [eventId] = saved.result.events.map((row) => row.eventId);
    // While B is enrolled, this HR reads both A and B and exports the score.
    const otherEnrollment = h.prefix + '-other-enrollment';
    await connection.db.insert(enrollments).values({
      id: otherEnrollment,
      personId: h.other,
      cohortId: h.cohort,
      confirmed: true,
      validFrom: '2026-01-01',
    });
    expect(await exported()).toContain(eventId);
    // B leaves the cohort: only the intake subject B still restricts the source.
    await connection.db
      .update(enrollments)
      .set({ validTo: '2026-01-02' })
      .where(eq(enrollments.id, otherEnrollment));
    const hrAfter = await loadPersonData(connection.db, h.account, businessAt);
    expect(await sourceFromData(hrAfter, reference)).toHaveProperty(
      'status',
      'not_found',
    );
    const exportedAfter = await exported();
    expect(exportedAfter).not.toContain(eventId);
    expect(exportedAfter).not.toContain(reference.fragmentId);
  } finally {
    await boss.stop();
    await connection.close();
  }
}, 30000);
