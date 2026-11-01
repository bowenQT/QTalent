import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import type {
  entryToolInputSchemas,
  entryToolSuccessSchemas,
} from '../../../../contracts/entry-tools';
import { agentApiBindings } from '../schema';

type ToolName = 'submit_material_batch' | 'person_brief' | 'draft_requirement';
type ToolArgs = z.output<(typeof entryToolInputSchemas)[ToolName]>;
type ToolPayload = z.output<(typeof entryToolSuccessSchemas)[ToolName]>;

// These are issuance comparison facts, NOT current authorization or a directory.
// The native writer must lock the conversation, validate immutable facts and
// transitions, and re-read current 903/899 authority and every disclosed source.
export const agentApiConversations = pgTable(
  'agentapi_conversations',
  {
    id: text('id').primaryKey(),
    bindingId: text('binding_id').references(() => agentApiBindings.id, {
      onDelete: 'set null',
    }),
    accountId: text('account_id').notNull(),
    personId: text('person_id').notNull(),
    credentialId: text('credential_id').notNull(),
    credentialRevision: integer('credential_revision').notNull(),
    authorizationDigest: text('authorization_digest').notNull(),
    providerSessionId: text('provider_session_id').unique(),
    // Creating is a persistence-only state, not an already-bound core session.
    state: text('state', {
      enum: [
        'creating',
        'active',
        'invalidated',
        'outcome_unknown',
        'failed',
        'cancelled',
      ],
    }).notNull(),
    cleanup: text('cleanup', {
      enum: ['none', 'reserved', 'verified', 'unknown'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      'agentapi_conversation_identity',
      sql`length(${t.id}) between 1 and 200
        and length(${t.accountId}) > 0 and length(${t.personId}) > 0
        and length(${t.credentialId}) > 0 and ${t.credentialRevision} > 0
        and ${t.authorizationDigest} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'agentapi_conversation_provider',
      sql`${t.providerSessionId} is null or length(${t.providerSessionId}) > 0`,
    ),
    check(
      'agentapi_conversation_state',
      sql`${t.state} in ('creating', 'active', 'invalidated', 'outcome_unknown', 'failed', 'cancelled')
        and (${t.state} <> 'active' or ${t.providerSessionId} is not null)`,
    ),
    check(
      'agentapi_conversation_cleanup',
      sql`${t.cleanup} in ('none', 'reserved', 'verified', 'unknown')`,
    ),
  ],
);

export const agentApiTurns = pgTable(
  'agentapi_turns',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => agentApiConversations.id),
    operationId: text('operation_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    inputDigest: text('input_digest').notNull(),
    state: text('state', {
      enum: ['reserved', 'submitted', 'complete', 'outcome_unknown', 'failed'],
    }).notNull(),
    userEventId: text('user_event_id'),
    answer: text('answer'),
    nature: text('nature', { enum: ['ai_suggestion'] })
      .notNull()
      .default('ai_suggestion'),
    polls: integer('polls').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.operationId] }),
    unique('agentapi_turn_ordinal').on(t.conversationId, t.ordinal),
    unique('agentapi_turn_user_event').on(t.conversationId, t.userEventId),
    uniqueIndex('agentapi_turn_incomplete')
      .on(t.conversationId)
      .where(sql`${t.state} <> 'complete'`),
    check(
      'agentapi_turn_identity',
      sql`length(${t.operationId}) between 1 and 200 and ${t.ordinal} > 0
        and ${t.inputDigest} ~ '^[a-f0-9]{64}$'
        and (${t.userEventId} is null or length(${t.userEventId}) > 0)`,
    ),
    check(
      'agentapi_turn_state',
      sql`${t.state} in ('reserved', 'submitted', 'complete', 'outcome_unknown', 'failed')`,
    ),
    check(
      'agentapi_turn_answer',
      sql`(${t.answer} is null or (${t.state} = 'complete' and length(${t.answer}) <= 65536))
        and ${t.nature} = 'ai_suggestion'`,
    ),
    check('agentapi_turn_polls', sql`${t.polls} between 0 and 120`),
  ],
);

// SQL checks only necessary identity/shape bounds. The native writer
// must parse BOTH JSON columns against the frozen schema selected by name,
// enforce full DTO/input consistency, and reject same-ID/different-fact writes.
// Preserve original model args; businessOperationId is the server-derived key.
export const agentApiToolEvents = pgTable(
  'agentapi_tool_events',
  {
    conversationId: text('conversation_id').notNull(),
    eventId: text('event_id').notNull(),
    operationId: text('operation_id').notNull(),
    businessOperationId: text('business_operation_id').notNull().unique(),
    name: text('name', {
      enum: ['submit_material_batch', 'person_brief', 'draft_requirement'],
    }).notNull(),
    args: jsonb('args').$type<ToolArgs>().notNull(),
    successPayload: jsonb('success_payload').$type<ToolPayload>().notNull(),
    state: text('state', {
      enum: ['sending', 'sent', 'outcome_unknown'],
    }).notNull(),
    resultEventId: text('result_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.eventId] }),
    foreignKey({
      name: 'agentapi_tool_turn',
      columns: [t.conversationId, t.operationId],
      foreignColumns: [agentApiTurns.conversationId, agentApiTurns.operationId],
    }),
    unique('agentapi_tool_result_event').on(t.conversationId, t.resultEventId),
    check(
      'agentapi_tool_identity',
      sql`length(${t.eventId}) > 0 and ${t.businessOperationId} ~ '^[a-f0-9]{64}$'
        and (${t.resultEventId} is null or length(${t.resultEventId}) > 0)`,
    ),
    check(
      'agentapi_tool_state',
      sql`${t.state} in ('sending', 'sent', 'outcome_unknown')`,
    ),
    // The native writer retains the service's exact 64 KiB compact JSON
    // { status, payload } wire budget. JSONB::text has a different byte size;
    // capping that representation here would reject valid near-limit payloads.
    check(
      'agentapi_tool_shape',
      sql`(jsonb_typeof(${t.args}) = 'object'
        and jsonb_typeof(${t.successPayload}) = 'object'
        and case ${t.name}
          when 'submit_material_batch' then
            jsonb_typeof(${t.args}->'operationId') = 'string'
            and length(${t.args}->>'operationId') > 0
            and jsonb_typeof(${t.args}->'evaluationNodeId') = 'string'
            and length(${t.args}->>'evaluationNodeId') > 0
            and jsonb_typeof(${t.args}->'personIds') = 'array'
            and jsonb_typeof(${t.args}->'projectId') in ('string', 'null')
            and jsonb_typeof(${t.args}->'text') = 'string'
            and jsonb_typeof(${t.args}->'files') = 'array'
            and jsonb_typeof(${t.successPayload}->'batchId') = 'string'
            and length(${t.successPayload}->>'batchId') > 0
            and jsonb_typeof(${t.successPayload}->'revision') = 'number'
            and (${t.successPayload}->>'revision') ~ '^[1-9][0-9]*$'
            and jsonb_typeof(${t.successPayload}->'evaluationNodeId') = 'string'
            and ${t.successPayload}->>'evaluationNodeId' = ${t.args}->>'evaluationNodeId'
            and jsonb_typeof(${t.successPayload}->'personIds') = 'array'
            and jsonb_typeof(${t.successPayload}->'files') = 'array'
            and jsonb_typeof(${t.successPayload}->'counts') = 'object'
          when 'person_brief' then
            jsonb_typeof(${t.args}->'id') = 'string'
            and length(${t.args}->>'id') > 0
            and ${t.successPayload}->>'role' in ('manager', 'hr', 'mentor')
            and jsonb_typeof(${t.successPayload}->'person') = 'object'
            and jsonb_typeof(${t.successPayload}->'person'->'id') = 'string'
            and ${t.successPayload}->'person'->>'id' = ${t.args}->>'id'
            and jsonb_typeof(${t.successPayload}->'projectLoad') = 'object'
            and jsonb_typeof(${t.successPayload}->'recentFacts') = 'object'
            and jsonb_typeof(${t.successPayload}->'capabilityLines') = 'object'
          when 'draft_requirement' then
            jsonb_typeof(${t.args}->'operationId') = 'string'
            and length(trim(${t.args}->>'operationId')) > 0
            and jsonb_typeof(${t.args}->'projectId') = 'string'
            and length(trim(${t.args}->>'projectId')) > 0
            and jsonb_typeof(${t.args}->'inputText') = 'string'
            and length(trim(${t.args}->>'inputText')) > 0
            and ${t.successPayload}->>'kind' = 'staffing_demand'
            and ${t.successPayload}->'schemaVersion' = '1'::jsonb
            and jsonb_typeof(${t.successPayload}->'jobId') = 'string'
            and length(${t.successPayload}->>'jobId') > 0
            and jsonb_typeof(${t.successPayload}->'revision') = 'number'
            and (${t.successPayload}->>'revision') ~ '^[1-9][0-9]*$'
            and ${t.successPayload}->>'status' in ('queued', 'running', 'partial', 'awaiting_manual', 'failed', 'completed', 'cancelled')
            and (${t.successPayload}->'result' = 'null'::jsonb or (
              jsonb_typeof(${t.successPayload}->'result') = 'object'
              and jsonb_typeof(${t.successPayload}->'result'->'projectId') = 'string'
              and ${t.successPayload}->'result'->>'projectId' = ${t.args}->>'projectId'))
          else false
        end) is true`,
    ),
  ],
);
