import { z } from 'zod';
import { sourceSchema } from './sources';

const text = z.string().trim().min(1);
const count = z.number().int().nonnegative();
export const standardAttributionCategorySchema = z.enum([
  'evaluation_standard',
  'evaluator',
  'method_or_information',
  'person_or_environment',
  'later_evaluation',
]);
export const comparisonActorSchema = z.strictObject({ id: text, name: text });
export const selectionVersionIdSchema = text.regex(/^xe-select-v[1-9]\d*$/);
export const comparisonMappingVersionIdSchema = text.regex(
  /^map-xe-select-v[1-9]\d*$/,
);
export const comparisonCohortSchema = z.strictObject({ id: text, name: text });
export const graduationGradeSchema = z.enum(['不建议', '继续观察', '建议留用']);
export const COMPARISON_RATER_MIN_CASES = 5;

// A comparison is a person × judgment, never a converted capability score.
export const comparisonPolicySchema = z.strictObject({
  conclusionScope: z.literal('evaluation_system_only'),
  laterStageUse: z.literal('comparison_not_ground_truth'),
});
export const comparisonMappingSchema = z
  .strictObject({
    versionId: comparisonMappingVersionIdSchema,
    frontScaleId: text,
    backScaleId: text,
    rows: z
      .array(
        z.strictObject({
          frontGrade: text,
          frontPosition: z.enum(['highest', 'middle', 'just_passed']),
          backGrade: graduationGradeSchema,
        }),
      )
      .length(3),
    confirmedBy: comparisonActorSchema,
    confirmedAt: z.iso.datetime(),
  })
  .refine(
    (map) =>
      new Set(map.rows.map((row) => row.frontGrade)).size === 3 &&
      new Set(map.rows.map((row) => row.frontPosition)).size === 3 &&
      new Set(map.rows.map((row) => row.backGrade)).size === 3,
    '对应表须为原量表的三档提供唯一对应关系',
  );
export type ComparisonMapping = z.infer<typeof comparisonMappingSchema>;

// Existing prototype_snapshot graduation data must stay a snapshot. These two
// new tables have independent originalVersionId/fragmentId and row coordinates.
// The source reader must still verify the bytes, quote and row identity.
export const comparisonTableRowSchema = z
  .strictObject({
    personId: text,
    row: z.number().int().positive(),
    source: sourceSchema,
  })
  .refine(({ row, source }) => {
    if (
      source.sourceCategory !== 'original' ||
      source.sourceType !== 'spreadsheet' ||
      source.location.kind !== 'spreadsheet'
    )
      return false;
    const cells = /^([A-Z]+)([1-9]\d*)(?::([A-Z]+)([1-9]\d*))?$/.exec(
      source.location.cell,
    );
    return (
      cells !== null &&
      Number(cells[2]) === row &&
      (cells[4] === undefined || Number(cells[4]) === row)
    );
  }, '出处必须定位到独立演示原表里这个人的一行');

