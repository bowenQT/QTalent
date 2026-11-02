import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  comparisonCohortSchema,
  comparisonManagerBasisSchema,
  comparisonTableRowSchema,
} from '../../contracts/judgment-comparison';
import { revisionEligibleAttributionSchema } from '../../contracts/standard-attribution';
import type { Transaction } from '../db/client';
import { activeGrants, isCurrent } from '../authz';
import {
  canReadNodeTalent,
  canManageNodeAssignments,
  cohortHrCanReadNodeSubject,
} from '../authz/evaluation-node';
import { accountBindings, grants } from '../modules/directory';
import { cohorts } from '../modules/programs';
import {
  comparisonBatches,
  standardAttributions,
  selectionDraftProposals,
  canonicalComparisonJson,
  type CanonicalComparisonSnapshot,
} from '../modules/evaluation-system';
import { selectionCohortBindings } from '../modules/evaluation-system/selection/schema';
import { calculateComparison } from '../modules/evaluation-system/judgment-comparison/calculation';
import {
  authorizeSelectionAction,
  SelectionLifecycleError,
  type SelectionAuthority,
  type SelectionImpactFacts,
} from '../modules/evaluation-system/selection-standard';
import {
  SelectionPersistenceUnavailableError,
  readCurrentSelectionStandard,
  readStoredSelectionCohortBinding,
} from '../modules/evaluation-system/selection/postgres';
import { selectionDraftProposalSchema } from './standard-attribution/hypotheses';
import { loadEvaluationContext } from './evaluation-context';
import {
  comparisonDatasetFromSnapshot,
  readCanonicalForTransaction,
} from './judgment-comparison-dataset';

const nextFactSchema = comparisonCohortSchema
  .extend({ sourceReference: z.string().trim().min(1) })
  .strict();
/** Trusted server configuration only. No default, sequence inference or browser field. */
export type ReviewedNextSelectionCohort = z.infer<typeof nextFactSchema>;
const unavailable = (): never => {
  throw new SelectionPersistenceUnavailableError();
};
const conflict = (): never => {
  throw new SelectionLifecycleError('conflict', '归因、标准或影响事实已变化');
};
const same = (a: unknown, b: unknown) =>
  canonicalComparisonJson(a) === canonicalComparisonJson(b);
function authorizeScope(authority: SelectionAuthority, cohortId: string) {
  if (
    activeGrants(authority.context).some(
      (g) => g.role === 'manager' && g.scope === 'company',
    )
  )
    authorizeSelectionAction(authority, 'manager');
  else authorizeSelectionAction(authority, 'hr', cohortId);
}
async function authorizedCanonical(
  tx: Transaction,
  authority: SelectionAuthority,
  batchId: string,
) {
  const [route] = await tx
    .select({ cohortId: comparisonBatches.cohortId })
    .from(comparisonBatches)
    .where(eq(comparisonBatches.id, batchId));
  if (!route)
    throw new SelectionLifecycleError('not_found', '对照批次不存在或不可见');
  authorizeScope(authority, route.cohortId);
  const value = await readCanonicalForTransaction(tx, batchId);
  if (!value) return unavailable();
  return value;
}

/** The canonical batch as the comparison reader sees it, with each outcome
 * computed by the existing 919 algorithm. Cases are transient real facts. */
async function summaryFacts(
  tx: Transaction,
  snapshot: CanonicalComparisonSnapshot,
) {
  const data = await comparisonDatasetFromSnapshot(tx, snapshot);
  return {
    batch: data.batch,
    cases: data.cases.map((unit) => calculateComparison(unit, data.mapping)),
  };
}

/** Persisted results/bindings for a known authorized scope. A saved preview keeps
 * this exact scope on refresh; it does not grow into a manager-global preview. */
