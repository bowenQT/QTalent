import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
  check,
  foreignKey,
  primaryKey,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
} from 'drizzle-orm/pg-core';
import type {
  MaterialReviewItem,
  MaterialReviewCommand,
  MaterialReviewUndoCommand,
  MaterialReviewResolutionReceipt,
  MaterialReviewUndoReceipt,
} from '../../../../contracts/material-review';
import { accountBindings, people } from '../../directory';
import { auditEvents } from '../../../platform/audit/schema';
import {
  arrangeInputs,
  type ArrangeSourceContext,
} from '../arrange/input-state/schema';
import {
  uploadIntents,
  uploadCollections,
  uploadObjects,
} from '../uploads/schema';
import { recordDrafts } from '../save-state/schema';

/** Complete captured facts, never an authorization snapshot. Null remains unknown.
 * An audit reference traces the trusted capture; readers still recheck all subjects.
 * Later review decisions append operations, never replace these original facts.
 */
export type MediaIntakeScope = Pick<
  ArrangeSourceContext,
  'subjects' | 'kind' | 'requiredKinds'
> & {
  occurredOn: string;
};

export const mediaMaterials = pgTable(
  'records_media_materials',
  {
    id: text('id').primaryKey(),
    inputId: text('input_id').notNull(),
    inputVersion: text('input_version').notNull(),
    clientFileId: text('client_file_id').notNull(),
    uploadId: text('upload_id')
      .notNull()
      .references(() => uploadIntents.id),
    recordCollectionId: text('record_collection_id')
      .notNull()
      .references(() => uploadCollections.id),
    originalVersionId: text('original_version_id')
      .notNull()
      .references(() => uploadObjects.originalVersionId),
    revision: integer('revision').notNull(),
    intakeScope: jsonb('intake_scope').$type<MediaIntakeScope>(),
    scopeAuditId: text('scope_audit_id').references(() => auditEvents.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      columns: [t.inputId, t.inputVersion],
      foreignColumns: [arrangeInputs.id, arrangeInputs.inputVersion],
    }),
    unique('records_media_material_client').on(t.inputId, t.clientFileId),
    unique('records_media_material_upload').on(t.inputId, t.uploadId),
    check('records_media_material_revision', sql`${t.revision} > 0`),
    check(
      'records_media_material_scope',
      sql`(${t.intakeScope} is null and ${t.scopeAuditId} is null) or (${t.intakeScope} is not null and ${t.scopeAuditId} is not null and coalesce(jsonb_typeof(${t.intakeScope}) = 'object' and jsonb_typeof(${t.intakeScope}->'subjects') = 'array' and jsonb_array_length(${t.intakeScope}->'subjects') > 0 and jsonb_typeof(${t.intakeScope}->'requiredKinds') = 'array' and jsonb_typeof(${t.intakeScope}->'kind') = 'string' and (${t.intakeScope}->>'occurredOn') ~ '^\\d{4}-\\d{2}-\\d{2}$', false))`,
    ),
  ],
);

/** Original question context is retained. Current state/revision and immutable
 * operations determine the view; candidates and question.source confer no rights.
 */