export const comparisonJudgmentSchema = z.strictObject({
  judgmentId: text,
  nodeId: text,
  cohortId: text,
  standardVersionId: text,
  scaleId: text,
  grade: text,
  evaluator: comparisonActorSchema,
  evaluatedAt: z.iso.datetime(),
  confirmation: z.literal('human_confirmed'),
  row: comparisonTableRowSchema,
});
export const comparisonStageSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('present'),
    judgment: comparisonJudgmentSchema,
  }),
  z.strictObject({ state: z.literal('missing'), reason: text }),
]);
const outcomeOptions = [
  z.strictObject({ state: z.literal('consistent') }),
  z.strictObject({
    state: z.enum(['front_higher', 'front_lower']),
    bands: z.union([z.literal(1), z.literal(2)]),
  }),
  z.strictObject({
    state: z.literal('middle_distribution'),
    backGrade: graduationGradeSchema,
  }),
  z.strictObject({
    state: z.literal('missing'),
    missing: z.enum(['front', 'back', 'both']),
  }),
  z.strictObject({
    state: z.literal('not_comparable'),
    reason: text,
    markedBy: comparisonActorSchema,
    markedAt: z.iso.datetime(),
  }),
] as const;
export const comparisonOutcomeSchema = z.discriminatedUnion(
  'state',
  outcomeOptions,
);
const caseFields = {
  id: text,
  batchId: text,
  person: comparisonActorSchema,
  judgment: z.strictObject({ id: text, name: text }),
  cohort: comparisonCohortSchema,
  selectionStandardVersionId: selectionVersionIdSchema,
  mappingVersionId: comparisonMappingVersionIdSchema,
  frontNodeId: text,
  backNodeId: text,
  work: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('individual'), workId: text }),
    z.strictObject({
      kind: z.literal('team'),
      workId: text,
      teamId: text,
    }),
  ]),
};
export const comparisonCaseSchema = z
  .strictObject({
    ...caseFields,
    front: comparisonStageSchema,
    back: comparisonStageSchema,
    outcome: comparisonOutcomeSchema,
  })
  .superRefine((unit, ctx) => {
    for (const side of ['front', 'back'] as const) {
      const stage = unit[side];
      if (stage.state !== 'present') continue;
      if (
        stage.judgment.row.personId !== unit.person.id ||
        stage.judgment.cohortId !== unit.cohort.id ||
        stage.judgment.nodeId !==
          unit[side === 'front' ? 'frontNodeId' : 'backNodeId']
      ) {
        ctx.addIssue({
          code: 'custom',
          path: [side],
          message: '判断与来源行必须属于本人与本期次的对应节点',
        });
      }
    }
    if (
      unit.front.state === 'present' &&
      unit.front.judgment.standardVersionId !== unit.selectionStandardVersionId
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['front'],
        message: '前段须保留期次绑定的选拔标准版本',
      });
    }
    if (unit.front.state === 'present' && unit.back.state === 'present') {
      const frontSource = unit.front.judgment.row.source;
      const backSource = unit.back.judgment.row.source;
      if (
        frontSource.originalVersionId === backSource.originalVersionId ||
        frontSource.fragmentId === backSource.fragmentId
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['back'],
          message: '两段必须使用各自的独立来源记录，不能借用另一段行号',
        });
      }
    }
  });
export type ComparisonCase = z.infer<typeof comparisonCaseSchema>;

// This validates an already computed result against the frozen mapping. It does
// not query evidence, compute a read model or authorize any caller.
export function createComparisonCaseSchema(mapping: ComparisonMapping) {
  const map = comparisonMappingSchema.parse(mapping);
  return comparisonCaseSchema.superRefine((unit, ctx) => {
    const reject = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['outcome'], message });
    if (unit.mappingVersionId !== map.versionId) reject('对应表版本与案例不符');
    if (unit.front.state === 'missing' || unit.back.state === 'missing') {
      const missing =
        unit.front.state === 'missing'
          ? unit.back.state === 'missing'
            ? 'both'
            : 'front'
          : 'back';
      if (unit.outcome.state !== 'missing' || unit.outcome.missing !== missing)
        reject('缺段只计入缺段，不计不一致');
      return;
    }
    const front = unit.front.judgment;
    const back = unit.back.judgment;
    if (
      front.scaleId !== map.frontScaleId ||
      back.scaleId !== map.backScaleId
    ) {
      if (unit.outcome.state !== 'not_comparable')
        reject('量表没有对应时须明确标为不可比');
      return;
    }
    if (unit.outcome.state === 'not_comparable') return;
    const row = map.rows.find((item) => item.frontGrade === front.grade);
    if (!row || !map.rows.some((item) => item.backGrade === back.grade)) {
      reject('原量表档位没有对应时不能给出对照结论');
      return;
    }
    if (row.frontPosition === 'middle') {
      if (
        unit.outcome.state !== 'middle_distribution' ||
        unit.outcome.backGrade !== back.grade
      ) {
        reject('中间档只单列后段分布，不算一致或不一致');
      }
      return;
    }
    const grades = graduationGradeSchema.options;
    const difference =
      grades.indexOf(row.backGrade) -
      grades.findIndex((grade) => grade === back.grade);
    if (difference === 0) {
      if (unit.outcome.state !== 'consistent') reject('明确判断同档才为一致');
    } else if (
      unit.outcome.state !==
        (difference > 0 ? 'front_higher' : 'front_lower') ||
      !('bands' in unit.outcome) ||
      unit.outcome.bands !== Math.abs(difference)
    ) {
      reject('只对前段明确判断记录不一致的方向与档差');
    }
  });
}

