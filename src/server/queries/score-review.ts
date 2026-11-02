import 'server-only';
import { readScoreReviewQueue } from '../modules/talent/score-review/service';
import type { ScoreReviewRequestPorts } from '../modules/talent/score-review/ports';

/** Explicit composition seam until BOW-899 authorization and BOW-846 persistence land. */
export async function readScoreReviewQueueForCurrentUser(
  ports: ScoreReviewRequestPorts,
) {
  return readScoreReviewQueue(ports.repository, await ports.currentAccountId());
}
