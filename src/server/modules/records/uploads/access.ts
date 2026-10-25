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
