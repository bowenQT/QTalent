import { sql } from 'drizzle-orm';
import { MAX_ATTACHMENTS } from '../../../../../contracts/media';
import {
  pgTable,
  text,
  date,
  jsonb,
  timestamp,
  primaryKey,
  unique,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accountBindings } from '../../../directory';
import { evaluationNodes } from '../../../programs';
import { jobSnapshots } from '../../../../jobs/schema';
import type { StoredRecordOriginalInput } from './original-input';
import type { TalentKind, TalentSubject } from '../../../../authz/talent';

/** Immutable provenance facts supplied only by trusted source producers. Never grants or cached permission decisions. */
export interface ArrangeSourceContext {
  fragmentId: string;
  originalVersionId: string;
  subjects: TalentSubject[];
  attributedPersonIds: string[];
  kind: TalentKind;
  requiredKinds: TalentKind[];
}
export const arrangeInputs = pgTable(
  'records_arrange_inputs',
  {
    id: text('id').primaryKey(),
    creatorAccountId: text('creator_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    jobId: text('job_id')
      .notNull()
      .references(() => jobSnapshots.jobId),
    inputVersion: text('input_version').notNull(),
    // Trusted business facts for new batch inputs. Legacy rows remain unavailable:
    // neither audit createdAt nor a selected input's id can supply these values.
    // The batch is saved before 846 inserts its ledger, so this is not a batch FK.
    batchId: text('batch_id'),
    evaluationNodeId: text('evaluation_node_id').references(
      () => evaluationNodes.id,
    ),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    occurredOn: date('occurred_on'),
    origin: text('origin', {
      enum: ['text', 'recording', 'attachment'],
    }).notNull(),
    originalInput: jsonb('original_input')
      .$type<StoredRecordOriginalInput>()
      .notNull(),
    sourceContexts: jsonb('source_contexts')
      .$type<ArrangeSourceContext[]>()
      .notNull(),
    inputSource: jsonb('input_source').$type<{
      fragmentId: string;
      originalVersionId: string;
    } | null>(),
    personIds: jsonb('person_ids').$type<string[]>().notNull(),
    projectMode: text('project_mode', {
      enum: ['none', 'resolved', 'needs_selection'],
    }).notNull(),
    projectId: text('project_id'),
    projectCandidateIds: jsonb('project_candidate_ids')
      .$type<string[]>()
      .notNull(),
    supersededByInputId: text('superseded_by_input_id').references(
      (): AnyPgColumn => arrangeInputs.id,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    unique('records_arrange_job').on(t.jobId),
    unique('records_arrange_version').on(t.id, t.inputVersion),
    check(
      'records_arrange_origin',
      sql`${t.origin} in ('text','recording','attachment')`,
    ),
    check(
      'records_arrange_project',
      sql`(${t.projectMode} = 'resolved' and ${t.projectId} is not null) or (${t.projectMode} in ('none','needs_selection') and ${t.projectId} is null)`,
    ),
    check(
      'records_arrange_source_arrays',
      sql`jsonb_typeof(${t.sourceContexts}) = 'array' and jsonb_typeof(${t.personIds}) = 'array' and jsonb_typeof(${t.projectCandidateIds}) = 'array'`,
    ),
    check(
      'records_arrange_original_input',
      sql`jsonb_typeof(${t.originalInput}) = 'object' and (
        coalesce(jsonb_typeof(${t.originalInput}->'text') = 'string' and (${t.originalInput}->>'text') ~ '[^[:space:]]', false)
        or coalesce(${t.originalInput}->>'kind' = 'media' and jsonb_typeof(${t.originalInput}->'operationId') = 'string'
          and (${t.originalInput}->>'operationId') ~ '[^[:space:]]'
          and jsonb_typeof(${t.originalInput}->'materialIds') = 'array'
          and jsonb_array_length(${t.originalInput}->'materialIds') between 1 and ${sql.raw(String(MAX_ATTACHMENTS))}, false)
      )`,
    ),
    check(
      'records_arrange_new_input',
      sql`${t.supersededByInputId} is null or ${t.supersededByInputId} <> ${t.id}`,
    ),
  ],
);
export const arrangeOperations = pgTable(
  'records_arrange_operations',
  {
    actorAccountId: text('actor_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    action: text('action', { enum: ['create', 'select'] }).notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    inputId: text('input_id')
      .notNull()
      .references(() => arrangeInputs.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobSnapshots.jobId),
  },
  (t) => [
    primaryKey({ columns: [t.actorAccountId, t.action, t.operationId] }),
    check(
      'records_arrange_operation_action',
      sql`${t.action} in ('create','select')`,
    ),
    check(
      'records_arrange_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
export type StoredArrangeInput = typeof arrangeInputs.$inferSelect;
