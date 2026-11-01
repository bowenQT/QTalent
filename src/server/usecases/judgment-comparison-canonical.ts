import { createHash } from 'node:crypto';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import {
  selectionCohortBindingSchema,
  selectionStandardContentSchema,
} from '@/contracts/selection-standard';
import { z } from 'zod';
import type { Transaction } from '@/server/db/client';
import { people } from '../modules/directory';
import { evaluationNodes, evaluationNodeSubjects } from '../modules/programs';
import { originals, originalVersions, fragments } from '../modules/records';
import {
  canonicalComparisonJson,
  canonicalInputFiles,
  CanonicalComparisonError,
  validateCanonicalComparisonImport,
  lockCanonicalComparisonBatch,
  readCanonicalComparisonRows,
  insertCanonicalComparisonRows,
  type CanonicalComparisonImport,
  type CanonicalComparisonSnapshot,
  type CanonicalComparisonStage,
} from '../modules/evaluation-system';
const fail = (code: 'incomplete' | 'invalid_reference' | 'conflict'): never => {
  throw new CanonicalComparisonError(code);
};
const digest = (value: unknown) =>
  createHash('sha256').update(canonicalComparisonJson(value)).digest('hex');
const same = (a: unknown, b: unknown) =>
  canonicalComparisonJson(a) === canonicalComparisonJson(b);
async function jsonRows(tx: Transaction, statement: SQL): Promise<unknown[]> {
  return (await tx.execute<{ data: unknown }>(statement)).rows.map(
    (row) => row.data,
  );
}
// X1 owns the actual schema. These queries consume the exact frozen 918 tables;
// no missing-table catch, dynamic DDL or copied lifecycle/current-version state.
async function readCanonicalSelectionBinding(
  tx: Transaction,
  cohortId: string,
) {
  const rows = await jsonRows(
    tx,
    sql`select jsonb_build_object(
    'cohortId', b.cohort_id, 'versionId', b.version_id, 'binding', b.binding,
    'boundAtMatches', b.bound_at = (b.binding->>'boundAt')::timestamptz,
    'content', c.content, 'origin', c.origin)
    as data from evaluation_selection_cohort_bindings b
    join evaluation_selection_version_content c on c.version_id=b.version_id
    join evaluation_rule_versions v on v.id=c.version_id
    where b.cohort_id=${cohortId} for share of b,c,v`,
  );
  const shape = z.strictObject({
    cohortId: z.string(),
    versionId: z.string(),
    binding: selectionCohortBindingSchema,
    boundAtMatches: z.literal(true),
    content: selectionStandardContentSchema,
    origin: z.enum(['baseline', 'publication']),
  });
  const value = shape.safeParse(rows[0]);
  if (rows.length !== 1 || !value.success) return fail('invalid_reference');
  const data = value.data;
  if (
    data.cohortId !== cohortId ||
    data.binding.cohort.id !== cohortId ||
    data.versionId !== data.binding.standardVersionId
  )
    return fail('invalid_reference');
  return data;
}

