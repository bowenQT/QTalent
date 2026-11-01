import { z } from 'zod';
import {
  immutableNodeConclusion,
  NodeConclusionError,
  nodeConclusionVersionSchema,
  type NodeConclusionVersion,
} from '../node-conclusion';

const storedVersionSchema = z.object({
  conclusionId: z.string(),
  version: z.number().int().positive(),
  evaluationNodeId: z.string(),
  personId: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

/** Storage integrity only; callers must still authorize the current read. */
export function decodeStoredNodeConclusion(
  row: unknown,
): NodeConclusionVersion {
  try {
    const stored = storedVersionSchema.parse(row);
    const conclusion = nodeConclusionVersionSchema.parse(stored.payload);
    for (const [column, field] of [
      ['conclusionId', 'id'],
      ['version', 'version'],
      ['evaluationNodeId', 'evaluationNodeId'],
      ['personId', 'personId'],
    ] as const) {
      // Domain normalization must not repair a mismatched persisted identity.
      if (
        stored[column] !== stored.payload[field] ||
        stored[column] !== conclusion[field]
      ) {
        throw new NodeConclusionError('conflict', '已存节点结论不可用');
      }
    }
    return immutableNodeConclusion(conclusion);
  } catch {
    // Do not attach the raw row, Zod issues, or an original error as the cause.
    throw new NodeConclusionError('conflict', '已存节点结论不可用');
  }
}
