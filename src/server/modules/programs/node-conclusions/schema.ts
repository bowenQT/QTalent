import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  primaryKey,
  unique,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { accountBindings } from '../../directory';
import { evaluationNodeSubjects } from '../schema';
import type { NodeConclusionVersion } from '../node-conclusion';

/** Stable node/person identity; latest version is derived from append-only rows. */
export const nodeConclusions = pgTable(
  'programs_node_conclusions',
  {
    id: text('id').primaryKey(),
    evaluationNodeId: text('evaluation_node_id').notNull(),
    personId: text('person_id').notNull(),
  },
  (t) => [
    unique('programs_node_conclusion_subject').on(
      t.evaluationNodeId,
      t.personId,
    ),
    unique('programs_node_conclusion_identity').on(
      t.id,
      t.evaluationNodeId,
      t.personId,
    ),
    foreignKey({
      name: 'programs_node_conclusion_subject_fk',
      columns: [t.evaluationNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
  ],
);

/** Historical human conclusion payloads are validated by the frozen domain schema.
 * Native writers must append only under the identity lock and expected-version CAS.
 */
export const nodeConclusionVersions = pgTable(
  'programs_node_conclusion_versions',
  {
    conclusionId: text('conclusion_id').notNull(),
    version: integer('version').notNull(),
    evaluationNodeId: text('evaluation_node_id').notNull(),
    personId: text('person_id').notNull(),
    payload: jsonb('payload').$type<NodeConclusionVersion>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conclusionId, t.version] }),
    foreignKey({
      name: 'programs_node_conclusion_version_identity_fk',
      columns: [t.conclusionId, t.evaluationNodeId, t.personId],
      foreignColumns: [
        nodeConclusions.id,
        nodeConclusions.evaluationNodeId,
        nodeConclusions.personId,
      ],
    }),
    check('programs_node_conclusion_positive_version', sql`${t.version} > 0`),
    check(
      'programs_node_conclusion_payload_identity',
      sql`jsonb_typeof(${t.payload}) = 'object'
        and (${t.payload}->>'id') is not distinct from ${t.conclusionId}
        and (${t.payload}->>'evaluationNodeId') is not distinct from ${t.evaluationNodeId}
        and (${t.payload}->>'personId') is not distinct from ${t.personId}
        and (${t.payload}->'version') is not distinct from to_jsonb(${t.version})
        and (${t.payload}->>'conclusionType') is not distinct from 'defense'
        and (${t.payload}->>'origin') is not distinct from 'human_conclusion'`,
    ),
  ],
);

/** Replays refer to their exact immutable successful version, without a second JSON copy. */
export const nodeConclusionOperations = pgTable(
  'programs_node_conclusion_operations',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    operationId: text('operation_id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    conclusionId: text('conclusion_id').notNull(),
    version: integer('version').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.operationId] }),
    foreignKey({
      name: 'programs_node_conclusion_operation_version_fk',
      columns: [t.conclusionId, t.version],
      foreignColumns: [
        nodeConclusionVersions.conclusionId,
        nodeConclusionVersions.version,
      ],
    }),
    check(
      'programs_node_conclusion_operation_fingerprint',
      sql`${t.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);