export const comparisonCountsSchema = z.strictObject({
  clear: z.strictObject({
    consistent: count,
    frontHigher: count,
    frontLower: count,
  }),
  middleDistribution: z.strictObject({
    notRecommended: count,
    observe: count,
    recommended: count,
  }),
  excluded: z.strictObject({
    missingFront: count,
    missingBack: count,
    missingBoth: count,
    notComparable: count,
  }),
});
// Validate the declared sample, not a batch-wide aggregate. Outcomes have
// already passed the frozen mapping; excluded/withheld cases add no evidence.
function matchesSampleDistribution(
  distribution: z.infer<typeof comparisonCountsSchema>,
  outcomes: readonly (
    z.infer<typeof comparisonOutcomeSchema> | { state: 'withheld' }
  )[],
) {
  const clear = { consistent: 0, frontHigher: 0, frontLower: 0 };
  const middle = { notRecommended: 0, observe: 0, recommended: 0 };
  for (const outcome of outcomes) {
    if (outcome.state === 'consistent') clear.consistent++;
    else if (outcome.state === 'front_higher') clear.frontHigher++;
    else if (outcome.state === 'front_lower') clear.frontLower++;
    else if (outcome.state === 'middle_distribution') {
      const bucket = {
        不建议: 'notRecommended',
        继续观察: 'observe',
        建议留用: 'recommended',
      } as const;
      middle[bucket[outcome.backGrade]]++;
    }
  }
  return (
    distribution.clear.consistent === clear.consistent &&
    distribution.clear.frontHigher === clear.frontHigher &&
    distribution.clear.frontLower === clear.frontLower &&
    distribution.middleDistribution.notRecommended === middle.notRecommended &&
    distribution.middleDistribution.observe === middle.observe &&
    distribution.middleDistribution.recommended === middle.recommended &&
    distribution.excluded.missingFront === 0 &&
    distribution.excluded.missingBack === 0 &&
    distribution.excluded.missingBoth === 0 &&
    distribution.excluded.notComparable === 0
  );
}
const ids = z
  .array(text)
  .refine(
    (values) => new Set(values).size === values.length,
    '案例标识不能重复',
  );
export const comparisonRaterSampleSchema = z
  .discriminatedUnion('state', [
    z.strictObject({
      state: z.literal('insufficient_sample'),
      label: z.literal('样本不足'),
      threshold: z.literal(COMPARISON_RATER_MIN_CASES),
      comparableCaseCount: count.max(COMPARISON_RATER_MIN_CASES - 1),
      caseIds: ids,
    }),
    z.strictObject({
      state: z.literal('sufficient_sample'),
      threshold: z.literal(COMPARISON_RATER_MIN_CASES),
      comparableCaseCount: count.min(COMPARISON_RATER_MIN_CASES),
      caseIds: ids,
      distribution: comparisonCountsSchema,
    }),
  ])
  .refine(
    (sample) => sample.caseIds.length === sample.comparableCaseCount,
    '样本数须与可对照案例数一致',
  );
export const comparisonBatchSchema = z.strictObject({
  id: text,
  name: text,
  cohort: comparisonCohortSchema,
  selectionStandardVersionId: selectionVersionIdSchema,
  mappingVersionId: comparisonMappingVersionIdSchema,
});
const evaluatorNames = new Intl.Collator('zh-CN');
export const comparisonRatersSchema = z
  .array(
    z.strictObject({
      evaluator: comparisonActorSchema,
      sample: comparisonRaterSampleSchema,
    }),
  )
  .refine(
    (raters) =>
      new Set(raters.map(({ evaluator }) => evaluator.id)).size ===
      raters.length,
    '每位评价人只显示一行',
  )
  .refine(
    (raters) =>
      raters.every(({ evaluator }, index) => {
        if (index === 0) return true;
        const previous = raters[index - 1].evaluator;
        const byName = evaluatorNames.compare(previous.name, evaluator.name);
        return byName < 0 || (byName === 0 && previous.id < evaluator.id);
      }),
    '评价人按姓名稳定排列，同名按标识排列，不按样本量或偏差排行',
  );
