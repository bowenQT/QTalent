import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { EvaluationRuleCategory } from '../../../contracts/selection-standard';
import type { Transaction } from '../../db/client';
import { lockRuleCategory } from './applicability';
import { ruleVersionApplicability, ruleVersions } from './schema';

const legacyCategories = new Map<string, EvaluationRuleCategory>([
  ['rubric-v1', 'dimension_anchors'],
  ['xe-weekly-v1', 'xe_weekly'],
]);
export type LegacyRuleUsage = { ruleVersionId: string; usedAt: Date };
export type LegacyApplicabilityPlan = {
  rows: (typeof ruleVersionApplicability.$inferInsert)[];
  unresolved: {
    versionId: string;
    reason:
      | 'unrecognized_legacy_version'
      | 'missing_usage_time'
      | 'invalid_usage_time';
  }[];
};

// Usage times must come from validated source/seed facts. The earliest observed
// use is an applicability boundary, never a fabricated publication timestamp.
// Unknown versions receive no category, date, score or reverse inference.
export function planLegacyRuleVersionApplicability(
  versionIds: readonly string[],
  usages: readonly LegacyRuleUsage[],
): LegacyApplicabilityPlan {
  const plan: LegacyApplicabilityPlan = { rows: [], unresolved: [] };
  for (const versionId of new Set(versionIds)) {
    const category = legacyCategories.get(versionId);
    if (category === undefined) {
      plan.unresolved.push({
        versionId,
        reason: 'unrecognized_legacy_version',
      });
      continue;
    }
    const observations = usages.filter(
      (usage) => usage.ruleVersionId === versionId,
    );
    if (observations.length === 0) {
      plan.unresolved.push({ versionId, reason: 'missing_usage_time' });
      continue;
    }
    const times = observations.map((usage) => usage.usedAt.getTime());
    if (times.some((time) => !Number.isFinite(time))) {
      plan.unresolved.push({ versionId, reason: 'invalid_usage_time' });
      continue;
    }
    plan.rows.push({
      periodId: `legacy:${versionId}`,
      versionId,
      category,
      effectiveFrom: new Date(Math.min(...times)),
      effectiveUntil: null,
    });
  }
  return plan;
}

// For an explicitly invoked data migration or seed transaction, never startup.
// Only missing metadata for the two known baseline versions is filled. Existing
// applicability (including an end date from a later publication) is preserved.
export async function backfillLegacyRuleVersionApplicability(
  db: Transaction,
  usages: readonly LegacyRuleUsage[],
): Promise<string[]> {
  await lockRuleCategory(db, ['dimension_anchors', 'xe_weekly']);
  const missing = await db
    .select({ id: ruleVersions.id })
    .from(ruleVersions)
    .leftJoin(
      ruleVersionApplicability,
      eq(ruleVersions.id, ruleVersionApplicability.versionId),
    )
    .where(
      and(
        inArray(ruleVersions.id, [...legacyCategories.keys()]),
        isNull(ruleVersionApplicability.versionId),
      ),
    );
  const plan = planLegacyRuleVersionApplicability(
    missing.map((row) => row.id),
    usages,
  );
  if (plan.unresolved.length > 0) {
    throw new Error(
      `Legacy rule applicability requires validated usage dates: ${plan.unresolved.map((item) => item.versionId).join(', ')}`,
    );
  }
  if (plan.rows.length === 0) return [];
  const inserted = await db
    .insert(ruleVersionApplicability)
    .values(plan.rows)
    .returning({ versionId: ruleVersionApplicability.versionId });
  return inserted.map((row) => row.versionId);
}
