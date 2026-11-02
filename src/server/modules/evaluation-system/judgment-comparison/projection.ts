import {
  COMPARISON_RATER_MIN_CASES,
  comparisonBatchSchema,
  comparisonHrPageSchema,
  comparisonManagerPageSchema,
  comparisonRaterCaseSchema,
  createAuthorizedRaterComparisonSchema,
  type ComparisonCase,
  type ComparisonHrPage,
  type ComparisonManagerPage,
  type ComparisonRaterPage,
} from '@/contracts/judgment-comparison';
import { calculateComparison, summarizeComparisons } from './calculation';
import {
  ComparisonInputError,
  type ComparisonDataset,
  type ComparisonFacts,
  type CurrentComparisonAccess,
} from './ports';

const policy = {
  conclusionScope: 'evaluation_system_only',
  laterStageUse: 'comparison_not_ground_truth',
} as const;
const names = new Intl.Collator('zh-CN');
const comparable = (unit: ComparisonCase) =>
  !['missing', 'not_comparable'].includes(unit.outcome.state);

function sample(
  cases: readonly ComparisonCase[],
): ComparisonRaterPage['sample'] {
  const eligible = cases.filter(comparable);
  const basis = {
    threshold: COMPARISON_RATER_MIN_CASES,
    comparableCaseCount: eligible.length,
    caseIds: eligible.map(({ id }) => id),
  } as const;
  return eligible.length < COMPARISON_RATER_MIN_CASES
    ? { ...basis, state: 'insufficient_sample', label: '样本不足' }
    : {
        ...basis,
        state: 'sufficient_sample',
        distribution: summarizeComparisons(eligible),
      };
}

function canReadStage(
  access: CurrentComparisonAccess,
  unit: ComparisonFacts,
  nodeId: string,
): boolean {
  const now = Date.parse(access.now);
  return access.grants.some(
    (grant) =>
      grant.personId === unit.person.id &&
      grant.nodeId === nodeId &&
      Date.parse(grant.validFrom) <= now &&
      (grant.validUntil === null || now < Date.parse(grant.validUntil)),
  );
}

function identity(unit: ComparisonFacts) {
  return {
    id: unit.id,
    batchId: unit.batchId,
    person: unit.person,
    judgment: unit.judgment,
    cohort: unit.cohort,
    selectionStandardVersionId: unit.selectionStandardVersionId,
    mappingVersionId: unit.mappingVersionId,
    frontNodeId: unit.frontNodeId,
    backNodeId: unit.backNodeId,
    work: unit.work,
  };
}

export function projectComparison(
  data: ComparisonDataset,
  access: CurrentComparisonAccess,
  evaluatorId?: string,
): ComparisonHrPage | ComparisonRaterPage | ComparisonManagerPage {
  const batch = comparisonBatchSchema.parse(data.batch);
  if (!access.viewerId.trim() || !Number.isFinite(Date.parse(access.now)))
    throw new ComparisonInputError('必须使用当前服务端身份与时间');
  if (
    batch.mappingVersionId !== data.mapping.versionId ||
    new Set(data.cases.map(({ id }) => id)).size !== data.cases.length
  )
    throw new ComparisonInputError('批次对应表或案例标识不一致');
  for (const unit of data.cases) {
    if (
      unit.batchId !== batch.id ||
      unit.cohort.id !== batch.cohort.id ||
      unit.selectionStandardVersionId !== batch.selectionStandardVersionId ||
      unit.mappingVersionId !== batch.mappingVersionId
    )
      throw new ComparisonInputError('案例不属于当前批次及绑定版本');
  }
  if (access.audience === 'rater') {
    if (evaluatorId !== undefined && evaluatorId !== access.viewerId)
      throw new ComparisonInputError('评价人不能切换为其他评价人');
    const own = data.cases.filter(
      (unit) =>
        unit.front.state === 'present' &&
        unit.front.judgment.evaluator.id === access.viewerId,
    );
    const disclosed: ComparisonCase[] = [];
    const cases = own.map((unit) => {
      const frontAllowed = canReadStage(access, unit, unit.frontNodeId);
      const backAllowed = canReadStage(access, unit, unit.backNodeId);
      if (frontAllowed && backAllowed) {
        const result = calculateComparison(unit, data.mapping);
        disclosed.push(result);
        return result;
      }
      // Select metadata explicitly: nonComparable human notes must not survive
      // a withheld stage through an object spread.
      return comparisonRaterCaseSchema.parse({
        ...identity(unit),
        front: frontAllowed ? unit.front : { state: 'withheld' },
        back: backAllowed ? unit.back : { state: 'withheld' },
        outcome: { state: 'withheld' },
      });
    });
    return createAuthorizedRaterComparisonSchema({
      viewerId: access.viewerId,
      now: access.now,
      ownCaseIds: own.map(({ id }) => id),
      mapping: data.mapping,
      grants: access.grants,
    }).parse({
      audience: 'rater',
      viewerId: access.viewerId,
      policy,
      cases,
      sample: sample(disclosed),
    });
  }
  const visible = data.cases.filter(
    (unit) =>
      canReadStage(access, unit, unit.frontNodeId) &&
      canReadStage(access, unit, unit.backNodeId),
  );
  const selected =
    evaluatorId === undefined
      ? visible
      : visible.filter(
          (unit) =>
            unit.front.state === 'present' &&
            unit.front.judgment.evaluator.id === evaluatorId,
        );
  const cases = selected.map((unit) => calculateComparison(unit, data.mapping));
  if (access.audience === 'manager') {
    if (evaluatorId !== undefined)
      throw new ComparisonInputError('管理者不能按评价人读取数字');
    const ids = new Set(cases.map(({ id }) => id));
    return comparisonManagerPageSchema.parse({
      audience: 'manager',
      policy,
      batches: [
        {
          batch,
          discrepancyPeople: new Set(
            cases
              .filter((unit) =>
                ['front_higher', 'front_lower'].includes(unit.outcome.state),
              )
              .map((unit) => unit.person.id),
          ).size,
          attributionCategories: [
            ...new Set(
              data.confirmedAttributions
                .filter((fact) => ids.has(fact.caseId))
                .map((fact) => fact.category),
            ),
          ],
        },
      ],
    });
  }
  if (access.audience !== 'hr') throw new ComparisonInputError('未知读取范围');
  const evaluators = new Map<string, ComparisonCase[]>();
  for (const unit of cases) {
    if (unit.front.state !== 'present') continue;
    const id = unit.front.judgment.evaluator.id;
    const own = evaluators.get(id) ?? [];
    own.push(unit);
    evaluators.set(id, own);
  }
  const raters = [...evaluators.values()]
    .map((own) => {
      const first = own[0].front;
      if (first.state !== 'present')
        throw new ComparisonInputError('评价人事实缺失');
      return { evaluator: first.judgment.evaluator, sample: sample(own) };
    })
    .sort(
      (a, b) =>
        names.compare(a.evaluator.name, b.evaluator.name) ||
        (a.evaluator.id < b.evaluator.id ? -1 : 1),
    );
  return comparisonHrPageSchema.parse({
    audience: 'hr',
    policy,
    batch,
    mapping: data.mapping,
    counts: summarizeComparisons(cases),
    cases,
    raters,
  });
}
