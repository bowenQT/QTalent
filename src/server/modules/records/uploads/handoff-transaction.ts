import { eq } from 'drizzle-orm';
import type { Transaction } from '../../../db/client';
import { uploadIntents } from './schema';
import { readUploadCollectionMembers } from './store';
import { safeUpload } from './service';
import { validatedUploadFromFacts, type ValidatedUpload } from './handoff';

/** Caller-owned Read Committed transaction. The first lookup only locates the
 * lock: all accepted facts are re-read AFTER the existing collection quota lock.
 * Keep this transaction through current policy, parse-save and enqueue. A fact
 * is not permission; released historical uploads remain archived source facts.
 */
export async function readValidatedUploadInTransaction(
  tx: Transaction,
  reference: { uploadId: string; originalVersionId: string },
): Promise<ValidatedUpload | null> {
  return safeUpload(async () => {
    const [hint] = await tx
      .select({ recordCollectionId: uploadIntents.recordCollectionId })
      .from(uploadIntents)
      .where(eq(uploadIntents.id, reference.uploadId))
      .limit(1);
    if (!hint) return null;
    const facts = await readUploadCollectionMembers(
      tx,
      hint.recordCollectionId,
    );
    const member = facts?.members.find(
      (row) => row.intent.id === reference.uploadId,
    );
    if (!member) return null;
    return validatedUploadFromFacts(member.intent, member.object, reference);
  });
}
