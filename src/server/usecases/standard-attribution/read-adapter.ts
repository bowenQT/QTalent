import {
  comparisonActorSchema,
  comparisonTableRowSchema,
} from '../../../contracts/judgment-comparison';
import { selectionStandardReadResultSchema } from '../../../contracts/selection-standard';
import { activeGrants } from '../../authz';
import {
  canManageNodeAssignments,
  canReadNodeTalent,
} from '../../authz/evaluation-node';
import type { Transaction } from '../../db/client';
import type {
  ComparisonDataset,
  CurrentComparisonAccess,
} from '../../modules/evaluation-system/judgment-comparison/ports';
import { projectComparison } from '../../modules/evaluation-system/judgment-comparison/projection';
import { loadEvaluationContext } from '../evaluation-context';
import { ForbiddenError } from '../project-context';
import type { AttributionDraftContext, HrAttributionBatch } from './ports';

/** Required production readers. No default fixture, empty dataset or inferred standard. */
export interface AttributionReadServices {
  readCanonicalComparisonBatch(
    tx: Transaction,
    batchId: string,
  ): Promise<ComparisonDataset | null>;
  readSelectionStandard(
    tx: Transaction,
    versionId: string,
  ): Promise<AttributionDraftContext['standard'] | null>;
}
export class AttributionReadUnavailableError extends Error {
  constructor() {
    super('标准归因读取尚未接通或事实不一致');
  }
}
type Identity = Awaited<ReturnType<typeof loadEvaluationContext>>;

export const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>;
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every((k) => Object.hasOwn(y, k) && same(x[k], y[k]))
    );
  }
  return Object.is(a, b);
};

/** Every citation must be a case of the current authorized batch, on the same
 * stage, node, standard version and source row. */
export function referencesMatch(
  batch: HrAttributionBatch,
  citations: {
    caseId: string;
    side: 'front' | 'back';
    nodeId: string;
    standardVersionId: string;
    row: unknown;
  }[],
) {
  return citations.every((c) => {
    const unit = batch.candidates.find(
      (v) => v.id === c.caseId && batch.authorizedCaseIds.includes(v.id),
    );
    const stage = unit?.[c.side];
    return (
      stage?.state === 'present' &&
      c.nodeId === stage.judgment.nodeId &&
      c.standardVersionId === stage.judgment.standardVersionId &&
      same(
        comparisonTableRowSchema.parse(c.row),
        comparisonTableRowSchema.parse(stage.judgment.row),
      )
    );
  });
}

/** Consumes canonical 919 facts; callers cannot supply grants or precomputed outcomes.
 * Source byte/row identity remains the canonical reader's responsibility.
 */
export function projectHrAttributionBatch(
  identity: Identity,
  data: ComparisonDataset,
  batchId: string,
): HrAttributionBatch | null {
  const { context, directory } = identity;
  if (data.batch.id !== batchId) throw new AttributionReadUnavailableError();
  if (
    !activeGrants(context).some(
      (g) => g.role === 'hr' && g.cohortId === data.batch.cohort.id,
    )
  )
    return null;
  const person = directory.people.find(
    (p) => p.id === context.account.personId,
  );
  const actor = comparisonActorSchema.safeParse({
    id: context.account.personId,
    name: person?.name,
  });
  if (
    !actor.success ||
    context.account.id !== directory.account.id ||
    context.account.personId !== directory.account.personId
  )
    return null;
  const grants: CurrentComparisonAccess['grants'][number][] = [];
  for (const unit of data.cases) {
    for (const nodeId of [unit.frontNodeId, unit.backNodeId]) {
      if (
        canManageNodeAssignments(context, nodeId, unit.person.id) &&
        canReadNodeTalent(
          context,
          {
            evaluationNodeId: nodeId,
            personId: unit.person.id,
            kind: 'evaluation',
          },
          'source-read',
        ) &&
        canReadNodeTalent(
          context,
          {
            evaluationNodeId: nodeId,
            personId: unit.person.id,
            kind: 'evaluation',
          },
          'model-input',
        )
      )
        grants.push({
          personId: unit.person.id,
          nodeId,
          validFrom: context.now,
          validUntil: null,
        });
    }
  }
  const page = projectComparison(data, {
    audience: 'hr',
    viewerId: actor.data.id,
    now: context.now,
    grants,
  });
  if (page.audience !== 'hr') throw new AttributionReadUnavailableError();
  return {
    accountId: context.account.id,
    actor: actor.data,
    batchId,
    mapping: page.mapping,
    authorizedCaseIds: page.cases.map((c) => c.id),
    candidates: page.cases,
  };
}

export function createAttributionReadAdapter(
  services: AttributionReadServices,
) {
  if (
    typeof services?.readCanonicalComparisonBatch !== 'function' ||
    typeof services?.readSelectionStandard !== 'function'
  )
    throw new AttributionReadUnavailableError();
  return {
    async loadHrBatch(
      tx: Transaction,
      accountId: string,
      batchId: string,
      at: string,
    ): Promise<HrAttributionBatch | null> {
      let identity: Identity;
      try {
        identity = await loadEvaluationContext(tx, accountId, at);
      } catch (error) {
        if (error instanceof ForbiddenError) return null;
        throw error;
      }
      if (!activeGrants(identity.context).some((g) => g.role === 'hr'))
        return null;
      const data = await services.readCanonicalComparisonBatch(tx, batchId);
      if (data === null) return null;
      // Canonical IO may wait; re-read authorization before disclosing its result.
      let fresh: Identity;
      try {
        fresh = await loadEvaluationContext(tx, accountId, at);
      } catch (error) {
        if (error instanceof ForbiddenError) return null;
        throw error;
      }
      if (fresh.context.account.personId !== identity.context.account.personId)
        return null;
      return projectHrAttributionBatch(fresh, data, batchId);
    },
    async readStandard(tx: Transaction, versionId: string) {
      const value = await services.readSelectionStandard(tx, versionId);
      if (value === null) return null;
      const result = selectionStandardReadResultSchema.safeParse({
        status: 'success',
        ...value,
      });
      if (
        !result.success ||
        result.data.status !== 'success' ||
        result.data.version.versionId !== versionId
      )
        throw new AttributionReadUnavailableError();
      return { version: result.data.version, content: result.data.content };
    },
  };
}
