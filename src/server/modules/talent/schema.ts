import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  primaryKey,
  timestamp,
  boolean,
  check,
  unique,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { people, accountBindings } from '../directory';
import { events, eventSources, recordSaves } from '../records';
import { dimensions, anchors } from '../evaluation-system';
import { evaluationNodes } from '../programs';
import type { Calibration } from './score-review/ports';
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
    // New CAS token only; this does not infer any historical confirmation version.
    revision: integer('revision').notNull().default(1),
    // Legacy reviews remain unlinked; never infer historical confirmation IDs.
    saveId: text('save_id').references(() => recordSaves.saveId),
    confirmationId: text('confirmation_id').references(() => confirmations.id),
    counterpartConfirmationId: text('counterpart_confirmation_id').references(
      () => confirmations.id,
    ),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'talent_review_reason',
      sql`${t.reason} in ('score_gap','ai_changed_without_reason','post_freeze_position_change')`,
    ),
    check('talent_review_status', sql`${t.status} in ('open','resolved')`),
    check('talent_review_revision_positive', sql`${t.revision} > 0`),
    check(
      'talent_review_save_provenance',
      sql`${t.saveId} is null or (${t.confirmationId} is not null and (${t.reason} <> 'score_gap' or ${t.counterpartConfirmationId} is not null))`,
    ),
    check(
      'talent_review_distinct_confirmations',
      sql`${t.counterpartConfirmationId} is null or (${t.confirmationId} is not null and ${t.confirmationId} <> ${t.counterpartConfirmationId})`,
    ),
    uniqueIndex('talent_review_ai_confirmation')
      .on(t.reason, t.confirmationId)
      .where(
        sql`${t.reason} = 'ai_changed_without_reason' and ${t.confirmationId} is not null`,
      ),
    uniqueIndex('talent_review_rater_pair')
      .on(
        t.reason,
        sql`least(${t.confirmationId}, ${t.counterpartConfirmationId})`,
        sql`greatest(${t.confirmationId}, ${t.counterpartConfirmationId})`,
      )
      .where(
        sql`${t.reason} = 'score_gap' and ${t.confirmationId} is not null and ${t.counterpartConfirmationId} is not null`,
      ),
  ],
);

