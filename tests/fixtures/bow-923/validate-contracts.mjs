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
const expectedById = new Map(outcomes.map((entry) => [entry.caseId, entry]));
assert.equal(expectedById.size, inputs.cases.length);
const cases = inputs.cases.map((unit) => {
  const entry = expectedById.get(unit.id);
  assert.equal(entry.personId, unit.person.id);
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
  mutate(cases[3], (unit) => {
    unit.outcome = { state: 'front_higher', bands: 1 };
  }),
  mutate(cases[5], (unit) => {
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
const sameName = ['demo-rater-a', 'demo-rater-b'].map((id) => ({
  ...expected.raters[0],
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
    independentRowReferences: rows.length * 2,
    negativeControls: rejects.length + 4,
    raterNameOrderAndSameNameId: 'verified',
    status: 'expected_fixture_schema_valid',
    actualQuery: 'not_run',
  }),
);