export async function readNativeSelectionImpact(
  tx: Transaction,
  authority: SelectionAuthority,
  reviewedNext: ReviewedNextSelectionCohort | null,
  scopeCohortIds: readonly string[],
): Promise<SelectionImpactFacts> {
  if (reviewedNext === null) unavailable();
  const next = nextFactSchema.parse(reviewedNext);
  const ids = [...new Set(scopeCohortIds)].sort();
  if (!ids.length) unavailable();
  for (const id of ids) authorizeScope(authority, id);
  // A descriptor is not a pre-created cohort. Existing/bound next IDs need a new
  // reviewed plan; they cannot be relabelled as a future cohort. A future cohort
  // has no grant to hold yet, so only an existing one is checked for scope.
  if (
    (
      await tx
        .select({ id: cohorts.id })
        .from(cohorts)
        .where(eq(cohorts.id, next.id))
    ).length
  ) {
    authorizeScope(authority, next.id);
    conflict();
  }
  // Prevent a newly imported result batch appearing between preview comparison
  // and publication commit. Existing rows use919's batch/row locks below.
  await tx.execute(sql`lock table evaluation_comparison_batches in share mode`);
  const bindings = await tx
    .select()
    .from(selectionCohortBindings)
    .where(inArray(selectionCohortBindings.cohortId, ids))
    .orderBy(selectionCohortBindings.cohortId);
  const preservedBindings = await Promise.all(
    bindings.map(
      async (row) =>
        (await readStoredSelectionCohortBinding(tx, row.cohortId)) ??
        unavailable(),
    ),
  );
  const batches = await tx
    .select({ id: comparisonBatches.id })
    .from(comparisonBatches)
    .where(inArray(comparisonBatches.cohortId, ids))
    .orderBy(comparisonBatches.id);
  const currentIdentity = await loadEvaluationContext(
    tx,
    authority.context.account.id,
    authority.context.now,
  );
  if (currentIdentity.context.account.personId !== authority.actor.id)
    throw new SelectionLifecycleError('forbidden', '当前账号绑定已变化');
  const results = new Map<
    string,
    { cohortId: string; standardVersionId: string; identities: Set<string> }
  >();
  for (const batch of batches) {
    const snapshot = await authorizedCanonical(tx, authority, batch.id);
    const cohortId = snapshot.facts.batch.cohortId;
    const standardVersionId = snapshot.selectionStandardVersionId;
    const key = JSON.stringify([cohortId, standardVersionId]);
    const group = results.get(key) ?? {
      cohortId,
      standardVersionId,
      identities: new Set<string>(),
    };
    for (const unit of snapshot.facts.cases)
      // Counted under the cohort HR's current source rule, not the caller's own
      // reach: HR's saved preview and the manager's publish check must agree.
      if (
        unit.front.state === 'present' &&
        cohortHrCanReadNodeSubject(
          currentIdentity.context,
          cohortId,
          unit.frontNodeId,
          unit.personId,
        )
      )
        group.identities.add(
          JSON.stringify([
            unit.personId,
            unit.frontNodeId,
            unit.front.judgmentId,
          ]),
        );
    results.set(key, group);
  }
  // Counting follows the cohort HR rule, so a counted cohort with no current HR
  // has no rule to count under: refuse rather than produce a number.
  const counted = [...new Set([...results.values()].map((g) => g.cohortId))];
  if (counted.length) {
    const hr = await tx
      .select({
        cohortId: grants.cohortId,
        validFrom: grants.validFrom,
        validTo: grants.validTo,
        revokedAt: grants.revokedAt,
      })
      .from(grants)
      .innerJoin(
        accountBindings,
        eq(accountBindings.accountId, grants.accountId),
      )
      .where(
        and(
          eq(grants.role, 'hr'),
          eq(grants.scope, 'cohort'),
          eq(accountBindings.isSystemAdmin, false),
          inArray(grants.cohortId, counted),
        ),
      );
    for (const cohortId of counted)
      if (
        !hr.some(
          (grant) =>
            grant.cohortId === cohortId &&
            isCurrent(grant, authority.context.now),
        )
      )
        throw new SelectionLifecycleError(
          'conflict',
          '期次当前没有 HR，无法计算影响',
        );
  }
  return {
    nextCohort: { id: next.id, name: next.name },
    preservedBindings,
    existingResults: [...results.values()].map(({ identities, ...group }) => ({
      ...group,
      count: identities.size,
    })),
  };
}

/** Only routing metadata is loaded before current scope authorization. */
/** The signed basis must still be entirely disclosed to the current caller.
 * Historical signature does not create a current grant; full row identity is
 * compared, not just ids.
 */
async function disclosedBasisCases(
  tx: Transaction,
  authority: SelectionAuthority,
  snapshot: CanonicalComparisonSnapshot,
  basis: z.infer<typeof revisionEligibleAttributionSchema>,
) {
  const identity = await loadEvaluationContext(
    tx,
    authority.context.account.id,
    authority.context.now,
  );
  if (identity.context.account.personId !== authority.actor.id)
    throw new SelectionLifecycleError('forbidden', '当前账号绑定已变化');
  const facts = await summaryFacts(tx, snapshot);
  const allowed = facts.cases.filter((unit) =>
    [unit.frontNodeId, unit.backNodeId].every(
      (evaluationNodeId) =>
        canManageNodeAssignments(
          identity.context,
          evaluationNodeId,
          unit.person.id,
        ) &&
        canReadNodeTalent(
          identity.context,
          { evaluationNodeId, personId: unit.person.id, kind: 'evaluation' },
          'source-read',
        ),
    ),
  );
  const disclosed: { caseId: string; side: 'front' | 'back' }[] = [];
  for (const citation of basis.citations) {
    const unit = allowed.find((c) => c.id === citation.caseId);
    const stage = unit?.[citation.side];
    if (
      !stage ||
      stage.state !== 'present' ||
      citation.nodeId !== stage.judgment.nodeId ||
      citation.standardVersionId !== stage.judgment.standardVersionId ||
      !same(comparisonTableRowSchema.parse(citation.row), stage.judgment.row)
    )
      throw new SelectionLifecycleError(
        'forbidden',
        '归因引用不在当前授权范围或来源已变化',
      );
    disclosed.push({ caseId: citation.caseId, side: citation.side });
  }
  return { identity, facts, allowed, disclosed };
}

