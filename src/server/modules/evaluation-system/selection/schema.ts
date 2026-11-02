import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  primaryKey,
  unique,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  SelectionCohortBinding,
  SelectionPublicationReceipt,
  EffectiveRuleVersion,
  selectionStandardContentSchema,
} from '../../../../contracts/selection-standard';
import type { SelectionRevisionRecord } from '../selection-standard';
import { cohorts } from '../../programs';
import { ruleVersions, ruleVersionApplicability } from '../schema';

type Content = z.infer<typeof selectionStandardContentSchema>;
/** Insert/read only through the selection store; publication never updates content. */
export const selectionVersionContents = pgTable(
  'evaluation_selection_version_content',
  {
    versionId: text('version_id')
      .primaryKey()
      .references(() => ruleVersions.id),
    content: jsonb('content').$type<Content>().notNull(),
    origin: text('origin', { enum: ['baseline', 'publication'] }).notNull(),
    sourceReference: text('source_reference').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'selection_content_version',
      sql`${t.versionId} ~ '^xe-select-v[1-9][0-9]*$'`,
    ),
    check(
      'selection_content_origin',
      sql`${t.origin} in ('baseline','publication')`,
    ),
    check(
      'selection_content_shape',
      sql`jsonb_typeof(${t.content}) = 'object' and length(trim(${t.sourceReference})) > 0 and isfinite(${t.recordedAt})`,
    ),
  ],
);
/** versionId is reserved here before a ruleVersions/published content row exists. */
export const selectionRevisions = pgTable(
  'evaluation_selection_revisions',
  {
    id: text('id').primaryKey(),
    versionId: text('version_id').notNull().unique(),
    baseVersionId: text('base_version_id')
      .notNull()
      .references(() => selectionVersionContents.versionId),
    scopeCohortId: text('scope_cohort_id')
      .notNull()
      .references(() => cohorts.id),
    state: text('state', {
      enum: ['draft', 'pending_confirmation', 'active', 'superseded'],
    }).notNull(),
    revision: integer('revision').notNull(),
    contentRevision: integer('content_revision').notNull(),
    contentWasPublished: boolean('content_was_published').notNull(),
    record: jsonb('record').$type<SelectionRevisionRecord>().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('selection_revision_identity').on(t.id, t.versionId),
    check(
      'selection_revision_version',
      sql`${t.versionId} ~ '^xe-select-v[1-9][0-9]*$' and ${t.versionId} <> ${t.baseVersionId}`,
    ),
    check(
      'selection_revision_state',
      sql`${t.state} in ('draft','pending_confirmation','active','superseded')`,
    ),
    check(
      'selection_revision_counter',
      sql`${t.revision} > 0 and ${t.contentRevision} > 0 and isfinite(${t.updatedAt})`,
    ),
    check(
      'selection_revision_snapshot',
      sql`coalesce(
    ${t.record}->'revision'->>'id' = ${t.id} and
    ${t.record}->'revision'->>'versionId' = ${t.versionId} and
    ${t.record}->'revision'->>'baseVersionId' = ${t.baseVersionId} and
    ${t.record}->'revision'->>'state' = ${t.state} and
    (${t.record}->'revision'->>'revision')::integer = ${t.revision} and
    (${t.record}->'revision'->>'contentRevision')::integer = ${t.contentRevision} and
    ${t.record}->>'scopeCohortId' = ${t.scopeCohortId} and
    (${t.record}->>'contentWasPublished')::boolean = ${t.contentWasPublished}, false)`,
    ),
  ],
);
export const selectionPublications = pgTable(
  'evaluation_selection_publications',
  {
    id: text('id').primaryKey(),
    draftId: text('draft_id')
      .notNull()
      .references(() => selectionRevisions.id),
    versionId: text('version_id')
      .notNull()
      .references(() => selectionVersionContents.versionId),
    receipt: jsonb('receipt').$type<SelectionPublicationReceipt>().notNull(),
    previousVersionId: text('previous_version_id')
      .notNull()
      .references(() => selectionVersionContents.versionId),
    previousEffective: jsonb('previous_effective')
      .$type<EffectiveRuleVersion>()
      .notNull(),
    previousPublicationId: text('previous_publication_id').references(
      (): AnyPgColumn => selectionPublications.id,
    ),
    previousRevisionSnapshot: jsonb(
      'previous_revision_snapshot',
    ).$type<SelectionRevisionRecord>(),
    previousSupersededRevision: integer('previous_superseded_revision'),
    previousPeriodId: text('previous_period_id')
      .notNull()
      .references(() => ruleVersionApplicability.periodId),
    periodId: text('period_id')
      .notNull()
      .unique()
      .references(() => ruleVersionApplicability.periodId),
    previousGeneration: integer('previous_generation').notNull(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoPeriodId: text('undo_period_id')
      .unique()
      .references(() => ruleVersionApplicability.periodId),
    undoGeneration: integer('undo_generation'),
  },
  (t) => [
    check(
      'selection_publication_pair',
      sql`(${t.previousRevisionSnapshot} is null and ${t.previousSupersededRevision} is null) or (${t.previousRevisionSnapshot} is not null and ${t.previousSupersededRevision} is not null and ${t.previousSupersededRevision} > 0)`,
    ),
    check('selection_publication_generation', sql`${t.previousGeneration} > 0`),
    check(
      'selection_publication_undo',
      sql`(${t.undoneAt} is null and ${t.undoPeriodId} is null and ${t.undoGeneration} is null) or (${t.undoneAt} is not null and isfinite(${t.undoneAt}) and ${t.undoPeriodId} is not null and ${t.undoGeneration} is not null and ${t.undoGeneration} > ${t.previousGeneration})`,
    ),
  ],
);
export const selectionCategoryHeads = pgTable(
  'evaluation_selection_category_head',
  {
    category: text('category').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => selectionVersionContents.versionId),
    currentPeriodId: text('current_period_id')
      .notNull()
      .references(() => ruleVersionApplicability.periodId),
    currentRevisionId: text('current_revision_id').references(
      () => selectionRevisions.id,
    ),
    currentPublicationId: text('current_publication_id').references(
      () => selectionPublications.id,
    ),
    generation: integer('generation').notNull(),
    nextVersionOrdinal: integer('next_version_ordinal').notNull(),
  },
  (t) => [
    check('selection_head_category', sql`${t.category} = 'xe_selection'`),
    check(
      'selection_head_counters',
      sql`${t.generation} > 0 and ${t.nextVersionOrdinal} > 0`,
    ),
  ],
);
export const selectionCohortBindings = pgTable(
  'evaluation_selection_cohort_bindings',
  {
    cohortId: text('cohort_id')
      .primaryKey()
      .references(() => cohorts.id),
    versionId: text('version_id')
      .notNull()
      .references(() => selectionVersionContents.versionId),
    binding: jsonb('binding').$type<SelectionCohortBinding>().notNull(),
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'selection_binding_snapshot',
      sql`coalesce(${t.binding}->'cohort'->>'id' = ${t.cohortId} and ${t.binding}->>'standardVersionId' = ${t.versionId}, false) and isfinite(${t.boundAt})`,
    ),
  ],
);
export const selectionOperations = pgTable(
  'evaluation_selection_operations',
  {
    actorAccountId: text('actor_account_id').notNull(),
    operationId: text('operation_id').notNull(),
    actorPersonId: text('actor_person_id').notNull(),
    action: text('action', {
      enum: [
        'create',
        'save',
        'submit',
        'withdraw',
        'return',
        'publish',
        'undo',
      ],
    }).notNull(),
    fingerprint: text('fingerprint').notNull(),
    scopeCohortId: text('scope_cohort_id')
      .notNull()
      .references(() => cohorts.id),
    visibleCohortIds: jsonb('visible_cohort_ids').$type<string[]>().notNull(),
    result: jsonb('result').$type<unknown>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorAccountId, t.operationId] }),
    check(
      'selection_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'selection_operation_action',
      sql`${t.action} in ('create','save','submit','withdraw','return','publish','undo')`,
    ),
    check(
      'selection_operation_result',
      sql`jsonb_typeof(${t.result}) = 'object' and jsonb_typeof(${t.visibleCohortIds}) = 'array'`,
    ),
  ],
);