export const comparisonHrPageSchema = z
  .strictObject({
    audience: z.literal('hr'),
    policy: comparisonPolicySchema,
    batch: comparisonBatchSchema,
    mapping: comparisonMappingSchema,
    counts: comparisonCountsSchema,
    cases: z.array(comparisonCaseSchema),
    raters: comparisonRatersSchema,
  })
  .superRefine((page, ctx) => {
    const validator = createComparisonCaseSchema(page.mapping);
    const caseIds = new Set(page.cases.map((unit) => unit.id));
    if (
      caseIds.size !== page.cases.length ||
      page.mapping.versionId !== page.batch.mappingVersionId
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '案例唯一且批次对应表版本须一致',
      });
    }
    page.cases.forEach((unit, index) => {
      if (
        !validator.safeParse(unit).success ||
        unit.batchId !== page.batch.id ||
        unit.cohort.id !== page.batch.cohort.id ||
        unit.selectionStandardVersionId !==
          page.batch.selectionStandardVersionId ||
        unit.mappingVersionId !== page.batch.mappingVersionId
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['cases', index],
          message: '案例口径或批次版本不符',
        });
      }
    });
    for (const { evaluator, sample } of page.raters) {
      const comparable = page.cases.filter(
        (unit) =>
          unit.front.state === 'present' &&
          unit.front.judgment.evaluator.id === evaluator.id &&
          !['missing', 'not_comparable'].includes(unit.outcome.state),
      );
      const expected = comparable.map((unit) => unit.id);
      if (
        sample.caseIds.length !== expected.length ||
        sample.caseIds.some((id) => !expected.includes(id))
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['raters'],
          message: '评价人样本只含本人可对照案例',
        });
      }
      if (
        sample.state === 'sufficient_sample' &&
        !matchesSampleDistribution(
          sample.distribution,
          comparable.map((unit) => unit.outcome),
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['raters'],
          message:
            '评价人分布须逐项对应本人的可对照案例，不能混入其他人或排除案例',
        });
      }
    }
  });

// Manager data is a different response, not a UI mask over the HR response.
export const comparisonManagerBasisSchema = z.strictObject({
  batch: comparisonBatchSchema,
  discrepancyPeople: count,
  attributionCategories: z
    .array(standardAttributionCategorySchema)
    .refine((values) => new Set(values).size === values.length),
});
export const comparisonManagerPageSchema = z.strictObject({
  audience: z.literal('manager'),
  policy: comparisonPolicySchema,
  batches: z.array(comparisonManagerBasisSchema),
});

const withheld = z.strictObject({ state: z.literal('withheld') });
const disclosedStage = z.union([comparisonStageSchema, withheld]);
export const comparisonRaterCaseSchema = z
  .strictObject({
    ...caseFields,
    front: disclosedStage,
    back: disclosedStage,
    outcome: z.union([comparisonOutcomeSchema, withheld]),
  })
  .superRefine((unit, ctx) => {
    const restricted =
      unit.front.state === 'withheld' || unit.back.state === 'withheld';
    if (
      restricted
        ? unit.outcome.state !== 'withheld'
        : unit.outcome.state === 'withheld'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: '任一段未授权时不得泄露由该段推导的结论',
      });
    }
    if (!restricted && !comparisonCaseSchema.safeParse(unit).success) {
      ctx.addIssue({
        code: 'custom',
        message: '已披露的案例必须符合完整案例契约',
      });
    }
  });
export const comparisonRaterPageSchema = z.strictObject({
  audience: z.literal('rater'),
  viewerId: text,
  policy: comparisonPolicySchema,
  cases: z.array(comparisonRaterCaseSchema),
  sample: comparisonRaterSampleSchema,
});

