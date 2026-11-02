import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  comparisonCohortSchema,
  comparisonManagerBasisSchema,
  comparisonMappingSchema,
  comparisonStageSchema,
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
import { accountBindings, grants, people } from '../modules/directory';
import { cohorts } from '../modules/programs';
import { fragments, originals, originalVersions } from '../modules/records';
import {
  comparisonBatches,
  standardAttributions,
  selectionDraftProposals,
  canonicalComparisonJson,
  type CanonicalComparisonSnapshot,
  type CanonicalComparisonStage,
} from '../modules/evaluation-system';
import { selectionCohortBindings } from '../modules/evaluation-system/selection/schema';
import { calculateComparison } from '../modules/evaluation-system/judgment-comparison/calculation';
import type { ComparisonFacts } from '../modules/evaluation-system/judgment-comparison/ports';
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
import { readCanonicalComparisonBatch } from './judgment-comparison-canonical';

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
async function actualCohort(tx: Transaction, id: string) {
  const [value] = await tx.select().from(cohorts).where(eq(cohorts.id, id));
  return value ?? unavailable();
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
  // A read-only transaction cannot take row locks. The selection store runs it
  // at Repeatable Read, so access facts and canonical rows share one snapshot.
  const mode = await tx.execute<{ readOnly: string }>(
    sql`select current_setting('transaction_read_only') as "readOnly"`,
  );
  const value = await readCanonicalComparisonBatch(tx, batchId, {
    lock: mode.rows[0]?.readOnly !== 'on',
  });
  if (!value) return unavailable();
  return value;
}

/** Only the manager's aggregate is produced here, never a second page loadBatch.
 * Cases are transient real facts for the existing919 algorithm. */
async function summaryFacts(
  tx: Transaction,
  snapshot: CanonicalComparisonSnapshot,
) {
  const { facts } = snapshot;
  const cohort = await actualCohort(tx, facts.batch.cohortId);
  const personIds = [
    ...new Set([
      facts.mapping.confirmedById,
      ...facts.manualMarks.map((m) => m.markedById),
      ...facts.cases.flatMap((unit) => [
        unit.personId,
        ...(unit.front.state === 'present' ? [unit.front.evaluatorId] : []),
        ...(unit.back.state === 'present' ? [unit.back.evaluatorId] : []),
      ]),
    ]),
  ];
  const persons = await tx
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, personIds));
  const actor = (id: string) =>
    persons.find((p) => p.id === id) ?? unavailable();
  const sourceIds = [
    ...new Set(
      facts.cases
        .flatMap((unit) => [
          unit.front.source?.fragmentId,
          unit.back.source?.fragmentId,
        ])
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const rows = sourceIds.length
    ? await tx
        .select({
          id: fragments.id,
          versionId: fragments.originalVersionId,
          excerpt: fragments.excerpt,
          location: fragments.location,
          title: originals.title,
        })
        .from(fragments)
        .innerJoin(
          originalVersions,
          eq(originalVersions.id, fragments.originalVersionId),
        )
        .innerJoin(originals, eq(originals.id, originalVersions.originalId))
        .where(inArray(fragments.id, sourceIds))
    : [];
  function stage(value: CanonicalComparisonStage, nodeId: string) {
    if (value.state === 'missing')
      return comparisonStageSchema.parse({
        state: 'missing',
        reason: value.reason,
      });
    const source =
      rows.find(
        (row) =>
          row.id === value.source.fragmentId &&
          row.versionId === value.source.originalVersionId,
      ) ?? unavailable();
    return comparisonStageSchema.parse({
      state: 'present',
      judgment: {
        judgmentId: value.judgmentId,
        nodeId,
        cohortId: cohort.id,
        standardVersionId: value.sourceStandardReference,
        scaleId: value.scaleId,
        grade: value.grade,
        evaluator: actor(value.evaluatorId),
        evaluatedAt: value.evaluatedAt,
        confirmation: value.confirmation,
        row: {
          personId: value.source.rowPersonId,
          row: value.source.row,
          source: {
            fragmentId: source.id,
            originalVersionId: source.versionId,
            location: source.location,
            excerpt: source.excerpt,
            originalTitle: source.title,
            recordedByName: null,
            sourceCategory: 'original',
            sourceType: 'spreadsheet',
            demo: facts.batch.nature === 'demo_rebuilt',
          },
        },
      },
    });
  }
  const mapping = comparisonMappingSchema.parse({
    versionId: facts.mapping.versionId,
    frontScaleId: facts.mapping.frontScaleId,
    backScaleId: facts.mapping.backScaleId,
    rows: facts.mapping.rows,
    confirmedBy: actor(facts.mapping.confirmedById),
    confirmedAt: facts.mapping.confirmedAt,
  });
  const cases = facts.cases.map((unit) => {
    const mark = facts.manualMarks.find((m) => m.caseId === unit.id);
    const value: ComparisonFacts = {
      id: unit.id,
      batchId: facts.batch.id,
      person: actor(unit.personId),
      judgment: unit.judgment,
      cohort,
      selectionStandardVersionId: snapshot.selectionStandardVersionId,
      mappingVersionId: facts.mapping.versionId,
      frontNodeId: unit.frontNodeId,
      backNodeId: unit.backNodeId,
      work: unit.work,
      front: stage(unit.front, unit.frontNodeId),
      back: stage(unit.back, unit.backNodeId),
      ...(mark
        ? {
            nonComparable: {
              reason: mark.reason,
              markedBy: actor(mark.markedById),
              markedAt: mark.markedAt,
            },
          }
        : {}),
    };
    return calculateComparison(value, mapping);
  });
  return { cohort, cases };
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
  for (const id of [...ids, next.id]) authorizeScope(authority, id);
  // A descriptor is not a pre-created cohort. Existing/bound next IDs need a new
  // reviewed plan; they cannot be relabelled as a future cohort.
  if (
    (
      await tx
        .select({ id: cohorts.id })
        .from(cohorts)
        .where(eq(cohorts.id, next.id))
    ).length
  )
    conflict();
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
      batch: {
        id: snapshot.facts.batch.id,
        name: snapshot.facts.batch.name,
        cohort: facts.cohort,
        mappingVersionId: snapshot.facts.mapping.versionId,
        selectionStandardVersionId: snapshot.selectionStandardVersionId,
      },
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
