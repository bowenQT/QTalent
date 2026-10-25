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
import { ruleVersions } from '../evaluation-system';
export type SourceLocation =
  | { kind: 'document'; page?: number; paragraph: string }
  | { kind: 'spreadsheet'; sheet: string; cell: string }
  | { kind: 'recording'; startMs: number; endMs: number };
export const originals = pgTable('records_originals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
});
export const originalVersions = pgTable(
  'records_original_versions',
  {
    id: text('id').primaryKey(),
    originalId: text('original_id')
      .notNull()
      .references(() => originals.id),
    version: integer('version').notNull(),
    contentDigest: text('content_digest').notNull(),
  },
  (t) => [
    unique('records_original_version').on(t.originalId, t.version),
    check('records_version_positive', sql`${t.version} > 0`),
    check('records_digest_nonempty', sql`length(trim(${t.contentDigest})) > 0`),
  ],
);
export const fragments = pgTable(
  'records_fragments',
  {
    id: text('id').primaryKey(),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => originalVersions.id),
    location: jsonb('location').$type<SourceLocation>().notNull(),
    excerpt: text('excerpt').notNull(),
  },
  (t) => [
    unique('records_fragment_version').on(t.id, t.originalVersionId),
    check('records_excerpt_nonblank', sql`${t.excerpt} ~ '[^[:space:]]'`),
    check(
      'records_location',
      sql`coalesce(jsonb_typeof(${t.location}) = 'object' and case ${t.location}->>'kind'
 when 'document' then jsonb_typeof(${t.location}->'paragraph') = 'string' and length(trim(${t.location}->>'paragraph')) > 0 and (not (${t.location} ? 'page') or (jsonb_typeof(${t.location}->'page') = 'number' and (${t.location}->>'page')::numeric > 0 and (${t.location}->>'page')::numeric = trunc((${t.location}->>'page')::numeric)))
 when 'spreadsheet' then jsonb_typeof(${t.location}->'sheet') = 'string' and length(trim(${t.location}->>'sheet')) > 0 and jsonb_typeof(${t.location}->'cell') = 'string' and length(trim(${t.location}->>'cell')) > 0
 when 'recording' then jsonb_typeof(${t.location}->'startMs') = 'number' and jsonb_typeof(${t.location}->'endMs') = 'number' and (${t.location}->>'startMs')::numeric >= 0 and (${t.location}->>'endMs')::numeric > (${t.location}->>'startMs')::numeric and (${t.location}->>'startMs')::numeric = trunc((${t.location}->>'startMs')::numeric) and (${t.location}->>'endMs')::numeric = trunc((${t.location}->>'endMs')::numeric)
 else false end, false)`,
    ),
  ],
);
export const events = pgTable(
  'records_events',
  {
    id: text('id').primaryKey(),
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
    check(
      'records_sbi',
      sql`length(trim(${t.situation})) > 0 and length(trim(${t.behavior})) > 0`,
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
