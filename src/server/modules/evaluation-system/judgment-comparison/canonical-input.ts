import { z } from 'zod';
import {
  comparisonCaseSchema,
  comparisonMappingSchema,
  comparisonMappingVersionIdSchema,
  selectionVersionIdSchema,
} from '@/contracts/judgment-comparison';

const text = z
  .string()
  .min(1)
  .refine((value) => value === value.trim());
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const commit = z.string().regex(/^[0-9a-f]{40}$/);
const instant = z.iso.datetime();
export const canonicalInputFiles = [
  'tests/fixtures/bow-923/seed-input.json',
  'tests/fixtures/bow-923/mapping.json',
  'tests/fixtures/bow-923/selection-standard.json',
  'tests/fixtures/bow-923/manual-comparability-marks.json',
  'tests/fixtures/bow-923/source-rows.json',
  'tests/fixtures/bow-923/manifest.json',
  'tests/fixtures/bow-923/作品评审表.xlsx',
  'tests/fixtures/bow-923/结营评审表.xlsx',
] as const;
const rowReference = z.strictObject({
  fragmentId: text,
  originalVersionId: text,
  rowPersonId: text,
  row: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
const stage = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('present'),
    source: rowReference,
    judgmentId: text,
    sourceStandardReference: text,
    scaleId: text,
    grade: text,
    evaluatorId: text,
    evaluatedAt: instant,
    confirmation: z.literal('human_confirmed'),
  }),
  z.strictObject({
    state: z.literal('missing'),
    reason: text,
    source: rowReference.nullable(),
  }),
]);
const inputSchema = z.strictObject({
  batch: z.strictObject({
    id: text,
    name: text,
    cohortId: text,
    mappingVersionId: comparisonMappingVersionIdSchema,
    sourceCommit: commit,
    contractSha: commit,
    fixtureVersion: text,
    inputFileHashes: z.record(z.enum(canonicalInputFiles), sha256),
    inputCaseCount: z.number().int().positive(),
    nature: z.literal('demo_rebuilt'),
  }),
  mapping: z.strictObject({
    versionId: comparisonMappingVersionIdSchema,
    frontScaleId: text,
    backScaleId: text,
    rows: comparisonMappingSchema.shape.rows,
    confirmedById: text,
    confirmedAt: instant,
    sourceCommit: commit,
    sourceFileSha256: sha256,
    nature: z.literal('demo_human_confirmation'),
  }),
  cases: z
    .array(
      z.strictObject({
        id: text,
        personId: text,
        judgment: z.strictObject({ id: text, name: text }),
        frontNodeId: text,
        backNodeId: text,
        work: comparisonCaseSchema.shape.work,
        front: stage,
        back: stage,
      }),
    )
    .min(1),
  manualMarks: z.array(
    z.strictObject({
      id: text,
      caseId: text,
      batchId: text,
      personId: text,
      frontNodeId: text,
      backNodeId: text,
      reason: text,
      markedById: text,
      markedAt: instant,
      sourceFileSha256: sha256,
      nature: z.literal('demo_human_mark'),
    }),
  ),
});
export type CanonicalComparisonImport = z.infer<typeof inputSchema>;
export type CanonicalComparisonCase =
  CanonicalComparisonImport['cases'][number];
export type CanonicalComparisonStage = CanonicalComparisonCase['front'];
export type CanonicalRowReference = z.infer<typeof rowReference>;
export type CanonicalComparisonSnapshot = {
  facts: CanonicalComparisonImport;
  selectionStandardVersionId: string;
  factsDigest: string;
  importedAt: string;
};
export class CanonicalComparisonError extends Error {
  constructor(
    readonly code:
      'invalid_input' | 'conflict' | 'incomplete' | 'invalid_reference',
  ) {
    super(`comparison_${code}`);
    this.name = 'CanonicalComparisonError';
  }
}
const invalid = (): never => {
  throw new CanonicalComparisonError('invalid_input');
};

