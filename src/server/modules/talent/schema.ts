import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
  check,
  unique,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { people } from '../directory';
import { events, eventSources } from '../records';
import { dimensions, anchors } from '../evaluation-system';
export const aiSuggestions = pgTable(
  'talent_ai_suggestions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    dimensionId: text('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    ruleVersionId: text('rule_version_id').notNull(),
    modelVersion: text('model_version').notNull(),
    sourceCategory: text('source_category', {
      enum: ['original', 'prototype_baseline'],
    })
      .notNull()
      .default('original'),
    status: text('status').notNull(),
    value: integer('value'),
    anchorId: text('anchor_id'),
    fragmentId: text('fragment_id').notNull(),
    originalVersionId: text('original_version_id').notNull(),
    rationale: text('rationale').notNull(),
  },
  (t) => [
    unique('talent_ai_identity').on(
      t.id,
      t.eventId,
      t.dimensionId,
      t.ruleVersionId,
    ),
    check(
      'talent_ai_status_value',
      sql`(${t.status} = 'scored' and ${t.value} between 1 and 5 and ${t.value} is not null and ${t.anchorId} is not null) or (${t.status} in ('unknown','not_demonstrated') and ${t.value} is null and ${t.anchorId} is null)`,
    ),
    check(
      'talent_ai_source_category',
      sql`${t.sourceCategory} in ('original','prototype_baseline')`,
    ),
    check('talent_ai_model', sql`length(trim(${t.modelVersion})) > 0`),
    foreignKey({
      columns: [t.eventId, t.ruleVersionId],
      foreignColumns: [events.id, events.ruleVersionId],
    }),
    foreignKey({
      columns: [t.anchorId, t.dimensionId, t.ruleVersionId, t.value],
      foreignColumns: [
        anchors.id,
        anchors.dimensionId,
        anchors.ruleVersionId,
        anchors.value,
      ],
    }),
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
export const confirmations = pgTable(
  'talent_confirmations',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id').notNull(),
    dimensionId: text('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    evaluatorId: text('evaluator_id').references(() => people.id),
    sourceCategory: text('source_category', {
      enum: ['original', 'prototype_baseline'],
    })
      .notNull()
      .default('original'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ruleVersionId: text('rule_version_id').notNull(),
    status: text('status').notNull(),
    value: integer('value'),
    anchorId: text('anchor_id'),
    fragmentId: text('fragment_id').notNull(),
    originalVersionId: text('original_version_id').notNull(),
    revision: integer('revision').notNull(),
    active: boolean('active').notNull(),
    modifiedBy: text('modified_by').references(() => people.id),
    reason: text('reason'),
    previousId: text('previous_id').references(
      (): AnyPgColumn => confirmations.id,
    ),
    previousRevision: integer('previous_revision'),
    suggestionId: text('suggestion_id'),
  },
  (t) => [
    foreignKey({
      columns: [t.suggestionId, t.eventId, t.dimensionId, t.ruleVersionId],
      foreignColumns: [
        aiSuggestions.id,
        aiSuggestions.eventId,
        aiSuggestions.dimensionId,
        aiSuggestions.ruleVersionId,
      ],
    }),
    check(
      'talent_confirmation_provenance',
      sql`(${t.sourceCategory} = 'original' and ${t.evaluatorId} is not null and ${t.modifiedBy} is not null) or (${t.sourceCategory} = 'prototype_baseline' and ${t.confirmedAt} is null and ${t.modifiedBy} is null and ${t.revision} = 1 and (${t.status} <> 'scored' or ${t.evaluatorId} is not null))`,
    ),
    uniqueIndex('talent_one_active_unattributed_status')
      .on(t.eventId, t.dimensionId)
      .where(sql`${t.active} and ${t.evaluatorId} is null`),
    uniqueIndex('talent_one_active_confirmation')
      .on(t.eventId, t.dimensionId, t.evaluatorId)
      .where(sql`${t.active}`),
    unique('talent_confirmation_revision').on(
      t.eventId,
      t.dimensionId,
      t.evaluatorId,
      t.revision,
    ),
    unique('talent_confirmation_lineage').on(
      t.id,
      t.eventId,
      t.dimensionId,
      t.evaluatorId,
      t.revision,
    ),
    check(
      'talent_confirmation_status_value',
      sql`(${t.status} = 'scored' and ${t.value} between 1 and 5 and ${t.value} is not null and ${t.anchorId} is not null) or (${t.status} in ('unknown','not_demonstrated') and ${t.value} is null and ${t.anchorId} is null)`,
    ),
    check(
      'talent_confirmation_revision_chain',
      sql`(${t.revision} = 1 and ${t.previousId} is null and ${t.previousRevision} is null) or (${t.revision} > 1 and ${t.previousId} is not null and ${t.previousRevision} = ${t.revision} - 1 and ${t.previousRevision} is not null and length(trim(${t.reason})) > 0 and ${t.reason} is not null)`,
    ),
    foreignKey({
      columns: [
        t.previousId,
        t.eventId,
        t.dimensionId,
        t.evaluatorId,
        t.previousRevision,
      ],
      foreignColumns: [
        t.id,
        t.eventId,
        t.dimensionId,
        t.evaluatorId,
        t.revision,
      ],
    }),
    foreignKey({
      columns: [t.eventId, t.ruleVersionId],
      foreignColumns: [events.id, events.ruleVersionId],
    }),
    foreignKey({
      columns: [t.anchorId, t.dimensionId, t.ruleVersionId, t.value],
      foreignColumns: [
        anchors.id,
        anchors.dimensionId,
        anchors.ruleVersionId,
        anchors.value,
      ],
    }),
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
export const scoreReviews = pgTable(
  'talent_score_reviews',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    dimensionId: text('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    saveId: text('save_id'),
    confirmationId: text('confirmation_id').references(() => confirmations.id),
    counterpartConfirmationId: text('counterpart_confirmation_id').references(
      () => confirmations.id,
    ),
    suggestionId: text('suggestion_id').references(() => aiSuggestions.id),
    revision: integer('revision').notNull().default(1),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'talent_review_reason',
      sql`${t.reason} in ('score_gap','ai_changed_without_reason','post_freeze_position_change')`,
    ),
    check('talent_review_status', sql`${t.status} in ('open','resolved')`),
  ],
);
