/** Versioned rules, effective reads, and transactional applicability. */
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
export {
  lockRuleCategory,
  switchSelectionApplicability,
  RuleApplicabilityConflictError,
} from './applicability';
export type {
  SelectionApplicabilitySwitch,
  RuleApplicabilityPeriod,
} from './applicability';