export const mediaReviewItems = pgTable(
  'records_media_review_items',
  {
    id: text('id').primaryKey(),
    materialId: text('material_id')
      .notNull()
      .references(() => mediaMaterials.id),
    kind: text('kind').$type<MaterialReviewItem['kind']>().notNull(),
    revision: integer('revision').notNull(),
    state: text('state').$type<'pending' | 'deferred' | 'resolved'>().notNull(),
    question: jsonb('question').$type<MaterialReviewItem>().notNull(),
    currentOperationId: text('current_operation_id'),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('records_media_item_material').on(t.id, t.materialId),
    check('records_media_item_revision', sql`${t.revision} > 0`),
    check(
      'records_media_item_kind',
      sql`${t.kind} in ('speaker','unknown_person','image_scope','unknown_interviewer','unknown_project','unknown_interview_candidate')`,
    ),
    check(
      'records_media_item_state',
      sql`${t.state} in ('pending','deferred','resolved') and (${t.state} <> 'resolved' or ${t.currentOperationId} is not null)`,
    ),
    check(
      'records_media_item_question',
      sql`jsonb_typeof(${t.question}) = 'object' and (${t.question}->'itemId') is not distinct from to_jsonb(${t.id}) and (${t.question}->'materialId') is not distinct from to_jsonb(${t.materialId}) and (${t.question}->'kind') is not distinct from to_jsonb(${t.kind})`,
    ),
    // Initial items have no operation; insert the receipt then CAS this pointer.
    foreignKey({
      columns: [t.currentOperationId, t.materialId],
      foreignColumns: [
        mediaReviewOperations.id,
        mediaReviewOperations.materialId,
      ],
    }),
  ],
);

export type MediaReviewVersionChange = {
  itemId: string;
  previousRevision: number;
  revision: number;
};

/** Append-only API facts. The operation is also the resume proof; no separate
 * grant store and no persisted model capability. A replay rechecks current rights.
 */
export const mediaReviewOperations = pgTable(
  'records_media_review_operations',
  {
    id: text('id').primaryKey(),
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    actorPersonId: text('actor_person_id')
      .notNull()
      .references(() => people.id),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    itemId: text('item_id').notNull(),
    materialId: text('material_id').notNull(),
    action: text('action').$type<'resolve' | 'undo'>().notNull(),
    sourceOperationId: text('source_operation_id').references(
      (): AnyPgColumn => mediaReviewOperations.id,
    ),
    command: jsonb('command')
      .$type<MaterialReviewCommand | MaterialReviewUndoCommand>()
      .notNull(),
    receipt: jsonb('receipt')
      .$type<MaterialReviewResolutionReceipt | MaterialReviewUndoReceipt>()
      .notNull(),
    changes: jsonb('changes').$type<MediaReviewVersionChange[]>().notNull(),
    auditId: text('audit_id')
      .notNull()
      .references(() => auditEvents.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    unique('records_media_review_operation_key').on(
      t.actorAccountId,
      t.operationId,
    ),
    unique('records_media_review_operation_material').on(t.id, t.materialId),
    foreignKey({
      columns: [t.itemId, t.materialId],
      foreignColumns: [mediaReviewItems.id, mediaReviewItems.materialId],
    }),
    check(
      'records_media_review_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'records_media_review_operation_action',
      sql`(${t.action} = 'resolve' and ${t.sourceOperationId} is null) or (${t.action} = 'undo' and ${t.sourceOperationId} is not null and ${t.sourceOperationId} <> ${t.id})`,
    ),
    check(
      'records_media_review_operation_command',
      sql`jsonb_typeof(${t.command}) = 'object' and (${t.command}->'operationId') is not distinct from to_jsonb(${t.operationId}) and (${t.command}->'itemId') is not distinct from to_jsonb(${t.itemId})`,
    ),
    check(
      'records_media_review_operation_changes',
      sql`coalesce(jsonb_typeof(${t.changes}) = 'array' and jsonb_array_length(${t.changes}) > 0, false)`,
    ),
  ],
);

/** Exact producer-written dependencies, not inferred by person or fragment.
 * A historical draftRevision deliberately does not FK the mutable current CAS.
 */
export const mediaReviewDraftDependencies = pgTable(
  'records_media_review_draft_dependencies',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => mediaReviewOperations.id),
    itemId: text('item_id')
      .notNull()
      .references(() => mediaReviewItems.id),
    draftId: text('draft_id')
      .notNull()
      .references(() => recordDrafts.draftId),
    draftRevision: integer('draft_revision').notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({
      columns: [t.operationId, t.itemId, t.draftId, t.draftRevision],
    }),
    check('records_media_review_draft_revision', sql`${t.draftRevision} > 0`),
  ],
);
