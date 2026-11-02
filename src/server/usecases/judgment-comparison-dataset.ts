import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  comparisonBatchSchema,
  comparisonMappingSchema,
  comparisonStageSchema,
} from '../../contracts/judgment-comparison';
import { confirmedStandardAttributionSchema } from '../../contracts/standard-attribution';
import type { Transaction } from '../db/client';
import { people } from '../modules/directory';
import { cohorts } from '../modules/programs';
import { fragments, originals, originalVersions } from '../modules/records';
import {
  comparisonBatches,
  standardAttributions,
  type CanonicalComparisonSnapshot,
  type CanonicalComparisonStage,
} from '../modules/evaluation-system';
import type {
  ComparisonBatch,
  ComparisonDataset,
  ComparisonFacts,
} from '../modules/evaluation-system/judgment-comparison/ports';
import {
  SelectionPersistenceUnavailableError,
  readStoredSelectionCohortBinding,
} from '../modules/evaluation-system/selection/postgres';
import { readCanonicalComparisonBatch } from './judgment-comparison-canonical';

const unavailable = (): never => {
  throw new SelectionPersistenceUnavailableError();
};

async function actualCohort(tx: Transaction, id: string) {
  const [value] = await tx
    .select({ id: cohorts.id, name: cohorts.name })
    .from(cohorts)
    .where(eq(cohorts.id, id));
  return value ?? unavailable();
}

/** A read-only transaction cannot take row locks. Callers that need one snapshot
 * run at Repeatable Read; the canonical digest still rejects a torn read. */
export async function readCanonicalForTransaction(
  tx: Transaction,
  batchId: string,
) {
  const mode = await tx.execute<{ readOnly: string }>(
    sql`select current_setting('transaction_read_only') as "readOnly"`,
  );
  return readCanonicalComparisonBatch(tx, batchId, {
    lock: mode.rows[0]?.readOnly !== 'on',
  });
}

/** Human-confirmed 921 attributions of a batch, one fact per cited case and
 * category. The manager summary keeps only those whose case it may read. */
export async function readConfirmedAttributions(
  tx: Transaction,
  batchId: string,
): Promise<ComparisonDataset['confirmedAttributions']> {
  const rows = await tx
    .select({ payload: standardAttributions.payload })
    .from(standardAttributions)
    .where(eq(standardAttributions.batchId, batchId));
  const facts = new Map<
    string,
    ComparisonDataset['confirmedAttributions'][number]
  >();
  for (const row of rows) {
    const value = confirmedStandardAttributionSchema.parse(row.payload);
    if (value.batchId !== batchId) unavailable();
    for (const { caseId } of value.citations)
      for (const category of value.categories)
        facts.set(JSON.stringify([caseId, category]), { caseId, category });
  }
  return [...facts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, fact]) => fact);
}

/**
 * The one conversion from 919 canonical facts to the comparison reader's input.
 * Server-private and complete: every Web read goes through `projectComparison`
 * with the caller's current access, which filters cases, raters and numbers.
 * Cases carry no outcome; the reader computes it.
 */
