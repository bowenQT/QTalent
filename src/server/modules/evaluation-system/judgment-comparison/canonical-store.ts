import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Transaction } from '@/server/db/client';
import {
  canonicalComparisonJson,
  CanonicalComparisonError,
  validateCanonicalComparisonImport,
} from './canonical-input';

const fail = (code: 'incomplete' | 'invalid_reference' | 'conflict'): never => {
  throw new CanonicalComparisonError(code);
};
const same = (a: unknown, b: unknown) =>
  canonicalComparisonJson(a) === canonicalComparisonJson(b);
const encoded = (value: unknown) =>
  sql`${canonicalComparisonJson(value)}::jsonb`;
async function jsonRows(tx: Transaction, statement: SQL): Promise<unknown[]> {
  return (await tx.execute<{ data: unknown }>(statement)).rows.map(
    (row) => row.data,
  );
}
export async function lockCanonicalComparisonBatch(
  tx: Transaction,
  batchId: string,
) {
  if (!batchId || batchId.trim() !== batchId)
    throw new CanonicalComparisonError('invalid_input');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'comparison-batch:' + batchId}, 0))`,
  );
}

async function mappingRow(tx: Transaction, versionId: string) {
  return jsonRows(
    tx,
    sql`select jsonb_build_object('versionId', version_id,
    'frontScaleId', front_scale_id,'backScaleId',back_scale_id,'rows',rows,
    'confirmedById',confirmed_by,'confirmedAt',confirmed_at,'sourceCommit',source_commit,
    'sourceFileSha256',source_file_sha256,'nature',nature) as data
    from evaluation_comparison_mappings where version_id=${versionId} for share`,
  );
}
const batchEnvelope = z.strictObject({
  facts: z.unknown(),
  factsDigest: z.string().regex(/^[0-9a-f]{64}$/),
  importedAt: z.string().datetime({ offset: true }),
});
const caseEnvelope = z.strictObject({
  id: z.string(),
  personId: z.string(),
  judgment: z.unknown(),
  frontNodeId: z.string(),
  backNodeId: z.string(),
  work: z.unknown(),
});
const stageEnvelope = z.strictObject({
  caseId: z.string(),
  side: z.enum(['front', 'back']),
  state: z.enum(['present', 'missing']),
  missingReason: z.string().nullable(),
  fragmentId: z.string().nullable(),
  originalVersionId: z.string().nullable(),
  judgmentId: z.string().nullable(),
  sourceStandardReference: z.string().nullable(),
  scaleId: z.string().nullable(),
  grade: z.string().nullable(),
  evaluatorId: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  confirmation: z.string().nullable(),
});
export async function readCanonicalComparisonRows(
  tx: Transaction,
  batchId: string,
) {
  await lockCanonicalComparisonBatch(tx, batchId);
  const batches = await jsonRows(
    tx,
    sql`select jsonb_build_object('facts',jsonb_build_object(
    'id',id,'name',name,'cohortId',cohort_id,'mappingVersionId',mapping_version_id,
    'sourceCommit',source_commit,'contractSha',contract_sha,'fixtureVersion',fixture_version,
    'inputFileHashes',input_file_hashes,'inputCaseCount',input_case_count,'nature',nature),
    'factsDigest',facts_digest,'importedAt',imported_at) as data
    from evaluation_comparison_batches where id=${batchId} for share`,
  );
  if (batches.length === 0) return null;
  const envelope = batchEnvelope.safeParse(batches[0]);
  if (batches.length !== 1 || !envelope.success) return fail('incomplete');
  const batch = z
    .object({ mappingVersionId: z.string() })
    .safeParse(envelope.data.facts);
  if (!batch.success) return fail('incomplete');
  const mappings = await mappingRow(tx, batch.data.mappingVersionId);
  if (mappings.length !== 1) return fail('incomplete');
  const caseData = await jsonRows(
    tx,
    sql`select jsonb_build_object('id',id,'personId',person_id,
    'judgment',jsonb_build_object('id',judgment_id,'name',judgment_name),
    'frontNodeId',front_node_id,'backNodeId',back_node_id,
    'work',case when work_kind='individual' and team_id is null then jsonb_build_object('kind',work_kind,'workId',work_id)
      else jsonb_build_object('kind',work_kind,'workId',work_id,'teamId',team_id) end) as data
    from evaluation_comparison_cases where batch_id=${batchId} order by id for share`,
  );
  const stageData = await jsonRows(
    tx,
    sql`select jsonb_build_object('caseId',case_id,'side',side,'state',state,
    'missingReason',missing_reason,'fragmentId',fragment_id,'originalVersionId',original_version_id,
    'judgmentId',judgment_id,'sourceStandardReference',source_standard_reference,'scaleId',scale_id,
    'grade',grade,'evaluatorId',evaluator_id,'evaluatedAt',evaluated_at,'confirmation',confirmation) as data
    from evaluation_comparison_stages where batch_id=${batchId} order by case_id,side for share`,
  );
  const cases = z.array(caseEnvelope).safeParse(caseData);
  const stages = z.array(stageEnvelope).safeParse(stageData);
  if (
    !cases.success ||
    !stages.success ||
    stages.data.length !== cases.data.length * 2
  )
    return fail('incomplete');
  const marks = await jsonRows(
    tx,
    sql`select jsonb_build_object('id',m.id,'caseId',m.case_id,'batchId',c.batch_id,
    'personId',c.person_id,'frontNodeId',c.front_node_id,'backNodeId',c.back_node_id,
    'reason',m.reason,'markedById',m.marked_by,'markedAt',m.marked_at,
    'sourceFileSha256',m.source_file_sha256,'nature',m.nature) as data
    from evaluation_comparison_manual_marks m join evaluation_comparison_cases c on c.id=m.case_id
    where c.batch_id=${batchId} order by m.id for share of m,c`,
  );
  return {
    batch: envelope.data.facts,
    mapping: mappings[0],
    cases: cases.data,
    stages: stages.data,
    manualMarks: marks,
    factsDigest: envelope.data.factsDigest,
    importedAt: envelope.data.importedAt,
  };
}
/** Internal row writer. Only the cross-domain usecase may finalize an import. */
export async function insertCanonicalComparisonRows(
  tx: Transaction,
  input: unknown,
  factsDigest: string,
): Promise<void> {
  const facts = validateCanonicalComparisonImport(input);
  if (!/^[0-9a-f]{64}$/.test(factsDigest))
    throw new CanonicalComparisonError('invalid_input');
  await lockCanonicalComparisonBatch(tx, facts.batch.id);
  const map = facts.mapping;
  // Mapping versions are immutable and shared across batches. Lock their own key
  // before checking/inserting, instead of swallowing a racing unique violation.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'comparison-mapping:' + map.versionId}, 0))`,
  );
  const maps = await mappingRow(tx, map.versionId);
  if (maps.length > 0) {
    if (maps.length !== 1 || !same(maps[0], map)) return fail('conflict');
  } else
    await tx.execute(sql`insert into evaluation_comparison_mappings
    (version_id,front_scale_id,back_scale_id,rows,confirmed_by,confirmed_at,source_commit,source_file_sha256,nature)
    values (${map.versionId},${map.frontScaleId},${map.backScaleId},${encoded(map.rows)},${map.confirmedById},${map.confirmedAt},${map.sourceCommit},${map.sourceFileSha256},${map.nature})`);
  const b = facts.batch;
  await tx.execute(sql`insert into evaluation_comparison_batches
    (id,name,cohort_id,mapping_version_id,source_commit,contract_sha,fixture_version,input_file_hashes,input_case_count,facts_digest,imported_at,nature)
    values (${b.id},${b.name},${b.cohortId},${b.mappingVersionId},${b.sourceCommit},${b.contractSha},${b.fixtureVersion},${encoded(b.inputFileHashes)},${b.inputCaseCount},${factsDigest},clock_timestamp(),${b.nature})`);
  for (const unit of facts.cases) {
    await tx.execute(sql`insert into evaluation_comparison_cases
      (id,batch_id,person_id,judgment_id,judgment_name,front_node_id,back_node_id,work_kind,work_id,team_id)
      values (${unit.id},${b.id},${unit.personId},${unit.judgment.id},${unit.judgment.name},${unit.frontNodeId},${unit.backNodeId},${unit.work.kind},${unit.work.workId},${unit.work.kind === 'team' ? unit.work.teamId : null})`);
    for (const side of ['front', 'back'] as const) {
      const stage = unit[side];
      const present = stage.state === 'present' ? stage : null;
      await tx.execute(sql`insert into evaluation_comparison_stages
        (case_id,side,batch_id,state,missing_reason,fragment_id,original_version_id,judgment_id,source_standard_reference,scale_id,grade,evaluator_id,evaluated_at,confirmation)
        values (${unit.id},${side},${b.id},${stage.state},${stage.state === 'missing' ? stage.reason : null},${stage.source?.fragmentId ?? null},${stage.source?.originalVersionId ?? null},${present?.judgmentId ?? null},${present?.sourceStandardReference ?? null},${present?.scaleId ?? null},${present?.grade ?? null},${present?.evaluatorId ?? null},${present?.evaluatedAt ?? null},${present?.confirmation ?? null})`);
    }
  }
  for (const mark of facts.manualMarks)
    await tx.execute(sql`insert into evaluation_comparison_manual_marks
    (id,case_id,reason,marked_by,marked_at,nature,source_file_sha256)
    values (${mark.id},${mark.caseId},${mark.reason},${mark.markedById},${mark.markedAt},${mark.nature},${mark.sourceFileSha256})`);
}
