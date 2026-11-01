import { eq, inArray } from 'drizzle-orm';
import type { Transaction } from '../db/client';
import { accountBindings, grants, people } from '../modules/directory';
import {
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
  enrollments,
} from '../modules/programs';

/** Locks facts only; callers still load current authorization after all waits.
 * Enter after collection/job/input/original locks, with the complete subject set.
 */
export async function lockMediaAuthorityFacts(
  tx: Transaction,
  accountId: string,
  personIds: readonly string[],
  nodeIds: readonly string[],
) {
  const ids = [...new Set(personIds)].sort();
  const nodes = [...new Set(nodeIds)].sort();
  if (!ids.length || !nodes.length) throw new Error('media_scope_required');
  await tx
    .select()
    .from(accountBindings)
    .where(eq(accountBindings.accountId, accountId))
    .for('share');
  await tx
    .select()
    .from(grants)
    .where(eq(grants.accountId, accountId))
    .orderBy(grants.id)
    .for('share');
  await tx
    .select()
    .from(people)
    .where(inArray(people.id, ids))
    .orderBy(people.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodes)
    .where(inArray(evaluationNodes.id, nodes))
    .orderBy(evaluationNodes.id)
    .for('share');
  await tx
    .select()
    .from(evaluationNodeSubjects)
    .where(inArray(evaluationNodeSubjects.personId, ids))
    .for('share');
  await tx
    .select()
    .from(evaluationRelations)
    .where(inArray(evaluationRelations.personId, ids))
    .orderBy(evaluationRelations.id)
    .for('share');
  await tx
    .select()
    .from(enrollments)
    .where(inArray(enrollments.personId, ids))
    .orderBy(enrollments.id)
    .for('share');
}