/** Re-checks a stored private basis before an HR read returns its citations.
 * Returns each citation it verified, so the store can tell a real check from a stub. */
export async function assertSelectionBasisDisclosed(
  tx: Transaction,
  authority: SelectionAuthority,
  raw: unknown,
) {
  const basis = revisionEligibleAttributionSchema.parse(raw);
  const snapshot = await authorizedCanonical(tx, authority, basis.batchId);
  authorizeSelectionAction(authority, 'hr', snapshot.facts.batch.cohortId);
  const { disclosed } = await disclosedBasisCases(
    tx,
    authority,
    snapshot,
    basis,
  );
  return { citations: disclosed };
}

export async function readNativeSelectionCreationFacts(
  tx: Transaction,
  authority: SelectionAuthority,
  input: {
    attributionId: string;
    expectedAttributionRevision: number;
    baseVersionId: string;
  },
  reviewedNext: ReviewedNextSelectionCohort | null,
) {
  const [route] = await tx
    .select({ batchId: standardAttributions.batchId })
    .from(standardAttributions)
    .where(eq(standardAttributions.id, input.attributionId));
  if (!route)
    throw new SelectionLifecycleError('not_found', '归因不存在或不可见');
  const snapshot = await authorizedCanonical(tx, authority, route.batchId);
  const scopeCohortId = snapshot.facts.batch.cohortId;
  authorizeSelectionAction(authority, 'hr', scopeCohortId);
  const [row] = await tx
    .select()
    .from(standardAttributions)
    .where(eq(standardAttributions.id, input.attributionId))
    .for('share');
  if (!row) unavailable();
  const basis = revisionEligibleAttributionSchema.parse(row.payload);
  if (
    basis.id !== row.id ||
    basis.revision !== row.revision ||
    basis.batchId !== row.batchId ||
    basis.revision !== input.expectedAttributionRevision ||
    row.confirmedByPersonId !== basis.confirmedBy.id ||
    Date.parse(row.confirmedAt) !== Date.parse(basis.confirmedAt)
  )
    conflict();
  const { identity, facts, allowed } = await disclosedBasisCases(
    tx,
    authority,
    snapshot,
    basis,
  );
  const standard = await readCurrentSelectionStandard(
    tx,
    input.baseVersionId,
    () => new Date(authority.context.now),
  );
  if (!standard || snapshot.selectionStandardVersionId !== input.baseVersionId)
    conflict();
  const scopeIds = activeGrants(identity.context)
    .filter((g) => g.role === 'hr' && typeof g.cohortId === 'string')
    .map((g) => g.cohortId!)
    .filter((id) => id !== reviewedNext?.id);
  const managerBasis = [
    comparisonManagerBasisSchema.parse({
      batch: facts.batch,
      discrepancyPeople: new Set(
        allowed
          .filter((unit) =>
            ['front_higher', 'front_lower'].includes(unit.outcome.state),
          )
          .map((unit) => unit.person.id),
      ).size,
      attributionCategories: basis.categories,
    }),
  ];
  return {
    scopeCohortId,
    basis,
    managerBasis,
    impact: await readNativeSelectionImpact(
      tx,
      authority,
      reviewedNext,
      scopeIds,
    ),
  };
}

/** This reader cannot edit a revision. Late model proposals are never an update
 * to an existing humanVersion; adoption is only the initial new-draft path. */
export async function readNativeSelectionProposal(
  tx: Transaction,
  authority: SelectionAuthority,
  proposalId: string,
  expected: {
    attributionId: string;
    expectedAttributionRevision: number;
    baseVersionId: string;
  },
  reviewedNext: ReviewedNextSelectionCohort | null,
) {
  const facts = await readNativeSelectionCreationFacts(
    tx,
    authority,
    expected,
    reviewedNext,
  );
  const [row] = await tx
    .select()
    .from(selectionDraftProposals)
    .where(
      and(
        eq(selectionDraftProposals.id, proposalId),
        eq(selectionDraftProposals.attributionId, facts.basis.id),
      ),
    )
    .for('share');
  if (!row)
    throw new SelectionLifecycleError('not_found', 'AI提案不存在或不可见');
  const proposal = selectionDraftProposalSchema.parse(row.payload);
  if (
    proposal.id !== row.id ||
    proposal.baseVersionId !== expected.baseVersionId ||
    row.baseVersionId !== expected.baseVersionId ||
    row.attributionRevision !== facts.basis.revision ||
    !same(proposal.aiDraft.basis, facts.basis)
  )
    conflict();
  return { facts, proposal };
}
