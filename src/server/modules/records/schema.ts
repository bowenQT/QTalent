import type { MaterialSourceLocation } from '../../../contracts/sources';
import { jobSnapshots } from '../../jobs/schema';
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  date,
  jsonb,
  unique,
  check,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { people } from '../directory';
import { projects } from '../staffing';
import { evaluationNodes, evaluationNodeSubjects } from '../programs';
import { ruleVersions } from '../evaluation-system';
export type SourceLocation =
  | MaterialSourceLocation
  | { kind: 'document'; page?: number; paragraph: string }
  | { kind: 'spreadsheet'; sheet: string; cell: string }
  | { kind: 'recording'; startMs: number; endMs: number }
  | { kind: 'snapshot_field'; fieldPath: string; originalLocation?: string };
export const originals = pgTable(
  'records_originals',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    kind: text('kind', { enum: ['original', 'prototype_snapshot'] })
      .notNull()
      .default('original'),
    displayNotice: text('display_notice'),
  },
  (t) => [
    check(
      'records_original_kind',
      sql`${t.kind} in ('original','prototype_snapshot')`,
    ),
  ],
);
export const originalVersions = pgTable(
  'records_original_versions',
  {
    id: text('id').primaryKey(),
    originalId: text('original_id')
      .notNull()
      .references(() => originals.id),
    version: integer('version').notNull(),
    contentDigest: text('content_digest').notNull(),
    sourceCommit: text('source_commit'),
    sourceBlob: text('source_blob'),
    sourcePath: text('source_path'),
  },
  (t) => [
    unique('records_original_version').on(t.originalId, t.version),
    check('records_version_positive', sql`${t.version} > 0`),
    check('records_digest_nonempty', sql`length(trim(${t.contentDigest})) > 0`),
  ],
);
/** Immutable parser output identity; job lifecycle remains in jobSnapshots. */
export const materialParses = pgTable(
  'records_material_parses',
  {
    id: text('id').primaryKey(),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => originalVersions.id),
    contentDigest: text('content_digest').notNull(),
    parserVersion: text('parser_version').notNull(),
    projectionVersion: text('projection_version').notNull(),
    resultDigest: text('result_digest').notNull(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobSnapshots.jobId),
    attempt: integer('attempt').notNull(),
  },
  (t) => [
    unique('records_material_parse_version').on(t.id, t.originalVersionId),
    check(
      'records_material_parse_digests',
      sql`${t.contentDigest} ~ '^[a-f0-9]{64}$' and ${t.resultDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'records_material_parse_identity',
      sql`${t.id} ~ '[^[:space:]]' and ${t.parserVersion} ~ '[^[:space:]]' and ${t.projectionVersion} ~ '[^[:space:]]' and ${t.attempt}>0`,
    ),
  ],
);
/** Includes empty physical pages. Range/excerpt verification belongs to publication. */
export const materialPdfPages = pgTable(
  'records_material_pdf_pages',
  {
    parseVersionId: text('parse_version_id')
      .notNull()
      .references(() => materialParses.id),
    page: integer('page').notNull(),
    text: text('text').notNull(),
    textDigest: text('text_digest').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.parseVersionId, t.page] }),
    check(
      'records_material_pdf_page',
      sql`${t.page}>0 and ${t.textDigest} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
export const fragments = pgTable(
  'records_fragments',
  {
    id: text('id').primaryKey(),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => originalVersions.id),
    parseVersionId: text('parse_version_id'),
    sourceCategory: text('source_category', {
      enum: ['original', 'historical_evaluation', 'submitted_code_snapshot'],
    }),
    evaluationKind: text('evaluation_kind', { enum: ['interview'] }),
    demo: boolean('demo'),
    location: jsonb('location').$type<SourceLocation>().notNull(),
    excerpt: text('excerpt').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'records_fragment_parse_version_fk',
      columns: [t.parseVersionId, t.originalVersionId],
      foreignColumns: [materialParses.id, materialParses.originalVersionId],
    }),
    check(
      'records_material_fragment_binding',
      sql`coalesce(
      (${t.parseVersionId} is null and ${t.sourceCategory} is null and ${t.evaluationKind} is null and ${t.demo} is null and ${t.location}->>'kind' in ('document','spreadsheet','recording','snapshot_field')) or
      (${t.parseVersionId} is not null and ${t.demo} is not null and (
        (${t.sourceCategory}='original' and ${t.evaluationKind} is null and ${t.location}->>'kind' not in ('code','snapshot_field')) or
        (${t.sourceCategory}='historical_evaluation' and ${t.evaluationKind}='interview' and ${t.location}->>'kind'='pdf') or
        (${t.sourceCategory}='submitted_code_snapshot' and ${t.evaluationKind} is null and ${t.location}->>'kind'='code')
      )),false)`,
    ),
    unique('records_fragment_version').on(t.id, t.originalVersionId),
    check('records_excerpt_nonblank', sql`${t.excerpt} ~ '[^[:space:]]'`),
    check(
      'records_location',
      sql`coalesce(jsonb_typeof(${t.location}) = 'object' and case ${t.location}->>'kind'
 when 'document' then jsonb_typeof(${t.location}->'paragraph') = 'string' and length(trim(${t.location}->>'paragraph')) > 0 and (not (${t.location} ? 'page') or (jsonb_typeof(${t.location}->'page') = 'number' and (${t.location}->>'page')::numeric > 0 and (${t.location}->>'page')::numeric = trunc((${t.location}->>'page')::numeric)))
 when 'spreadsheet' then jsonb_typeof(${t.location}->'sheet') = 'string' and length(trim(${t.location}->>'sheet')) > 0 and jsonb_typeof(${t.location}->'cell') = 'string' and length(trim(${t.location}->>'cell')) > 0
 when 'snapshot_field' then jsonb_typeof(${t.location}->'fieldPath') = 'string' and length(trim(${t.location}->>'fieldPath')) > 0 and (not (${t.location} ? 'originalLocation') or jsonb_typeof(${t.location}->'originalLocation') = 'string')
 when 'recording' then jsonb_typeof(${t.location}->'startMs') = 'number' and jsonb_typeof(${t.location}->'endMs') = 'number' and (${t.location}->>'startMs')::numeric >= 0 and (${t.location}->>'endMs')::numeric > (${t.location}->>'startMs')::numeric and (${t.location}->>'startMs')::numeric = trunc((${t.location}->>'startMs')::numeric) and (${t.location}->>'endMs')::numeric = trunc((${t.location}->>'endMs')::numeric)

 when 'pdf' then (${t.location} - ARRAY['kind','page','textRange'])='{}'::jsonb and jsonb_typeof(${t.location}->'page')='number' and (${t.location}->>'page')::numeric>0 and (${t.location}->>'page')::numeric=trunc((${t.location}->>'page')::numeric) and jsonb_typeof(${t.location}->'textRange')='object' and ((${t.location}->'textRange') - ARRAY['start','end'])='{}'::jsonb and jsonb_typeof(${t.location}->'textRange'->'start')='number' and jsonb_typeof(${t.location}->'textRange'->'end')='number' and (${t.location}->'textRange'->>'start')::numeric>=0 and (${t.location}->'textRange'->>'end')::numeric>(${t.location}->'textRange'->>'start')::numeric and (${t.location}->'textRange'->>'start')::numeric=trunc((${t.location}->'textRange'->>'start')::numeric) and (${t.location}->'textRange'->>'end')::numeric=trunc((${t.location}->'textRange'->>'end')::numeric)
 when 'presentation' then (${t.location} - ARRAY['kind','slide'])='{}'::jsonb and jsonb_typeof(${t.location}->'slide')='number' and (${t.location}->>'slide')::numeric>0 and (${t.location}->>'slide')::numeric=trunc((${t.location}->>'slide')::numeric)
 when 'video' then (${t.location} - ARRAY['kind','startMs','endMs'])='{}'::jsonb and jsonb_typeof(${t.location}->'startMs')='number' and jsonb_typeof(${t.location}->'endMs')='number' and (${t.location}->>'startMs')::numeric>=0 and (${t.location}->>'endMs')::numeric>(${t.location}->>'startMs')::numeric and (${t.location}->>'startMs')::numeric=trunc((${t.location}->>'startMs')::numeric) and (${t.location}->>'endMs')::numeric=trunc((${t.location}->>'endMs')::numeric)
 when 'image' then (${t.location} - ARRAY['kind','region'])='{}'::jsonb and jsonb_typeof(${t.location}->'region')='object' and ((${t.location}->'region') - ARRAY['left','top','right','bottom'])='{}'::jsonb and jsonb_typeof(${t.location}->'region'->'left')='number' and jsonb_typeof(${t.location}->'region'->'top')='number' and jsonb_typeof(${t.location}->'region'->'right')='number' and jsonb_typeof(${t.location}->'region'->'bottom')='number' and (${t.location}->'region'->>'left')::numeric>=0 and (${t.location}->'region'->>'top')::numeric>=0 and (${t.location}->'region'->>'right')::numeric<=1 and (${t.location}->'region'->>'bottom')::numeric<=1 and (${t.location}->'region'->>'right')::numeric>(${t.location}->'region'->>'left')::numeric and (${t.location}->'region'->>'bottom')::numeric>(${t.location}->'region'->>'top')::numeric
 when 'code' then (${t.location} - ARRAY['kind','repository','commit','path','startLine','endLine'])='{}'::jsonb and jsonb_typeof(${t.location}->'repository')='string' and ${t.location}->>'repository' ~ '[^[:space:]]' and jsonb_typeof(${t.location}->'commit')='string' and ${t.location}->>'commit' ~ '^[a-f0-9]{40}$' and jsonb_typeof(${t.location}->'path')='string' and ${t.location}->>'path' ~ '[^[:space:]]' and ${t.location}->>'path' !~ '(^/|(^|/)[.]{1,2}(/|$)|//|/$)' and position(chr(92) in ${t.location}->>'path')=0 and jsonb_typeof(${t.location}->'startLine')='number' and jsonb_typeof(${t.location}->'endLine')='number' and (${t.location}->>'startLine')::numeric>0 and (${t.location}->>'endLine')::numeric>=(${t.location}->>'startLine')::numeric and (${t.location}->>'startLine')::numeric=trunc((${t.location}->>'startLine')::numeric) and (${t.location}->>'endLine')::numeric=trunc((${t.location}->>'endLine')::numeric)
 else false end, false)`,
    ),
  ],
);
export const events = pgTable(
  'records_events',
  {
    id: text('id').primaryKey(),
    // Existing ambiguous rows remain quarantined for evaluators until mapped.
    // Every new batch draft/save uses its explicit frozen evaluation node.
    evaluationNodeId: text('evaluation_node_id').references(
      () => evaluationNodes.id,
    ),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    recorderId: text('recorder_id')
      .notNull()
      .references(() => people.id),
    projectId: text('project_id').references(() => projects.id),
    occurredOn: date('occurred_on').notNull(),
    title: text('title').notNull(),
    situation: text('situation').notNull(),
    behavior: text('behavior').notNull(),
    impact: text('impact').notNull(),
    ruleVersionId: text('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    demo: boolean('demo').notNull().default(false),
  },
  (t) => [
    unique('records_event_rule_version').on(t.id, t.ruleVersionId),
    foreignKey({
      columns: [t.evaluationNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    check(
      'records_sbi',
      sql`length(trim(${t.situation})) > 0 and (${t.demo} or length(trim(${t.behavior})) > 0)`,
    ),
  ],
);
export const eventParticipants = pgTable(
  'records_event_participants',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.personId] })],
);
export const eventSources = pgTable(
  'records_event_sources',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    fragmentId: text('fragment_id').notNull(),
    originalVersionId: text('original_version_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.fragmentId, t.originalVersionId] }),
    foreignKey({
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
  ],
);
export const statements = pgTable(
  'records_statements',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    kind: text('kind', {
      enum: [
        'original_fact',
        'self_report',
        'management_observation',
        'ai_inference',
        'human_conclusion',
      ],
    }).notNull(),
    text: text('text').notNull(),
    authorId: text('author_id').references(() => people.id),
    modelVersion: text('model_version'),
    uncertainty: text('uncertainty'),
    fragmentId: text('fragment_id').notNull(),
    originalVersionId: text('original_version_id').notNull(),
  },
  (t) => [
    check(
      'records_statement_kind',
      sql`${t.kind} in ('original_fact','self_report','management_observation','ai_inference','human_conclusion')`,
    ),
    check(
      'records_statement_attribution',
      sql`(${t.kind} = 'ai_inference' and ${t.authorId} is null and ${t.modelVersion} is not null and length(trim(${t.modelVersion})) > 0) or (${t.kind} <> 'ai_inference' and ${t.authorId} is not null and ${t.modelVersion} is null)`,
    ),
    foreignKey({
      columns: [t.eventId, t.fragmentId, t.originalVersionId],
      foreignColumns: [
        eventSources.eventId,
        eventSources.fragmentId,
        eventSources.originalVersionId,
      ],
    }),
  ],
);
/** Isolated import archive. No FK from scores to this table: it is not an original evidence source. */
export const importSnapshots = pgTable(
  'records_import_snapshots',
  {
    id: text('id').primaryKey(),
    recordId: text('record_id').notNull(),
    sourceCommit: text('source_commit').notNull(),
    fieldPath: text('field_path').notNull(),
    provenance: text('provenance').notNull(),
    content: jsonb('content').notNull(),
  },
  (t) => [
    unique('records_snapshot_source').on(t.sourceCommit, t.fieldPath),
    check(
      'records_snapshot_provenance',
      sql`${t.provenance} = 'demo_import_snapshot'`,
    ),
  ],
);

/** Historical reviews retain their original scale; they never create dimension scores. */
export const historicalEvaluations = pgTable(
  'records_historical_evaluations',
  {
    id: text('id').primaryKey(),
    sourceRecordId: text('source_record_id').notNull(),
    // Unknown legacy history remains unbound; no inference from current membership.
    evaluationNodeId: text('evaluation_node_id').references(
      () => evaluationNodes.id,
    ),
    personId: text('person_id').references(() => people.id),
    recorderId: text('recorder_id')
      .notNull()
      .references(() => people.id),
    occurredOn: date('occurred_on').notNull(),
    kind: text('kind').notNull(),
    period: text('period'),
    scale: jsonb('scale').$type<[string, string][]>().notNull(),
    ruleVersionId: text('rule_version_id').references(() => ruleVersions.id),
    originalVersionId: text('original_version_id').notNull(),
    fragmentId: text('fragment_id').notNull(),
    sourceCategory: text('source_category', {
      enum: ['original', 'prototype_baseline'],
    })
      .notNull()
      .default('original'),
  },
  (t) => [
    foreignKey({
      columns: [t.evaluationNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    foreignKey({
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
    check('records_history_scale', sql`jsonb_typeof(${t.scale}) = 'array'`),
    check(
      'records_history_source_category',
      sql`${t.sourceCategory} in ('original','prototype_baseline')`,
    ),
  ],
);
export const historicalParticipants = pgTable(
  'records_historical_participants',
  {
    evaluationId: text('evaluation_id')
      .notNull()
      .references(() => historicalEvaluations.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.evaluationId, t.personId] })],
);
