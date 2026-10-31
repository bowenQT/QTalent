import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { z } from 'zod';
import {
  effectiveRuleVersionReadInputSchema,
  effectiveRuleVersionReadResultSchema,
  effectiveRuleVersionSchema,
  type EffectiveRuleVersionReadInput,
} from '../../../contracts/selection-standard';
import type { DbExecutor } from '../../db/client';
import { ruleVersionApplicability, ruleVersions } from './schema';

export type EffectiveRuleVersionReadResult = z.infer<
  typeof effectiveRuleVersionReadResultSchema
>;

// Call from an authorized server usecase. A version read is not a grant to its
// evidence, and no fallback to a different category or a "latest id" is allowed.
export async function readEffectiveRuleVersion(
  db: DbExecutor,
  input: EffectiveRuleVersionReadInput,
  clock: () => Date = () => new Date(),
): Promise<EffectiveRuleVersionReadResult> {
  const request = effectiveRuleVersionReadInputSchema.parse(input);
  const at = request.at === undefined ? clock() : new Date(request.at);
  if (!Number.isFinite(at.getTime()))
    throw new TypeError('Invalid rule version clock');
  const candidates = await db
    .select({
      versionId: ruleVersions.id,
      provenance: ruleVersions.provenance,
      category: ruleVersionApplicability.category,
      effectiveFrom: ruleVersionApplicability.effectiveFrom,
      effectiveUntil: ruleVersionApplicability.effectiveUntil,
    })
    .from(ruleVersionApplicability)
    .innerJoin(
      ruleVersions,
      eq(ruleVersions.id, ruleVersionApplicability.versionId),
    )
    .where(
      and(
        eq(ruleVersionApplicability.category, request.category),
        // Half-open predicates also exclude internal audit-only [t,t) periods.
        lte(ruleVersionApplicability.effectiveFrom, at),
        or(
          isNull(ruleVersionApplicability.effectiveUntil),
          gt(ruleVersionApplicability.effectiveUntil, at),
        ),
      ),
    )
    .limit(2);
  if (candidates.length === 0)
    return { status: 'not_found', message: '该类别在指定时间没有生效版本' };
  if (candidates.length > 1)
    return {
      status: 'conflict',
      message: '同一规则类别存在重叠的生效区间，请先核对版本元数据',
    };
  const row = candidates[0];
  return {
    status: 'success',
    version: effectiveRuleVersionSchema.parse({
      ...row,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil?.toISOString() ?? null,
    }),
  };
}
