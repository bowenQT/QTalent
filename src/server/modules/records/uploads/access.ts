import type { ReadOriginalInput } from '../../../../contracts/media';
import {
  readTalentSource,
  type LoadTalentSnapshot,
} from '../../../authz/talent';
import type { UploadTransaction } from './types';

export type OriginalAccessSnapshot = Awaited<ReturnType<LoadTalentSnapshot>> & {
  originalId?: string;
  /** Set only by the server projection after resolving ALL original content,
   * including unlinked/unresolved fragments and sensitive material. No default.
   */
  complete: boolean;
};
/** Reuse the shared source algorithm. A visible quote is insufficient for a full
 * original: all fragments in the version must pass the same current snapshot.
 */
export function createOriginalAuthorizer(
  load: (
    accountId: string,
    originalVersionId: string,
    tx?: UploadTransaction,
  ) => Promise<OriginalAccessSnapshot>,
) {
  return async (
    accountId: string,
    reference: ReadOriginalInput,
    tx?: UploadTransaction,
  ) => {
    const snapshot = await load(accountId, reference.originalVersionId, tx);
    // A newly classified node graph cannot fall through this legacy reader.
    // Use createNodeOriginalAuthorizer with the fixed 899 source capability.
    if (
      ['evaluationNodes', 'evaluationNodeSubjects', 'evaluationRelations'].some(
        (key) => Reflect.has(snapshot.context, key),
      ) ||
      snapshot.sources.some((source) =>
        source.subjects.some((subject) =>
          Reflect.has(subject, 'evaluationNodeId'),
        ),
      )
    )
      return false;
    if (!snapshot.complete || snapshot.context.account.id !== accountId)
      return false;
    if (
      'originalId' in reference &&
      snapshot.originalId !== reference.originalId
    )
      return false;
    const sources = snapshot.sources.filter(
      (s) => s.originalVersionId === reference.originalVersionId,
    );
    if (
      sources.length === 0 ||
      new Set(sources.map((source) => source.fragmentId)).size !==
        sources.length ||
      ('fragmentId' in reference &&
        !sources.some((s) => s.fragmentId === reference.fragmentId))
    )
      return false;
    for (const source of sources)
      if (!(await readTalentSource(async () => snapshot, source))) return false;
    return true;
  };
}

export interface NodeOriginalSnapshot {
  originalId: string;
  complete: boolean;
  context: {
    account: { id: string; isSystemAdmin: boolean };
    now: string;
    evaluationNodes: unknown[];
    evaluationNodeSubjects: unknown[];
    evaluationRelations: unknown[];
  };
  sources: { fragmentId: string; originalVersionId: string }[];
}
export interface NodeOriginalAuthorization<S extends NodeOriginalSnapshot> {
  authorizationNow(): string;
  load(
    accountId: string,
    originalVersionId: string,
    at: string,
    tx?: UploadTransaction,
  ): Promise<S | null>;
  /** Consume 899's CURRENT full source policy. A fragment lookup is not a grant. */
  canReadFragment(
    snapshot: S,
    reference: { fragmentId: string; originalVersionId: string },
  ): Promise<boolean>;
}
/** Separate node-aware composition, no fallback to legacy assignments or read
 * capability inferred merely from the upload owner / selected node.
 */
export function createNodeOriginalAuthorizer<S extends NodeOriginalSnapshot>(
  deps: NodeOriginalAuthorization<S>,
) {
  return async (
    accountId: string,
    reference: ReadOriginalInput,
    tx?: UploadTransaction,
  ): Promise<boolean> => {
    const at = deps.authorizationNow();
    if (!accountId || !Number.isFinite(Date.parse(at))) return false;
    const snapshot = await deps.load(
      accountId,
      reference.originalVersionId,
      at,
      tx,
    );
    if (
      !snapshot ||
      !snapshot.complete ||
      snapshot.context.account.id !== accountId ||
      snapshot.context.account.isSystemAdmin ||
      Date.parse(snapshot.context.now) !== Date.parse(at) ||
      ![
        snapshot.context.evaluationNodes,
        snapshot.context.evaluationNodeSubjects,
        snapshot.context.evaluationRelations,
      ].every(Array.isArray) ||
      ('originalId' in reference &&
        snapshot.originalId !== reference.originalId)
    )
      return false;
    const sources = snapshot.sources.filter(
      (source) => source.originalVersionId === reference.originalVersionId,
    );
    if (
      !sources.length ||
      new Set(sources.map((source) => source.fragmentId)).size !==
        sources.length ||
      ('fragmentId' in reference &&
        !sources.some((source) => source.fragmentId === reference.fragmentId))
    )
      return false;
    for (const source of sources)
      if (!(await deps.canReadFragment(snapshot, source))) return false;
    return true;
  };
}
