/** AI suggestions, effective confirmations and revision history are separate; no frozen profile is created here. */
export { aiSuggestions, confirmations, scoreReviews } from './schema';
export { readActiveConfirmations } from './read';
export { deriveReferencePosition } from './derive';
export type { PositionScore } from './derive';
export { writeRecordConfirmations, withdrawRecordConfirmations } from './write';
export { resolveRecordSourceFacts } from './write-policy';
