/** Read-only versioned rule definitions. Publication and historical recomputation are out of scope. */
export {
  dimensions,
  ruleVersions,
  anchors,
  ruleVersionApplicability,
} from './schema';
export { readTalentEvaluationRules } from './read';
export { readEffectiveRuleVersion } from './effective-version';
export type { EffectiveRuleVersionReadResult } from './effective-version';
export {
  planLegacyRuleVersionApplicability,
  backfillLegacyRuleVersionApplicability,
} from './legacy-applicability';
export type {
  LegacyRuleUsage,
  LegacyApplicabilityPlan,
} from './legacy-applicability';
