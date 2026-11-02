import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  primaryKey,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { people, accountBindings } from '../../directory';
import { evaluationNodeSubjects } from '../../programs';
import { fragments } from '../schema';

/** Append-only subjective observations; no event, score, or matching relation. */
export const managementObservations = pgTable(
  'records_management_observations',
  {
    id: text('id').primaryKey(),
    evaluationNodeId: text('evaluation_node_id').notNull(),
    personId: text('person_id').notNull(),
    text: text('text').notNull(),
    origin: text('origin', { enum: ['manual', 'interview_import'] }).notNull(),
    authorPersonId: text('author_person_id').references(() => people.id),
    authorName: text('author_name').notNull(),
    authorUnconfirmed: boolean('author_unconfirmed').notNull(),
    importedByAccountId: text('imported_by_account_id').references(
      () => accountBindings.accountId,
    ),
    importedByPersonId: text('imported_by_person_id').references(
      () => people.id,
    ),
    importedByName: text('imported_by_name'),
    recordedByAccountId: text('recorded_by_account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    recordedAt: timestamp('recorded_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    // Keep the source's date-only versus timestamp precision, independent of the import instant.
    occurredAt: text('occurred_at').notNull(),
    attributionId: text('attribution_id'),
  },
  (t) => [
    unique('records_observation_actor_identity').on(
      t.id,
      t.recordedByAccountId,
    ),
    foreignKey({
      columns: [t.evaluationNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    check(
      'records_observation_text',
      sql`char_length(${t.text}) between 1 and 100000 and ${t.text} ~ '[^[:space:]]'`,
    ),
    check(
      'records_observation_author',
      sql`char_length(${t.authorName}) between 1 and 100000 and ${t.authorName} ~ '[^[:space:]]'`,
    ),
    check(
      'records_observation_occurred',
      sql`${t.occurredAt} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)'`,
    ),
    check(
      'records_observation_origin_attribution',
      sql`coalesce(
    (${t.origin} = 'manual' and ${t.authorPersonId} is not null and not ${t.authorUnconfirmed}
      and ${t.importedByAccountId} is null and ${t.importedByPersonId} is null and ${t.importedByName} is null and ${t.attributionId} is null)
    or (${t.origin} = 'interview_import' and ${t.authorUnconfirmed}
      and ${t.importedByAccountId} = ${t.recordedByAccountId} and ${t.importedByPersonId} is not null
      and ${t.importedByName} ~ '[^[:space:]]' and ${t.attributionId} ~ '[^[:space:]]'), false)`,
    ),
  ],
);
export const managementObservationSources = pgTable(
  'records_management_observation_sources',
  {
    observationId: text('observation_id')
      .notNull()
      .references(() => managementObservations.id),
    position: integer('position').notNull(),
    fragmentId: text('fragment_id').notNull(),
    originalVersionId: text('original_version_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.observationId, t.fragmentId] }),
    unique('records_observation_source_position').on(
      t.observationId,
      t.position,
    ),
    check(
      'records_observation_source_position_range',
      sql`${t.position} between 0 and 99`,
    ),
    foreignKey({
      columns: [t.fragmentId, t.originalVersionId],
      foreignColumns: [fragments.id, fragments.originalVersionId],
    }),
  ],
);
export const managementObservationOperations = pgTable(
  'records_management_observation_operations',
  {
    accountId: text('account_id').notNull(),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    observationId: text('observation_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.operationId] }),
    foreignKey({
      columns: [t.observationId, t.accountId],
      foreignColumns: [
        managementObservations.id,
        managementObservations.recordedByAccountId,
      ],
    }),
    check(
      'records_observation_operation_key',
      sql`char_length(${t.operationId}) between 1 and 200 and ${t.operationId} ~ '[^[:space:]]'`,
    ),
    check(
      'records_observation_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
