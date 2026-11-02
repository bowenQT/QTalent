import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [fixtureRoot, contractRoot, contractSha] = process.argv.slice(2);
assert(
  fixtureRoot && contractRoot && /^[a-f0-9]{40}$/.test(contractSha ?? ''),
  'usage: node --import tsx validate-contracts.mjs <fixture-dir> <clean-frozen-worktree> <full-sha>',
);
assert.equal(
  execFileSync('git', ['-C', contractRoot, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  contractSha,
);
assert.equal(
  execFileSync(
    'git',
    ['-C', contractRoot, 'diff', 'HEAD', '--', 'src/contracts'],
    { encoding: 'utf8' },
  ).trim(),
  '',
  'contract source must be unchanged',
);
const comparison = await import(
  pathToFileURL(path.join(contractRoot, 'src/contracts/judgment-comparison.ts'))
);
const selection = await import(
  pathToFileURL(path.join(contractRoot, 'src/contracts/selection-standard.ts'))
);
const read = async (name) =>
  JSON.parse(await fs.readFile(path.join(fixtureRoot, name), 'utf8'));
const [mapping, standard, inputs, outcomes, rows, expected] = await Promise.all(
  [
    'mapping.json',
    'selection-standard.json',
    'seed-input.json',
    'expected-cases.json',
    'source-rows.json',
    'expected-results.json',
  ].map(read),
);
assert(
  inputs.cases.every((unit) => !('outcome' in unit)),
  'seed input must not contain computed comparison results',
);
assert.equal(inputs.fixtureVersion, 'bow-923-v3');
assert(inputs.manualComparabilityMarks.length > 0);
const marksById = new Map(
  inputs.manualComparabilityMarks.map((mark) => [mark.caseId, mark]),
);
assert.equal(marksById.size, inputs.manualComparabilityMarks.length);
const expectedById = new Map(outcomes.map((entry) => [entry.caseId, entry]));
assert.equal(expectedById.size, inputs.cases.length);
const cases = inputs.cases.map((unit) => {
  const entry = expectedById.get(unit.id);
  assert.equal(entry.personId, unit.person.id);
  const mark = marksById.get(unit.id);
  assert.equal(entry.expectedOutcome.state === 'not_comparable', Boolean(mark));
  if (mark) {
    assert.equal(mark.personId, unit.person.id);
    assert.deepEqual(entry.expectedOutcome, {
      state: 'not_comparable',
      reason: mark.reason,
      markedBy: mark.markedBy,
      markedAt: mark.markedAt,
    });
  }
  return { ...unit, outcome: entry.expectedOutcome };
});
assert.equal(
  expected.contractSha,
  contractSha,
  'record the input SHA actually checked',
);
comparison.comparisonMappingSchema.parse(mapping);
selection.selectionStandardContentSchema.parse(standard);
const caseValidator = comparison.createComparisonCaseSchema(mapping);
for (const unit of cases) caseValidator.parse(unit);
for (const row of rows) {
  comparison.comparisonTableRowSchema.parse(row.front);
  comparison.comparisonTableRowSchema.parse(row.back);
}
for (const { sample } of expected.raters)
  comparison.comparisonRaterSampleSchema.parse(sample);
const page = {
  audience: expected.audience,
  policy: expected.policy,
  batch: expected.batch,
  mapping,
  counts: expected.counts,
  cases,
  raters: expected.raters,
};
comparison.comparisonHrPageSchema.parse(page);
comparison.comparisonRatersSchema.parse(expected.raters);
// Meaningful negative controls against the actual frozen contract, not a copy.
const mutate = (value, change) => {
  const copy = structuredClone(value);
  change(copy);
  return copy;
};
const byState = (state) => cases.find((unit) => unit.outcome.state === state);
const rejects = [
  mutate(cases[0], (unit) => {
    unit.back.judgment.row.source.originalVersionId =
      unit.front.judgment.row.source.originalVersionId;
  }),
  mutate(cases[0], (unit) => {
    unit.back.judgment.row.personId = 'another-demo-person';
  }),
  mutate(cases[0], (unit) => {
    unit.front.judgment.row.source.location.cell = 'A2:P3';
  }),
  mutate(byState('middle_distribution'), (unit) => {
    unit.outcome = { state: 'front_higher', bands: 1 };
  }),
  mutate(byState('missing'), (unit) => {
    unit.outcome = { state: 'consistent' };
  }),
  mutate(cases[0], (unit) => {
    unit.mappingVersionId = 'map-xe-select-v2';
  }),
];
for (const unit of rejects)
  assert.equal(caseValidator.safeParse(unit).success, false);
const belowThreshold = expected.raters.find(
  (entry) => entry.sample.state === 'insufficient_sample',
).sample;
assert.equal(
  comparison.comparisonRaterSampleSchema.safeParse({
    ...belowThreshold,
    distribution: expected.counts,
  }).success,
  false,
);
assert.equal(
  comparison.comparisonRatersSchema.safeParse([...expected.raters].reverse())
    .success,
  false,
);
assert.equal(
  comparison.comparisonRatersSchema.safeParse([
    expected.raters[0],
    expected.raters[0],
  ]).success,
  false,
);
// Page-level mutations need a rater whose distribution is disclosed.
const disclosed = page.raters.findIndex(
  (entry) => 'distribution' in entry.sample,
);
assert(disclosed >= 0);
const pageRejects = [
  mutate(page, (copy) => {
    copy.raters[disclosed].sample.distribution = structuredClone(copy.counts);
  }),
  mutate(page, (copy) => {
    copy.raters[disclosed].sample.distribution.excluded.notComparable = 1;
  }),
  mutate(page, (copy) => {
    copy.raters[disclosed].sample.distribution.clear.consistent -= 1;
    copy.raters[disclosed].sample.distribution.clear.frontHigher += 1;
  }),
];
for (const invalid of pageRejects) {
  assert.equal(
    comparison.comparisonHrPageSchema.safeParse(invalid).success,
    false,
    'actual frozen schema must reject samples with other/excluded/swapped outcomes',
  );
}
const sameName = ['demo-rater-a', 'demo-rater-b'].map((id) => ({
  ...expected.raters[disclosed],
  evaluator: { id, name: '同名评价人（演示）' },
}));
comparison.comparisonRatersSchema.parse(sameName);
assert.equal(
  comparison.comparisonRatersSchema.safeParse([...sameName].reverse()).success,
  false,
);
console.log(
  JSON.stringify({
    contractSha,
    cases: cases.length,
    seedInputVersion: inputs.fixtureVersion,
    manualComparabilityFacts: marksById.size,
    independentRowReferences: rows.length * 2,
    negativeControls: rejects.length + 4 + pageRejects.length,
    raterNameOrderAndSameNameId: 'verified',
    status: 'expected_fixture_schema_valid',
    actualQuery: 'not_run',
  }),
);
