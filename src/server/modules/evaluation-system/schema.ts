import { sql } from 'drizzle-orm';
import type { EvaluationRuleCategory } from '../../../contracts/selection-standard';
import {
  pgTable,
  text,
  integer,
  boolean,
  unique,
  check,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
export const dimensions = pgTable(
  'evaluation_dimensions',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    axis: text('axis', { enum: ['prof', 'pot'] }).notNull(),
    core: boolean('core').notNull(),
  },
  (t) => [check('evaluation_dimension_axis', sql`${t.axis} in ('prof','pot')`)],
);
export const ruleVersions = pgTable(
  'evaluation_rule_versions',
  {
    id: text('id').primaryKey(),
    provenance: text('provenance', {
      enum: ['published', 'demo_import_snapshot'],
    }).notNull(),
    sourceCommit: text('source_commit'),
  },
  (t) => [
    check(
      'evaluation_rule_provenance',
      sql`${t.provenance} in ('published','demo_import_snapshot')`,
    ),
    check(
      'evaluation_demo_commit',
      sql`${t.provenance} <> 'demo_import_snapshot' or (${t.sourceCommit} is not null and length(${t.sourceCommit}) >= 7)`,
    ),
  ],
);
export const anchors = pgTable(
  'evaluation_anchors',
  {
    id: text('id').primaryKey(),
    dimensionId: text('dimension_id')
      .notNull()
      .references(() => dimensions.id),
    ruleVersionId: text('rule_version_id')
      .notNull()
      .references(() => ruleVersions.id),
    value: integer('value').notNull(),
    text: text('text').notNull(),
  },
  (t) => [
    check('evaluation_anchor_value', sql`${t.value} between 1 and 5`),
    check('evaluation_anchor_text', sql`length(trim(${t.text})) > 0`),
    unique('evaluation_anchor_match').on(
      t.id,
      t.dimensionId,
      t.ruleVersionId,
      t.value,
    ),
    unique('evaluation_anchor_version_value').on(
      t.dimensionId,
      t.ruleVersionId,
      t.value,
    ),
  ],
);

// Source provenance remains on ruleVersions. Applicability is explicit and does
// not change the legacy insertion shape or infer a category from provenance.
export const ruleVersionApplicability = pgTable(
  'evaluation_rule_version_applicability',
  {
    periodId: text('period_id').primaryKey(),
    versionId: text('version_id')
      .notNull()
      .references(() => ruleVersions.id),
    category: text('category').$type<EvaluationRuleCategory>().notNull(),
    effectiveFrom: timestamp('effective_from', {
      withTimezone: true,
    }).notNull(),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
  },
  (t) => [
    check(
      'evaluation_rule_applicability_category',
      sql`${t.category} in ('dimension_anchors', 'xe_selection', 'xe_weekly')`,
    ),
    check(
      'evaluation_rule_applicability_version_category',
      sql`
      (${t.category} = 'dimension_anchors' and ${t.versionId} ~ '^rubric-v[1-9][0-9]*$') or
      (${t.category} = 'xe_selection' and ${t.versionId} ~ '^xe-select-v[1-9][0-9]*$') or
      (${t.category} = 'xe_weekly' and ${t.versionId} ~ '^xe-weekly-v[1-9][0-9]*$')
    `,
    ),
    check(
      'evaluation_rule_applicability_window',
      sql`
      isfinite(${t.effectiveFrom}) and
      (${t.effectiveUntil} is null or (isfinite(${t.effectiveUntil}) and ${t.effectiveUntil} >= ${t.effectiveFrom}))
    `,
    ),
    index('evaluation_rule_applicability_version_idx').on(t.versionId),
    index('evaluation_rule_applicability_lookup_idx').on(
      t.category,
      t.effectiveFrom,
    ),
  ],
);
