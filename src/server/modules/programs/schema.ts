import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  boolean,
  date,
  index,
  integer,
  timestamp,
  jsonb,
  check,
  unique,
  uniqueIndex,
  primaryKey,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { people, accountBindings } from '../directory';
import type { EvaluationReassignmentReceipt } from './reassignment-contract';
export const cohorts = pgTable('programs_cohorts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});
export const enrollments = pgTable(
  'programs_enrollments',
  {
    id: text('id').primaryKey(),
    cohortId: text('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    personId: text('person_id').notNull(),
    confirmed: boolean('confirmed').notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    revokedAt: date('revoked_at'),
  },
  (t) => [
    index('programs_enrollments_cohort_person_idx').on(t.cohortId, t.personId),
  ],
);
export const assignments = pgTable(
  'programs_assignments',
  {
    id: text('id').primaryKey(),
    cohortId: text('cohort_id')
      .notNull()
      .references(() => cohorts.id),
    personId: text('person_id').notNull(),
    studentId: text('student_id').notNull(),
    kind: text('kind', { enum: ['mentor', 'assistant'] }).notNull(),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to'),
    revokedAt: date('revoked_at'),
  },
  (t) => [index('programs_assignments_person_idx').on(t.personId, t.cohortId)],
);

/** A program cohort is one node; staffing projects keep their existing cohort. */
export const evaluationNodes = pgTable(
  'programs_evaluation_nodes',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', {
      enum: ['program_cohort', 'interview', 'defense'],
    }).notNull(),
    cohortId: text('cohort_id').references(() => cohorts.id),
  },
  (t) => [
    check(
      'programs_node_kind',
      sql`${t.kind} in ('program_cohort','interview','defense')`,
    ),
    check('programs_node_name', sql`length(trim(${t.name})) > 0`),
    check(
      'programs_program_node_cohort',
      sql`${t.kind} <> 'program_cohort' or ${t.cohortId} is not null`,
    ),
    uniqueIndex('programs_one_cohort_node')
      .on(t.cohortId)
      .where(sql`${t.kind} = 'program_cohort'`),
  ],
);
export const evaluationNodeSubjects = pgTable(
  'programs_evaluation_node_subjects',
  {
    evaluationNodeId: text('evaluation_node_id')
      .notNull()
      .references(() => evaluationNodes.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.evaluationNodeId, t.personId] })],
);
export const evaluationRelations = pgTable(
  'programs_evaluation_relations',
  {
    id: text('id').primaryKey(),
    evaluationNodeId: text('evaluation_node_id').notNull(),
    personId: text('person_id').notNull(),
    evaluatorId: text('evaluator_id')
      .notNull()
      .references(() => people.id),
    kind: text('kind', {
      enum: ['evaluator', 'mentor', 'assistant', 'interviewer', 'judge'],
    }).notNull(),
    validFrom: timestamp('valid_from', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    legacyAssignmentId: text('legacy_assignment_id').references(
      () => assignments.id,
    ),
  },
  (t) => [
    foreignKey({
      columns: [t.evaluationNodeId, t.personId],
      foreignColumns: [
        evaluationNodeSubjects.evaluationNodeId,
        evaluationNodeSubjects.personId,
      ],
    }),
    unique('programs_relation_assignment_identity').on(
      t.id,
      t.evaluationNodeId,
      t.personId,
      t.evaluatorId,
    ),
    unique('programs_relation_legacy_assignment').on(t.legacyAssignmentId),
    index('programs_relation_actor_node_subject_idx').on(
      t.evaluatorId,
      t.evaluationNodeId,
      t.personId,
    ),
    check(
      'programs_relation_kind',
      sql`${t.kind} in ('evaluator','mentor','assistant','interviewer','judge')`,
    ),
    check(
      'programs_relation_validity',
      sql`${t.validTo} is null or ${t.validTo} > ${t.validFrom}`,
    ),
  ],
);
/**
 * Assignment ownership is authoritative for pending confirmation/review work.
 * Source modules keep their own payload and must check this row's current
 * relation/revision before committing. Reassignment never rewrites old scores.
 */
export const evaluationWorkItems = pgTable(
  'programs_evaluation_work_items',
  {
    id: text('id').primaryKey(),
    evaluationNodeId: text('evaluation_node_id').notNull(),
    personId: text('person_id').notNull(),
    assignedRelationId: text('assigned_relation_id').notNull(),
    assignedEvaluatorId: text('assigned_evaluator_id').notNull(),
    kind: text('kind', {
      enum: [
        'confirmation',
        'speaker',
        'unknown_person',
        'image_scope',
        'unknown_interviewer',
        'unknown_project',
        'unknown_interview_candidate',
      ],
    }).notNull(),
    resourceId: text('resource_id').notNull(),
    state: text('state', {
      enum: ['pending', 'processing', 'completed', 'cancelled'],
    }).notNull(),
    revision: integer('revision').notNull().default(1),
    updatedAt: timestamp('updated_at', {
      withTimezone: true,
      mode: 'string',
    }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [
        t.assignedRelationId,
        t.evaluationNodeId,
        t.personId,
        t.assignedEvaluatorId,
      ],
      foreignColumns: [
        evaluationRelations.id,
        evaluationRelations.evaluationNodeId,
        evaluationRelations.personId,
        evaluationRelations.evaluatorId,
      ],
    }),
    unique('programs_work_resource_identity').on(
      t.evaluationNodeId,
      t.personId,
      t.kind,
      t.resourceId,
    ),
    index('programs_work_assignment_state_idx').on(
      t.assignedRelationId,
      t.state,
    ),
    check('programs_work_revision', sql`${t.revision} > 0`),
    check(
      'programs_work_kind',
      sql`${t.kind} in ('confirmation','speaker','unknown_person','image_scope','unknown_interviewer','unknown_project','unknown_interview_candidate')`,
    ),
    check(
      'programs_work_state',
      sql`${t.state} in ('pending','processing','completed','cancelled')`,
    ),
  ],
);
export const evaluationReassignmentOperations = pgTable(
  'programs_evaluation_reassignment_operations',
  {
    accountId: text('account_id')
      .notNull()
      .references(() => accountBindings.accountId),
    operationId: text('operation_id').notNull(),
    workItemId: text('work_item_id')
      .notNull()
      .references(() => evaluationWorkItems.id),
    fingerprint: text('fingerprint').notNull(),
    receipt: jsonb('receipt').$type<EvaluationReassignmentReceipt>().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'programs_reassignment_actor_operation_pk',
      columns: [t.accountId, t.operationId],
    }),
    check(
      'programs_reassignment_fingerprint',
      sql`${t.fingerprint} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);
