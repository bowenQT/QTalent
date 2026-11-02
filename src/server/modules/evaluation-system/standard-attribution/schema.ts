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
} from 'drizzle-orm/pg-core';
import { accountBindings, people } from '../../directory';
import { ruleVersions } from '../schema';
import type {
  StandardAttributionHypothesis,
  ConfirmedStandardAttribution,
} from '../../../../contracts/standard-attribution';
import type { SelectionDraftProposal } from '../../../usecases/standard-attribution/ports';

export const attributionHypotheses = pgTable(
  'evaluation_attribution_hypotheses',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    payload: jsonb('payload').$type<StandardAttributionHypothesis>().notNull(),
  },
  (t) => [
    unique('evaluation_hypothesis_batch').on(t.id, t.batchId),
    check(
      'evaluation_hypothesis_identity',
      sql`coalesce(jsonb_typeof(${t.payload})='object' and ${t.payload}->>'id'=${t.id} and ${t.payload}->>'batchId'=${t.batchId} and ${t.payload}->>'origin'='ai_hypothesis',false)`,
    ),
  ],
);
export const standardAttributions = pgTable(
  'evaluation_standard_attributions',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    batchId: text('batch_id').notNull(),
    hypothesisId: text('hypothesis_id'),
    confirmedByPersonId: text('confirmed_by_person_id')
      .notNull()
      .references(() => people.id),
    confirmedAt: timestamp('confirmed_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    payload: jsonb('payload').$type<ConfirmedStandardAttribution>().notNull(),
  },
  (t) => [
    unique('evaluation_attribution_revision').on(t.id, t.revision),
    foreignKey({
      name: 'evaluation_attribution_hypothesis_batch_fk',
      columns: [t.hypothesisId, t.batchId],
      foreignColumns: [attributionHypotheses.id, attributionHypotheses.batchId],
    }),
    check('evaluation_attribution_revision_one', sql`${t.revision}=1`),
    check(
      'evaluation_attribution_identity',
      sql`coalesce(jsonb_typeof(${t.payload})='object' and ${t.payload}->>'id'=${t.id} and ${t.payload}->'revision'=to_jsonb(${t.revision}) and ${t.payload}->>'batchId'=${t.batchId} and ${t.payload}->>'origin'='human_conclusion' and (${t.payload}->'hypothesisId') is not distinct from coalesce(to_jsonb(${t.hypothesisId}),'null'::jsonb) and ${t.payload}->'confirmedBy'->>'id'=${t.confirmedByPersonId} and (${t.payload}->>'confirmedAt')::timestamptz=${t.confirmedAt},false)`,
    ),
  ],
);
export const selectionDraftProposals = pgTable(
  'evaluation_selection_draft_proposals',
  {
    id: text('id').primaryKey(),
    attributionId: text('attribution_id').notNull(),
    attributionRevision: integer('attribution_revision').notNull(),
    baseVersionId: text('base_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    payload: jsonb('payload').$type<SelectionDraftProposal>().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'evaluation_proposal_attribution_revision_fk',
      columns: [t.attributionId, t.attributionRevision],
      foreignColumns: [standardAttributions.id, standardAttributions.revision],
    }),
    check(
      'evaluation_proposal_identity',
      sql`coalesce(jsonb_typeof(${t.payload})='object' and ${t.payload}->>'id'=${t.id} and ${t.payload}->>'attributionId'=${t.attributionId} and ${t.payload}->>'baseVersionId'=${t.baseVersionId} and ${t.payload}->'humanVersion'='null'::jsonb and ${t.payload}->'aiDraft'->>'origin'='ai_draft' and ${t.payload}->'aiDraft'->'basis'->>'id'=${t.attributionId} and ${t.payload}->'aiDraft'->'basis'->'revision'=to_jsonb(${t.attributionRevision}),false)`,
    ),
  ],
);
export const attributionOperations = pgTable(
  'evaluation_attribution_operations',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    operationId: text('operation_id').notNull(),
    actorPersonId: text('actor_person_id')
      .notNull()
      .references(() => people.id),
    fingerprint: text('fingerprint').notNull(),
    evidenceFingerprint: text('evidence_fingerprint').notNull(),
    reservationId: text('reservation_id').notNull(),
    state: text('state', { enum: ['pending', 'finished'] }).notNull(),
    result: jsonb('result').$type<unknown>(),
    modelRequestId: text('model_request_id'),
    createdAt: timestamp('created_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    finishedAt: timestamp('finished_at', {
      withTimezone: true,
      mode: 'string',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.operationId] }),
    check(
      'evaluation_attribution_operation_identity',
      sql`length(trim(${t.operationId}))>0 and length(trim(${t.fingerprint}))>0 and length(trim(${t.evidenceFingerprint}))>0 and length(trim(${t.reservationId}))>0`,
    ),
    check(
      'evaluation_attribution_operation_state',
      sql`(${t.state}='pending' and ${t.result} is null and ${t.modelRequestId} is null and ${t.finishedAt} is null) or (${t.state}='finished' and ${t.result} is not null and ${t.result}<>'null'::jsonb and ${t.finishedAt} is not null and ${t.finishedAt}>=${t.createdAt})`,
    ),
  ],
);
