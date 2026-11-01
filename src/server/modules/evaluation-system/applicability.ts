import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { selectionVersionIdSchema } from '../../../contracts/judgment-comparison';
import {
  evaluationRuleCategorySchema,
  type EvaluationRuleCategory,
} from '../../../contracts/selection-standard';
import type { Transaction } from '../../db/client';
import { ruleVersionApplicability, ruleVersions } from './schema';

/** Internal conflict; callers map it to their existing conflict response. */
export class RuleApplicabilityConflictError extends Error {
  readonly code = 'conflict';
  constructor() {
    super('Rule applicability changed or contains an inconsistent interval');
    this.name = 'RuleApplicabilityConflictError';
  }
}
/** Transaction-scoped built-in PG locks. Multi-category callers use one sorted call. */
export async function lockRuleCategory(
  tx: Transaction,
  category: EvaluationRuleCategory | readonly EvaluationRuleCategory[],
): Promise<void> {
  if (typeof tx.rollback !== 'function')
    throw new TypeError(
      'Rule applicability writes require an explicit transaction',
    );
  const categories = [
    ...new Set(
      (Array.isArray(category) ? category : [category]).map((value) =>
        evaluationRuleCategorySchema.parse(value),
      ),
    ),
  ].sort();
  for (const value of categories)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'qtalent:rule-category:' + value}, 0))`,
    );
}
const id = z.string().min(1).max(200).regex(/\S/);
const switchInputSchema = z.strictObject({
  expectedPeriodId: id.nullable(),
  newPeriodId: id,
  versionId: selectionVersionIdSchema,
  at: z.date(),
});
export type SelectionApplicabilitySwitch = z.infer<typeof switchInputSchema>;
export type RuleApplicabilityPeriod =
  typeof ruleVersionApplicability.$inferSelect;
function conflict(): never {
  throw new RuleApplicabilityConflictError();
}
function checkedTime(date: Date): number {
  const result = date.getTime();
  if (!Number.isFinite(result)) conflict();
  return result;
}
/** Category lock first; 918 owns lifecycle/authorization/audit and the outer tx.
 * No operation ledger here: an already-used period ID is a conflict, not a replay.
 */
export async function switchSelectionApplicability(
  tx: Transaction,
  input: SelectionApplicabilitySwitch,
): Promise<RuleApplicabilityPeriod> {
  const parsed = switchInputSchema.safeParse(input);
  if (!parsed.success) conflict();
  const request = parsed.data;
  const at = checkedTime(request.at);
  await lockRuleCategory(tx, 'xe_selection');
  const periods = await tx
    .select()
    .from(ruleVersionApplicability)
    .where(eq(ruleVersionApplicability.category, 'xe_selection'))
    .for('update');
  const occupied = await tx
    .select({ id: ruleVersionApplicability.periodId })
    .from(ruleVersionApplicability)
    .where(eq(ruleVersionApplicability.periodId, request.newPeriodId))
    .limit(1);
  const versions = await tx
    .select({ id: ruleVersions.id })
    .from(ruleVersions)
    .where(eq(ruleVersions.id, request.versionId))
    .for('key share');
  if (occupied.length > 0 || versions.length !== 1) conflict();
  const ordered = periods
    .map((period) => ({
      period,
      from: checkedTime(period.effectiveFrom),
      until:
        period.effectiveUntil === null
          ? null
          : checkedTime(period.effectiveUntil),
    }))
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.period.periodId.localeCompare(right.period.periodId),
    );
  let previous: (typeof ordered)[number] | undefined;
  for (const item of ordered) {
    // Future boundaries and closed scheduled ends must not be rewritten.
    if (
      item.from > at ||
      (item.until !== null && (item.until < item.from || item.until > at))
    )
      conflict();
    if (item.until === item.from) continue; // audit-only empty interval
    if (previous && (previous.until === null || item.from < previous.until))
      conflict();
    previous = item;
  }
  const current = ordered.filter(
    (item) => item.from <= at && (item.until === null || item.until > at),
  );
  if (
    current.length > 1 ||
    (current[0]?.period.periodId ?? null) !== request.expectedPeriodId
  )
    conflict();
  if (current[0]) {
    const updated = await tx
      .update(ruleVersionApplicability)
      .set({ effectiveUntil: new Date(at) })
      .where(
        and(
          eq(ruleVersionApplicability.periodId, current[0].period.periodId),
          isNull(ruleVersionApplicability.effectiveUntil),
        ),
      )
      .returning({ id: ruleVersionApplicability.periodId });
    if (updated.length !== 1) conflict();
  }
  const [period] = await tx
    .insert(ruleVersionApplicability)
    .values({
      periodId: request.newPeriodId,
      versionId: request.versionId,
      category: 'xe_selection',
      effectiveFrom: new Date(at),
      effectiveUntil: null,
    })
    .returning();
  return period;
}
