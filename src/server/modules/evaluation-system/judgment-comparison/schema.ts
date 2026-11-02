import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  primaryKey,
  foreignKey,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { people } from '../../directory';
import {
  cohorts,
  evaluationNodes,
  evaluationNodeSubjects,
} from '../../programs';
import { fragments } from '../../records';
import { selectionCohortBindings } from '../selection/schema';
import {
  canonicalInputFiles,
  type CanonicalComparisonImport,
} from './canonical-input';

// Keep source instants verbatim, including sub-millisecond precision.
const instant = (column: AnyPgColumn) =>
  sql`${column} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?Z$' and isfinite(${column}::timestamptz)`;
export const comparisonMappings = pgTable(
  'evaluation_comparison_mappings',
  {
    versionId: text('version_id').primaryKey(),
    frontScaleId: text('front_scale_id').notNull(),
    backScaleId: text('back_scale_id').notNull(),
    rows: jsonb('rows')
      .$type<CanonicalComparisonImport['mapping']['rows']>()
      .notNull(),
    confirmedById: text('confirmed_by')
      .notNull()
      .references(() => people.id),
    confirmedAt: text('confirmed_at').notNull(),
    sourceCommit: text('source_commit').notNull(),
    sourceFileSha256: text('source_file_sha256').notNull(),
    nature: text('nature').$type<'demo_human_confirmation'>().notNull(),
  },
  (t) => [
    check(
      'comparison_mapping_identity',
      sql`${t.versionId} ~ '^map-xe-select-v[1-9][0-9]*$' and ${t.frontScaleId} ~ '[^[:space:]]' and ${t.backScaleId} ~ '[^[:space:]]' and ${t.sourceCommit} ~ '^[a-f0-9]{40}$' and ${t.sourceFileSha256} ~ '^[a-f0-9]{64}$' and ${t.nature}='demo_human_confirmation' and ${instant(t.confirmedAt)}`,
    ),
    check(
      'comparison_mapping_rows',
      sql`coalesce(jsonb_typeof(${t.rows})='array' and jsonb_array_length(${t.rows})=3 and ${sql.join(
        [0, 1, 2].map((i) => {
          const row = sql`${t.rows}->${sql.raw(String(i))}`;
          return sql`(jsonb_typeof(${row})='object' and ((${row})-ARRAY['frontGrade','frontPosition','backGrade'])='{}'::jsonb and jsonb_typeof((${row})->'frontGrade')='string' and (${row})->>'frontGrade' ~ '[^[:space:]]' and (${row})->>'frontPosition' in ('highest','middle','just_passed') and (${row})->>'backGrade' in ('不建议','继续观察','建议留用'))`;
        }),
        sql` and `,
      )} and ${sql.join(
        ['frontGrade', 'frontPosition', 'backGrade'].map(
          (key) =>
            sql`(${t.rows}->0->>${sql.raw("'" + key + "'")}<>${t.rows}->1->>${sql.raw("'" + key + "'")} and ${t.rows}->0->>${sql.raw("'" + key + "'")}<>${t.rows}->2->>${sql.raw("'" + key + "'")} and ${t.rows}->1->>${sql.raw("'" + key + "'")}<>${t.rows}->2->>${sql.raw("'" + key + "'")})`,
        ),
        sql` and `,
      )},false)`,
    ),
  ],
);
export const comparisonBatches = pgTable(
  'evaluation_comparison_batches',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    cohortId: text('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    mappingVersionId: text('mapping_version_id')
      .notNull()
      .references(() => comparisonMappings.versionId),
    sourceCommit: text('source_commit').notNull(),
    contractSha: text('contract_sha').notNull(),
    fixtureVersion: text('fixture_version').notNull(),
    inputFileHashes: jsonb('input_file_hashes')
      .$type<CanonicalComparisonImport['batch']['inputFileHashes']>()
      .notNull(),
    inputCaseCount: integer('input_case_count').notNull(),
    factsDigest: text('facts_digest').notNull(),
    importedAt: timestamp('imported_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    nature: text('nature').$type<'demo_rebuilt'>().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'comparison_batch_selection_binding_fk',
      columns: [t.cohortId],
      foreignColumns: [selectionCohortBindings.cohortId],
    }),
    check(
      'comparison_batch_identity',
      sql`${t.id} ~ '[^[:space:]]' and ${t.name} ~ '[^[:space:]]' and ${t.fixtureVersion} ~ '[^[:space:]]' and ${t.sourceCommit} ~ '^[a-f0-9]{40}$' and ${t.contractSha} ~ '^[a-f0-9]{40}$' and ${t.factsDigest} ~ '^[a-f0-9]{64}$' and ${t.inputCaseCount}>0 and ${t.nature}='demo_rebuilt' and isfinite(${t.importedAt})`,
    ),
    check(
      'comparison_batch_input_files',
      sql`coalesce(jsonb_typeof(${t.inputFileHashes})='object' and (${t.inputFileHashes}-ARRAY[${sql.join(
        canonicalInputFiles.map(
          (file) => sql`${sql.raw("'" + file.replaceAll("'", "''") + "'")}`,
        ),
        sql`, `,
      )}]::text[])='{}'::jsonb and ${sql.join(
        canonicalInputFiles.map(
          (file) =>
            sql`(jsonb_typeof(${t.inputFileHashes}->${sql.raw("'" + file.replaceAll("'", "''") + "'")})='string' and ${t.inputFileHashes}->>${sql.raw("'" + file.replaceAll("'", "''") + "'")} ~ '^[a-f0-9]{64}$')`,
        ),
        sql` and `,
      )},false)`,
    ),
  ],
);
export const comparisonCases = pgTable(
  'evaluation_comparison_cases',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id')
      .notNull()
      .references(() => comparisonBatches.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    judgmentId: text('judgment_id').notNull(),
    judgmentName: text('judgment_name').notNull(),
    frontNodeId: text('front_node_id')
      .notNull()
      .references(() => evaluationNodes.id),
    backNodeId: text('back_node_id')
      .notNull()
      .references(() => evaluationNodes.id),
    workKind: text('work_kind').$type<'individual' | 'team'>().notNull(),
    workId: text('work_id').notNull(),
    teamId: text('team_id'),
  },
  (t) => [
    unique('comparison_case_batch_id').on(t.batchId, t.id),
    foreignKey({
      name: 'comparison_case_front_subject_fk',
      columns: [t.frontNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    foreignKey({
      name: 'comparison_case_back_subject_fk',
      columns: [t.backNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    check(
      'comparison_case_identity',
      sql`${t.id} ~ '[^[:space:]]' and ${t.judgmentId} ~ '[^[:space:]]' and ${t.judgmentName} ~ '[^[:space:]]' and ${t.workId} ~ '[^[:space:]]' and ${t.frontNodeId}<>${t.backNodeId}`,
    ),
    check(
      'comparison_case_work',
      sql`coalesce((${t.workKind}='individual' and ${t.teamId} is null) or (${t.workKind}='team' and ${t.teamId} ~ '[^[:space:]]'),false)`,
    ),
  ],
);
export const comparisonStages = pgTable(
  'evaluation_comparison_stages',
  {
    caseId: text('case_id').notNull(),
    side: text('side').$type<'front' | 'back'>().notNull(),
    batchId: text('batch_id').notNull(),
    state: text('state').$type<'present' | 'missing'>().notNull(),
    missingReason: text('missing_reason'),
    fragmentId: text('fragment_id'),
    originalVersionId: text('original_version_id'),
    judgmentId: text('judgment_id'),
    sourceStandardReference: text('source_standard_reference'),
    scaleId: text('scale_id'),
    grade: text('grade'),
    evaluatorId: text('evaluator_id').references(() => people.id),
    evaluatedAt: text('evaluated_at'),
    confirmation: text('confirmation').$type<'human_confirmed'>(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.side] }),
    unique('comparison_stage_batch_judgment').on(t.batchId, t.judgmentId),
    foreignKey({
      name: 'comparison_stage_case_fk',
      columns: [t.batchId, t.caseId],
      foreignColumns: [comparisonCases.batchId, comparisonCases.id],
    }),
    foreignKey({
      name: 'comparison_stage_source_fk',
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
    check('comparison_stage_side', sql`${t.side} in ('front','back')`),
    check(
      'comparison_stage_source_pair',
      sql`(${t.fragmentId} is null)=(${t.originalVersionId} is null)`,
    ),
    check(
      'comparison_stage_state',
      sql`coalesce(
 (${t.state}='present' and ${t.missingReason} is null and ${t.fragmentId} is not null and ${t.originalVersionId} is not null and ${t.judgmentId} ~ '[^[:space:]]' and ${t.sourceStandardReference} ~ '[^[:space:]]' and ${t.scaleId} ~ '[^[:space:]]' and ${t.grade} ~ '[^[:space:]]' and ${t.evaluatorId} is not null and ${instant(t.evaluatedAt)} and ${t.confirmation}='human_confirmed') or
 (${t.state}='missing' and ${t.missingReason} ~ '[^[:space:]]' and ${t.judgmentId} is null and ${t.sourceStandardReference} is null and ${t.scaleId} is null and ${t.grade} is null and ${t.evaluatorId} is null and ${t.evaluatedAt} is null and ${t.confirmation} is null),false)`,
    ),
  ],
);
export const comparisonManualMarks = pgTable(
  'evaluation_comparison_manual_marks',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .unique()
      .references(() => comparisonCases.id),
    reason: text('reason').notNull(),
    markedById: text('marked_by')
      .notNull()
      .references(() => people.id),
    markedAt: text('marked_at').notNull(),
    nature: text('nature').$type<'demo_human_mark'>().notNull(),
    sourceFileSha256: text('source_file_sha256').notNull(),
  },
  (t) => [
    check(
      'comparison_manual_mark_identity',
      sql`${t.id} ~ '[^[:space:]]' and ${t.reason} ~ '[^[:space:]]' and ${t.nature}='demo_human_mark' and ${t.sourceFileSha256} ~ '^[a-f0-9]{64}$' and ${instant(t.markedAt)}`,
    ),
  ],
);