// Supply this context only from server identity and the CURRENT authorized
// query. A past front evaluation is a filter, never a grant for either stage.
export type ComparisonRaterAccess = {
  viewerId: string;
  now: string;
  ownCaseIds: readonly string[];
  mapping: ComparisonMapping;
  grants: readonly {
    personId: string;
    nodeId: string;
    validFrom: string;
    validUntil: string | null;
  }[];
};
export function createAuthorizedRaterComparisonSchema(
  access: ComparisonRaterAccess,
) {
  const now = Date.parse(access.now);
  const caseValidator = createComparisonCaseSchema(access.mapping);
  return comparisonRaterPageSchema.superRefine((page, ctx) => {
    const reject = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (!Number.isFinite(now) || page.viewerId !== access.viewerId)
      reject('必须绑定当前服务端身份与时间');
    if (new Set(page.cases.map((unit) => unit.id)).size !== page.cases.length)
      reject('案例标识不能重复');
    for (const unit of page.cases) {
      if (
        unit.front.state !== 'withheld' &&
        unit.back.state !== 'withheld' &&
        !caseValidator.safeParse(unit).success
      ) {
        reject('当前可披露案例须符合冻结的对应表口径');
      }
      if (!access.ownCaseIds.includes(unit.id))
        reject('评价人只能读取本人参与过前段评价的案例');
      for (const side of ['front', 'back'] as const) {
        const stage = unit[side];
        const nodeId = unit[side === 'front' ? 'frontNodeId' : 'backNodeId'];
        const authorized = access.grants.some(
          (grant) =>
            grant.personId === unit.person.id &&
            grant.nodeId === nodeId &&
            Date.parse(grant.validFrom) <= now &&
            (grant.validUntil === null || now < Date.parse(grant.validUntil)),
        );
        if (!authorized && stage.state !== 'withheld')
          reject('该段没有同节点的当前有效关系，须剔除内容');
        if (
          stage.state === 'present' &&
          (stage.judgment.nodeId !== nodeId ||
            stage.judgment.cohortId !== unit.cohort.id ||
            stage.judgment.row.personId !== unit.person.id)
        ) {
          reject('不可借用其他节点、期次或人的判断与出处');
        }
        if (
          side === 'front' &&
          stage.state === 'present' &&
          stage.judgment.standardVersionId !== unit.selectionStandardVersionId
        )
          reject('前段须保留期次绑定的选拔标准版本');
        if (
          side === 'front' &&
          stage.state === 'present' &&
          stage.judgment.evaluator.id !== access.viewerId
        ) {
          reject('前段判断须为本人参与的案例');
        }
      }
    }
    const comparable = page.cases.filter(
      (unit) =>
        !['withheld', 'missing', 'not_comparable'].includes(unit.outcome.state),
    );
    if (
      page.sample.caseIds.length !== comparable.length ||
      page.sample.caseIds.some(
        (id) => !comparable.some((unit) => unit.id === id),
      )
    ) {
      reject('本人样本只统计当前可披露的可对照案例，不能由隐藏段推导分布');
    }
    if (
      page.sample.state === 'sufficient_sample' &&
      !matchesSampleDistribution(
        page.sample.distribution,
        comparable.map((unit) => unit.outcome),
      )
    ) {
      reject(
        '本人分布须逐项对应当前可披露的可对照案例，不能混入他人、隐藏或排除案例',
      );
    }
  });
}

export const comparisonReadInputSchema = z.strictObject({
  batchId: text,
  evaluatorId: text.optional(),
});
export const comparisonReadResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('success'),
    page: z.discriminatedUnion('audience', [
      comparisonHrPageSchema,
      comparisonRaterPageSchema,
      comparisonManagerPageSchema,
    ]),
  }),
  z.strictObject({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    input: z.unknown(),
  }),
  z.strictObject({ status: z.enum(['forbidden', 'not_found']), message: text }),
]);
export type ComparisonHrPage = z.infer<typeof comparisonHrPageSchema>;
export type ComparisonRaterPage = z.infer<typeof comparisonRaterPageSchema>;
export type ComparisonManagerPage = z.infer<typeof comparisonManagerPageSchema>;
export type ComparisonReadInput = z.infer<typeof comparisonReadInputSchema>;
export type ComparisonReadResult = z.infer<typeof comparisonReadResultSchema>;