export const scoreReviewCalibrations = pgTable(
  'talent_score_review_calibrations',
  {
    itemId: text('item_id')
      .primaryKey()
      .references(() => scoreReviews.id),
    originalRevision: integer('original_revision').notNull(),
    revision: integer('revision').notNull(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    evaluationNodeId: text('evaluation_node_id')
      .notNull()
      .references(() => evaluationNodes.id),
    dimensionId: text('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    ruleVersionId: text('rule_version_id').notNull(),
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    actorPersonId: text('actor_person_id')
      .notNull()
      .references(() => people.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    value: integer('value').notNull(),
    anchorId: text('anchor_id').notNull(),
    confirmationId: text('confirmation_id')
      .notNull()
      .references(() => confirmations.id),
    counterpartConfirmationId: text('counterpart_confirmation_id').references(
      () => confirmations.id,
    ),
    suggestionId: text('suggestion_id').references(() => aiSuggestions.id),
    originalFingerprint: text('original_fingerprint').notNull(),
    scopeFingerprint: text('scope_fingerprint').notNull(),
    sourceFactRevision: text('source_fact_revision').notNull(),
    payload: jsonb('payload').$type<Calibration>().notNull(),
  },
  (t) => [
    unique('talent_review_calibration_receipt_identity').on(
      t.itemId,
      t.revision,
      t.actorAccountId,
      t.actorPersonId,
    ),
    check(
      'talent_review_calibration_revision',
      sql`${t.originalRevision} > 0 and ${t.revision} > 0 and ${t.revision} = ${t.originalRevision} + 1`,
    ),
    check('talent_review_calibration_value', sql`${t.value} between 1 and 5`),
    check(
      'talent_review_calibration_fingerprints',
      sql`${t.originalFingerprint} ~ '^[a-f0-9]{64}$' and ${t.scopeFingerprint} ~ '^[a-f0-9]{64}$' and ${t.sourceFactRevision} ~ '^[a-f0-9]{64}$'`,
    ),
    // JSON identities are type-sensitive and missing fields must fail, not yield
    // SQL NULL (which CHECK accepts). Full contract/source validation stays native.
    check(
      'talent_review_calibration_payload_identity',
      sql`jsonb_typeof(${t.payload}) = 'object'
        and (${t.payload} -> 'itemId') is not distinct from to_jsonb(${t.itemId})
        and (${t.payload} -> 'revision') is not distinct from to_jsonb(${t.revision})
        and (${t.payload} #> '{original,id}') is not distinct from to_jsonb(${t.itemId})
        and (${t.payload} #> '{original,revision}') is not distinct from to_jsonb(${t.originalRevision})
        and (${t.payload} #> '{original,eventId}') is not distinct from to_jsonb(${t.eventId})
        and (${t.payload} #> '{original,personId}') is not distinct from to_jsonb(${t.personId})
        and (${t.payload} #> '{original,dimensionId}') is not distinct from to_jsonb(${t.dimensionId})`,
    ),
    check(
      'talent_review_calibration_payload_score',
      sql`(${t.payload} #> '{score,raterId}') is not distinct from to_jsonb(${t.actorPersonId})
        and (${t.payload} #> '{score,value}') is not distinct from to_jsonb(${t.value})
        and (${t.payload} #> '{score,anchor,id}') is not distinct from to_jsonb(${t.anchorId})
        and (${t.payload} #> '{score,anchor,ruleVersion}') is not distinct from to_jsonb(${t.ruleVersionId})
        and jsonb_typeof(${t.payload} #> '{score,confirmedAt}') is not distinct from 'string'
        and (${t.payload} #>> '{score,confirmedAt}')::timestamptz is not distinct from ${t.confirmedAt}
        and jsonb_typeof(${t.payload} #> '{score,reason}') is not distinct from 'string'
        and coalesce((${t.payload} #>> '{score,reason}') ~ '[^[:space:]]', false)`,
    ),
    check(
      'talent_review_calibration_original_kind',
      sql`coalesce(((${t.payload} #> '{original,kind}') = '"rater_gap"'::jsonb and ${t.counterpartConfirmationId} is not null)
        or ((${t.payload} #> '{original,kind}') = '"ai_gap"'::jsonb and ${t.suggestionId} is not null), false)`,
    ),
    // These keys establish referenced rows, not current event/person/node scope;
    // the writer must lock and re-read the actual source and authorization facts.
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
  ],
);

export const scoreReviewOperations = pgTable(
  'talent_score_review_operations',
  {
    actorAccountId: text('actor_account_id').notNull(),
    operationId: text('operation_id').notNull(),
    actorPersonId: text('actor_person_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    scopeFingerprint: text('scope_fingerprint').notNull(),
    itemId: text('item_id').notNull(),
    calibrationRevision: integer('calibration_revision').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorAccountId, t.operationId] }),
    check(
      'talent_review_operation_fingerprints',
      sql`${t.fingerprint} ~ '^[a-f0-9]{64}$' and ${t.scopeFingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    // The immutable calibration is the only receipt payload. Including both
    // actor identities prevents replaying another person's/account's receipt.
    foreignKey({
      name: 'talent_review_operation_calibration_fk',
      columns: [
        t.itemId,
        t.calibrationRevision,
        t.actorAccountId,
        t.actorPersonId,
      ],
      foreignColumns: [
        scoreReviewCalibrations.itemId,
        scoreReviewCalibrations.revision,
        scoreReviewCalibrations.actorAccountId,
        scoreReviewCalibrations.actorPersonId,
      ],
    }),
  ],
);