const locationSchema = z.strictObject({
  kind: z.literal('spreadsheet'),
  sheet: z.string().trim().min(1),
  cell: z.string(),
});
function sourceRow(location: unknown): number {
  const parsed = locationSchema.safeParse(location);
  if (!parsed.success) return fail('invalid_reference');
  const match = /^([A-Z]+)([1-9][0-9]*)(?::([A-Z]+)([1-9][0-9]*))?$/.exec(
    parsed.data.cell,
  );
  if (!match || (match[4] !== undefined && match[4] !== match[2]))
    return fail('invalid_reference');
  const col = (name: string) =>
    [...name].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const row = Number(match[2]);
  if (
    !Number.isSafeInteger(row) ||
    row > 1_048_576 ||
    col(match[1]) > 16_384 ||
    (match[3] !== undefined &&
      (col(match[3]) < col(match[1]) || col(match[3]) > 16_384))
  )
    return fail('invalid_reference');
  return row;
}
async function sources(tx: Transaction, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      fragmentId: fragments.id,
      originalVersionId: fragments.originalVersionId,
      location: fragments.location,
      excerpt: fragments.excerpt,
      originalId: originals.id,
      title: originals.title,
      kind: originals.kind,
      displayNotice: originals.displayNotice,
      version: originalVersions.version,
      contentDigest: originalVersions.contentDigest,
      sourceCommit: originalVersions.sourceCommit,
      sourceBlob: originalVersions.sourceBlob,
      sourcePath: originalVersions.sourcePath,
    })
    .from(fragments)
    .innerJoin(
      originalVersions,
      eq(originalVersions.id, fragments.originalVersionId),
    )
    .innerJoin(originals, eq(originals.id, originalVersions.originalId))
    .where(inArray(fragments.id, [...new Set(ids)].sort()))
    .orderBy(fragments.id)
    .for('share');
}
type Source = Awaited<ReturnType<typeof sources>>[number];
async function references(tx: Transaction, facts: CanonicalComparisonImport) {
  const bound = await readCanonicalSelectionBinding(tx, facts.batch.cohortId);
  const ids = facts.cases
    .flatMap((unit) => [
      unit.front.source?.fragmentId,
      unit.back.source?.fragmentId,
    ])
    .filter((id): id is string => id !== undefined);
  const rows = await sources(tx, ids);
  const byId = new Map(rows.map((row) => [row.fragmentId, row]));
  if (byId.size !== new Set(ids).size) return fail('invalid_reference');
  const personIds = [
    ...new Set([
      facts.mapping.confirmedById,
      ...facts.manualMarks.map((mark) => mark.markedById),
      ...facts.cases.flatMap((unit) => [
        unit.personId,
        ...(unit.front.state === 'present' ? [unit.front.evaluatorId] : []),
        ...(unit.back.state === 'present' ? [unit.back.evaluatorId] : []),
      ]),
    ]),
  ].sort();
  const persons = await tx
    .select({ id: people.id })
    .from(people)
    .where(inArray(people.id, personIds))
    .orderBy(people.id)
    .for('share');
  if (persons.length !== personIds.length) return fail('invalid_reference');
  const nodeIds = [
    ...new Set(
      facts.cases.flatMap((unit) => [unit.frontNodeId, unit.backNodeId]),
    ),
  ].sort();
  const nodes = await tx
    .select()
    .from(evaluationNodes)
    .where(inArray(evaluationNodes.id, nodeIds))
    .orderBy(evaluationNodes.id)
    .for('share');
  if (
    nodes.length !== nodeIds.length ||
    nodes.some((node) => node.cohortId !== facts.batch.cohortId)
  )
    return fail('invalid_reference');
  const subjects = await tx
    .select()
    .from(evaluationNodeSubjects)
    .where(
      and(
        inArray(evaluationNodeSubjects.evaluationNodeId, nodeIds),
        inArray(evaluationNodeSubjects.personId, personIds),
      ),
    )
    .orderBy(
      evaluationNodeSubjects.evaluationNodeId,
      evaluationNodeSubjects.personId,
    )
    .for('share');
  for (const unit of facts.cases) {
    for (const side of ['front', 'back'] as const) {
      const stage = unit[side];
      if (
        !subjects.some(
          (item) =>
            item.evaluationNodeId ===
              (side === 'front' ? unit.frontNodeId : unit.backNodeId) &&
            item.personId === unit.personId,
        )
      )
        return fail('invalid_reference');
      if (
        side === 'front' &&
        stage.state === 'present' &&
        stage.sourceStandardReference !== bound.versionId
      )
        return fail('invalid_reference');
      if (!stage.source) continue;
      const source = byId.get(stage.source.fragmentId);
      const path =
        side === 'front' ? canonicalInputFiles[6] : canonicalInputFiles[7];
      if (
        !source ||
        source.originalVersionId !== stage.source.originalVersionId ||
        source.kind !== 'original' ||
        source.sourceCommit !== facts.batch.sourceCommit ||
        source.sourcePath !== path ||
        source.contentDigest !== facts.batch.inputFileHashes[path] ||
        sourceRow(source.location) !== stage.source.row ||
        !source.excerpt.trim() ||
        !source.displayNotice?.includes('演示')
      )
        return fail('invalid_reference');
    }
    if (
      unit.front.source &&
      unit.back.source &&
      byId.get(unit.front.source.fragmentId)!.originalId ===
        byId.get(unit.back.source.fragmentId)!.originalId
    )
      return fail('invalid_reference');
  }
  return { bound, rows };
}

