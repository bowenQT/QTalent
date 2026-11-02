import { resolveScoreReview } from './service';
import type { ScoreReviewRequestPorts } from './ports';

/** Composition helper only. A real use-server action awaits 899/846 adapters. */
export async function resolveScoreReviewRequest(
  input: unknown,
  ports: ScoreReviewRequestPorts,
) {
  return resolveScoreReview(
    ports.repository,
    await ports.currentAccountId(),
    input,
    () => ports.now(),
  );
}
