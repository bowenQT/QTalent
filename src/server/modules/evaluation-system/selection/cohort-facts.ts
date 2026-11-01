import { eq } from 'drizzle-orm';
import type { Transaction } from '../../../db/client';
import {
  selectionCohortBindingSchema,
  selectionStandardContentSchema,
} from '../../../../contracts/selection-standard';
import { selectionCohortBindings, selectionVersionContents } from './schema';
import { SelectionPersistenceUnavailableError } from './postgres';

/** Server-internal facts for 919 import/read in the caller's transaction. This
 * does not authorize disclosure; Web/model consumers must apply current access.
 * Missing binding is null. Missing content or inconsistent persisted facts fail.
 * No current-version lookup, lifecycle write or substitute baseline is performed.
 */
export async function readSelectionCohortFacts(
  tx: Transaction,
  cohortId: string,
) {
  const row = (
    await tx
      .select()
      .from(selectionCohortBindings)
      .where(eq(selectionCohortBindings.cohortId, cohortId))
      .for('share')
  )[0];
  if (!row) return null;
  const binding = selectionCohortBindingSchema.parse(row.binding);
  if (
    binding.cohort.id !== row.cohortId ||
    binding.standardVersionId !== row.versionId ||
    Date.parse(binding.boundAt) !== row.boundAt.getTime()
  )
    throw new SelectionPersistenceUnavailableError();
  const version = (
    await tx
      .select()
      .from(selectionVersionContents)
      .where(eq(selectionVersionContents.versionId, row.versionId))
      .for('share')
  )[0];
  if (!version) throw new SelectionPersistenceUnavailableError();
  return {
    binding,
    content: selectionStandardContentSchema.parse(version.content),
  };
}
