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

export {
  authorizeSelectionAction,
  SelectionLifecycleError,
  planCreateSelectionRevision,
  planSaveSelectionRevision,
  planSubmitSelectionRevision,
  planWithdrawSelectionRevision,
  planReturnSelectionRevision,
  planPublishSelectionRevision,
  planUndoSelectionPublication,
  planSelectionCohortBinding,
  projectSelectionManagerRevision,
} from './selection-standard';
export type {
  SelectionAuthority,
  SelectionImpactFacts,
  SelectionRevisionRecord,
} from './selection-standard';
export {
  createSelectionPostgresStore,
  initializeSelectionBaseline,
  SelectionPersistenceUnavailableError,
} from './selection/postgres';
export type {
  SelectionPostgresServices,
  SelectionPostgresTransaction,
} from './selection/postgres';
export {
  comparisonMappings,
  comparisonBatches,
  comparisonCases,
  comparisonStages,
  comparisonManualMarks,
} from './judgment-comparison/schema';
export { readSelectionCohortFacts } from './selection/cohort-facts';
export {
  canonicalComparisonJson,
  canonicalInputFiles,
  CanonicalComparisonError,
  validateCanonicalComparisonImport,
} from './judgment-comparison/canonical-input';
export type {
  CanonicalComparisonImport,
  CanonicalComparisonSnapshot,
  CanonicalComparisonStage,
} from './judgment-comparison/canonical-input';
export {
  lockCanonicalComparisonBatch,
  readCanonicalComparisonRows,
  insertCanonicalComparisonRows,
} from './judgment-comparison/canonical-store';
