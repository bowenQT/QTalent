import {
  comparisonCaseSchema,
  comparisonCountsSchema,
  comparisonMappingSchema,
  comparisonOutcomeSchema,
  createComparisonCaseSchema,
  graduationGradeSchema,
  type ComparisonCase,
  type ComparisonMapping,
} from '@/contracts/judgment-comparison';
import type { z } from 'zod';
import { ComparisonInputError, type ComparisonFacts } from './ports';

export type ComparisonCounts = z.infer<typeof comparisonCountsSchema>;

export function calculateComparison(
  facts: ComparisonFacts,
  mapping: ComparisonMapping,
): ComparisonCase {
  if (Object.hasOwn(facts, 'outcome'))
    throw new ComparisonInputError('输入不能携带预先计算的对照结论');
  if (facts.nonComparable && Object.hasOwn(facts.nonComparable, 'state'))
    throw new ComparisonInputError('人工不可比事实不能是预计算outcome');
  const map = comparisonMappingSchema.parse(mapping);
  const { front, back } = facts;
  let outcome: ComparisonCase['outcome'];
  if (front.state === 'missing' || back.state === 'missing') {
    outcome = {
      state: 'missing',
      missing:
        front.state === 'missing'
          ? back.state === 'missing'
            ? 'both'
            : 'front'
          : 'back',
    };
  } else if (facts.nonComparable) {
    // Never derive a human marker/name/time from an expected result or a model.
    outcome = comparisonOutcomeSchema.parse({
      ...facts.nonComparable,
      state: 'not_comparable',
    });
  } else {
    const row = map.rows.find(
      (item) => item.frontGrade === front.judgment.grade,
    );
    const grades = graduationGradeSchema.options;
    const backIndex = grades.findIndex(
      (grade) => grade === back.judgment.grade,
    );
    if (
      front.judgment.scaleId !== map.frontScaleId ||
      back.judgment.scaleId !== map.backScaleId ||
      !row ||
      backIndex < 0
    )
      throw new ComparisonInputError(
        '原量表尚无可用对应；不能把未知当作反向证据',
      );
    if (row.frontPosition === 'middle') {
      outcome = { state: 'middle_distribution', backGrade: grades[backIndex] };
    } else {
      const difference = grades.indexOf(row.backGrade) - backIndex;
      outcome =
        difference === 0
          ? { state: 'consistent' }
          : {
              state: difference > 0 ? 'front_higher' : 'front_lower',
              bands: Math.abs(difference) === 1 ? 1 : 2,
            };
    }
  }
  const { nonComparable: mark, ...input } = facts;
  void mark;
  const unit = comparisonCaseSchema.parse({ ...input, outcome });
  return createComparisonCaseSchema(map).parse(unit);
}

export function summarizeComparisons(
  cases: readonly ComparisonCase[],
): ComparisonCounts {
  const counts: ComparisonCounts = {
    clear: { consistent: 0, frontHigher: 0, frontLower: 0 },
    middleDistribution: { notRecommended: 0, observe: 0, recommended: 0 },
    excluded: {
      missingFront: 0,
      missingBack: 0,
      missingBoth: 0,
      notComparable: 0,
    },
  };
  for (const { outcome } of cases) {
    switch (outcome.state) {
      case 'consistent':
        counts.clear.consistent++;
        break;
      case 'front_higher':
        counts.clear.frontHigher++;
        break;
      case 'front_lower':
        counts.clear.frontLower++;
        break;
      case 'middle_distribution':
        if (outcome.backGrade === '不建议')
          counts.middleDistribution.notRecommended++;
        else if (outcome.backGrade === '继续观察')
          counts.middleDistribution.observe++;
        else counts.middleDistribution.recommended++;
        break;
      case 'missing':
        if (outcome.missing === 'front') counts.excluded.missingFront++;
        else if (outcome.missing === 'back') counts.excluded.missingBack++;
        else counts.excluded.missingBoth++;
        break;
      case 'not_comparable':
        counts.excluded.notComparable++;
        break;
    }
  }
  return counts;
}