export async function comparisonDatasetFromSnapshot(
  tx: Transaction,
  snapshot: CanonicalComparisonSnapshot,
): Promise<ComparisonDataset> {
  const { facts } = snapshot;
  const cohort = await actualCohort(tx, facts.batch.cohortId);
  const personIds = [
    ...new Set([
      facts.mapping.confirmedById,
      ...facts.manualMarks.map((m) => m.markedById),
      ...facts.cases.flatMap((unit) => [
        unit.personId,
        ...(unit.front.state === 'present' ? [unit.front.evaluatorId] : []),
        ...(unit.back.state === 'present' ? [unit.back.evaluatorId] : []),
      ]),
    ]),
  ];
  const persons = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, personIds));
  const actor = (id: string) =>
    persons.find((p) => p.id === id) ?? unavailable();
  const sourceIds = [
    ...new Set(
      facts.cases
        .flatMap((unit) => [
          unit.front.source?.fragmentId,
          unit.back.source?.fragmentId,
        ])
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const rows = sourceIds.length
    ? await tx
        .select({
          id: fragments.id,
          versionId: fragments.originalVersionId,
          excerpt: fragments.excerpt,
          location: fragments.location,
          title: originals.title,
        })
        .from(fragments)
        .innerJoin(
          originalVersions,
          eq(originalVersions.id, fragments.originalVersionId),
        )
        .innerJoin(originals, eq(originals.id, originalVersions.originalId))
        .where(inArray(fragments.id, sourceIds))
    : [];
  function stage(value: CanonicalComparisonStage, nodeId: string) {
    if (value.state === 'missing')
      return comparisonStageSchema.parse({
        state: 'missing',
        reason: value.reason,
      });
    const source =
      rows.find(
        (row) =>
          row.id === value.source.fragmentId &&
          row.versionId === value.source.originalVersionId,
      ) ?? unavailable();
    return comparisonStageSchema.parse({
      state: 'present',
      judgment: {
        judgmentId: value.judgmentId,
        nodeId,
        cohortId: cohort.id,
        standardVersionId: value.sourceStandardReference,
        scaleId: value.scaleId,
        grade: value.grade,
        evaluator: actor(value.evaluatorId),
        evaluatedAt: value.evaluatedAt,
        confirmation: value.confirmation,
        row: {
          personId: value.source.rowPersonId,
          row: value.source.row,
          source: {
            fragmentId: source.id,
            originalVersionId: source.versionId,
            location: source.location,
            excerpt: source.excerpt,
            originalTitle: source.title,
            recordedByName: null,
            sourceCategory: 'original',
            sourceType: 'spreadsheet',
            demo: facts.batch.nature === 'demo_rebuilt',
          },
        },
      },
    });
  }
  const mapping = comparisonMappingSchema.parse({
    versionId: facts.mapping.versionId,
    frontScaleId: facts.mapping.frontScaleId,
    backScaleId: facts.mapping.backScaleId,
    rows: facts.mapping.rows,
    confirmedBy: actor(facts.mapping.confirmedById),
    confirmedAt: facts.mapping.confirmedAt,
  });
  const cases = facts.cases.map((unit): ComparisonFacts => {
    const mark = facts.manualMarks.find((m) => m.caseId === unit.id);
    return {
      id: unit.id,
      batchId: facts.batch.id,
      person: actor(unit.personId),
      judgment: unit.judgment,
      cohort,
      selectionStandardVersionId: snapshot.selectionStandardVersionId,
      mappingVersionId: facts.mapping.versionId,
      frontNodeId: unit.frontNodeId,
      backNodeId: unit.backNodeId,
      work: unit.work,
      front: stage(unit.front, unit.frontNodeId),
      back: stage(unit.back, unit.backNodeId),
      ...(mark
        ? {
            nonComparable: {
              reason: mark.reason,
              markedBy: actor(mark.markedById),
              markedAt: mark.markedAt,
            },
          }
        : {}),
    };
  });
  return {
    batch: comparisonBatchSchema.parse({
      id: facts.batch.id,
      name: facts.batch.name,
      cohort,
      selectionStandardVersionId: snapshot.selectionStandardVersionId,
      mappingVersionId: facts.mapping.versionId,
    }),
    mapping,
    cases,
    confirmedAttributions: await readConfirmedAttributions(tx, facts.batch.id),
  };
}

/** Null only when no such batch is stored; a broken or unconnected source throws. */
export async function readComparisonDataset(
  tx: Transaction,
  batchId: string,
): Promise<ComparisonDataset | null> {
  const snapshot = await readCanonicalForTransaction(tx, batchId);
  return snapshot && comparisonDatasetFromSnapshot(tx, snapshot);
}

/** Batch metadata of the given cohorts, newest import first. The caller passes
 * the cohorts its current access may see (`comparisonCohortIds`); a batch's
 * cohort is always bound, so a missing binding is a broken store, not "none". */
export async function listComparisonBatches(
  tx: Transaction,
  cohortIds: readonly string[],
): Promise<ComparisonBatch[]> {
  const ids = [...new Set(cohortIds)];
  if (!ids.length) return [];
  const rows = await tx
    .select({
      id: comparisonBatches.id,
      name: comparisonBatches.name,
      mappingVersionId: comparisonBatches.mappingVersionId,
      cohortId: cohorts.id,
      cohortName: cohorts.name,
    })
    .from(comparisonBatches)
    .innerJoin(cohorts, eq(cohorts.id, comparisonBatches.cohortId))
    .where(inArray(comparisonBatches.cohortId, ids))
    .orderBy(
      sql`${comparisonBatches.importedAt} desc`,
      asc(comparisonBatches.id),
    );
  const versions = new Map<string, string>();
  for (const cohortId of new Set(rows.map((row) => row.cohortId))) {
    const binding =
      (await readStoredSelectionCohortBinding(tx, cohortId)) ?? unavailable();
    versions.set(cohortId, binding.standardVersionId);
  }
  return rows.map((row) =>
    comparisonBatchSchema.parse({
      id: row.id,
      name: row.name,
      cohort: { id: row.cohortId, name: row.cohortName },
      selectionStandardVersionId: versions.get(row.cohortId),
      mappingVersionId: row.mappingVersionId,
    }),
  );
}
