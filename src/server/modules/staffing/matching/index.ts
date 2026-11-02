export { createPostgresMatchStore, loadMatchRun } from './store';
export { createMatchingService, projectMatchingRun } from './service';
export { MatchingError } from './types';
export type { MatchRun, MatchStore, MatchScope } from './types';
export { MATCH_INPUT_VERSION } from './prompt';
export { assembleMatchingEvidence } from './evidence';
export type { MatchingEvidenceMaterial } from './evidence';