function unpackStage(
  row: NonNullable<
    Awaited<ReturnType<typeof readCanonicalComparisonRows>>
  >['stages'][number],
  personId: string,
  sourceMap: Map<string, Source>,
): CanonicalComparisonStage {
  if ((row.fragmentId === null) !== (row.originalVersionId === null))
    return fail('incomplete');
  let source = null;
  if (row.fragmentId !== null) {
    const item = sourceMap.get(row.fragmentId);
    if (!item || item.originalVersionId !== row.originalVersionId)
      return fail('incomplete');
    source = {
      fragmentId: item.fragmentId,
      originalVersionId: item.originalVersionId,
      rowPersonId: personId,
      row: sourceRow(item.location),
    };
  }
  if (row.state === 'missing') {
    if (
      row.missingReason === null ||
      [
        row.judgmentId,
        row.sourceStandardReference,
        row.scaleId,
        row.grade,
        row.evaluatorId,
        row.evaluatedAt,
        row.confirmation,
      ].some((value) => value !== null)
    )
      return fail('incomplete');
    return { state: 'missing', reason: row.missingReason, source };
  }
  if (
    row.missingReason !== null ||
    !source ||
    row.judgmentId === null ||
    row.sourceStandardReference === null ||
    row.scaleId === null ||
    row.grade === null ||
    row.evaluatorId === null ||
    row.evaluatedAt === null ||
    row.confirmation !== 'human_confirmed'
  )
    return fail('incomplete');
  return {
    state: 'present',
    source,
    judgmentId: row.judgmentId,
    sourceStandardReference: row.sourceStandardReference,
    scaleId: row.scaleId,
    grade: row.grade,
    evaluatorId: row.evaluatorId,
    evaluatedAt: row.evaluatedAt,
    confirmation: row.confirmation,
  };
}

/** Server-private complete facts. Never pass directly to a Web or model caller. */
export async function readCanonicalComparisonBatch(
  tx: Transaction,
  batchId: string,
): Promise<CanonicalComparisonSnapshot | null> {
  const stored = await readCanonicalComparisonRows(tx, batchId);
  if (!stored) return null;
  const sourceRows = await sources(
    tx,
    stored.stages
      .map((stage) => stage.fragmentId)
      .filter((id): id is string => id !== null),
  );
  const sourceMap = new Map(sourceRows.map((row) => [row.fragmentId, row]));
  const units = stored.cases.map((unit) => {
    const matching = stored.stages.filter((stage) => stage.caseId === unit.id);
    const front = matching.find((stage) => stage.side === 'front');
    const back = matching.find((stage) => stage.side === 'back');
    if (matching.length !== 2 || !front || !back) return fail('incomplete');
    return {
      ...unit,
      front: unpackStage(front, unit.personId, sourceMap),
      back: unpackStage(back, unit.personId, sourceMap),
    };
  });
  let facts: CanonicalComparisonImport;
  try {
    facts = validateCanonicalComparisonImport({
      batch: stored.batch,
      mapping: stored.mapping,
      cases: units,
      manualMarks: stored.manualMarks,
    });
  } catch (error) {
    if (error instanceof CanonicalComparisonError) return fail('incomplete');
    throw error;
  }
  const refs = await references(tx, facts);
  const factsDigest = digest({
    facts,
    sources: refs.rows,
    binding: refs.bound,
  });
  if (factsDigest !== stored.batchDigest) return fail('incomplete');
  return {
    facts,
    selectionStandardVersionId: refs.bound.versionId,
    factsDigest,
    importedAt: stored.importedAt,
  };
}

/** The caller owns rollback, the real transaction and the original registration. */
export async function writeCanonicalComparisonBatch(
  tx: Transaction,
  input: unknown,
): Promise<{
  status: 'inserted' | 'unchanged';
  batchId: string;
  factsDigest: string;
}> {
  const facts = validateCanonicalComparisonImport(input);
  await lockCanonicalComparisonBatch(tx, facts.batch.id);
  const existing = await readCanonicalComparisonBatch(tx, facts.batch.id);
  if (existing) {
    if (!same(existing.facts, facts)) return fail('conflict');
    return {
      status: 'unchanged',
      batchId: facts.batch.id,
      factsDigest: existing.factsDigest,
    };
  }
  const refs = await references(tx, facts);
  const factsDigest = digest({
    facts,
    sources: refs.rows,
    binding: refs.bound,
  });
  await insertCanonicalComparisonRows(tx, facts, factsDigest);
  const b = facts.batch;
  const saved = await readCanonicalComparisonBatch(tx, b.id);
  if (!saved || saved.factsDigest !== factsDigest || !same(saved.facts, facts))
    return fail('incomplete');
  return { status: 'inserted', batchId: b.id, factsDigest };
}