/** Keys have no semantic order. Arrays keep their order unless normalized below. */
export function canonicalComparisonJson(value: unknown): string {
  function sorted(item: unknown): unknown {
    if (item === null || typeof item === 'string' || typeof item === 'boolean')
      return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(sorted);
    if (
      typeof item === 'object' &&
      item !== null &&
      (Object.getPrototypeOf(item) === Object.prototype ||
        Object.getPrototypeOf(item) === null)
    ) {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, sorted(child)]),
      );
    }
    return invalid();
  }
  return JSON.stringify(sorted(value));
}

// All accepted instants are UTC ISO strings. Preserve arbitrary source fractional
// precision instead of truncating it through Date's millisecond representation.
function before(a: string, b: string): boolean {
  const [wholeA, fractionA = ''] = a.slice(0, -1).split('.');
  const [wholeB, fractionB = ''] = b.slice(0, -1).split('.');
  if (wholeA !== wholeB) return wholeA < wholeB;
  const width = Math.max(fractionA.length, fractionB.length);
  return fractionA.padEnd(width, '0') < fractionB.padEnd(width, '0');
}
const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;
const byId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Only immutable input facts; never consumes expected results, statistics or grants. */
export function validateCanonicalComparisonImport(
  input: unknown,
): CanonicalComparisonImport {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return invalid();
  const data = parsed.data;
  // Imported identity and original scale text must not silently trim/normalize.
  if (canonicalComparisonJson(input) !== canonicalComparisonJson(data))
    return invalid();
  const { batch, mapping, cases, manualMarks } = data;
  if (
    batch.mappingVersionId !== mapping.versionId ||
    batch.inputCaseCount !== cases.length ||
    mapping.sourceFileSha256 !==
      batch.inputFileHashes[canonicalInputFiles[1]] ||
    !unique(cases.map((unit) => unit.id)) ||
    !unique(manualMarks.map((mark) => mark.id)) ||
    !unique(manualMarks.map((mark) => mark.caseId))
  )
    return invalid();
  for (const field of ['frontGrade', 'frontPosition', 'backGrade'] as const)
    if (!unique(mapping.rows.map((row) => row[field]))) return invalid();
  const judgmentIds: string[] = [];
  for (const unit of cases) {
    if (unit.frontNodeId === unit.backNodeId) return invalid();
    for (const side of ['front', 'back'] as const) {
      const item = unit[side];
      if (item.source && item.source.rowPersonId !== unit.personId)
        return invalid();
      if (item.state === 'present') {
        judgmentIds.push(item.judgmentId);
        if (
          side === 'front' &&
          !selectionVersionIdSchema.safeParse(item.sourceStandardReference)
            .success
        )
          return invalid();
      }
    }
    if (
      unit.front.source &&
      unit.back.source &&
      (unit.front.source.fragmentId === unit.back.source.fragmentId ||
        unit.front.source.originalVersionId ===
          unit.back.source.originalVersionId)
    )
      return invalid();
  }
  if (!unique(judgmentIds)) return invalid();
  for (const mark of manualMarks) {
    const unit = cases.find((candidate) => candidate.id === mark.caseId);
    if (
      !unit ||
      mark.batchId !== batch.id ||
      mark.personId !== unit.personId ||
      mark.frontNodeId !== unit.frontNodeId ||
      mark.backNodeId !== unit.backNodeId ||
      mark.sourceFileSha256 !== batch.inputFileHashes[canonicalInputFiles[3]] ||
      unit.front.state !== 'present' ||
      unit.back.state !== 'present' ||
      before(mark.markedAt, unit.front.evaluatedAt) ||
      before(mark.markedAt, unit.back.evaluatedAt)
    )
      return invalid();
  }
  data.cases.sort(byId);
  data.manualMarks.sort(byId);
  const positions = ['highest', 'middle', 'just_passed'];
  data.mapping.rows.sort(
    (a, b) =>
      positions.indexOf(a.frontPosition) - positions.indexOf(b.frontPosition),
  );
  return data;
}
