/** Explicit, opt-in schema checks against unchanged Git worktrees.
 * This is not collected by Vitest/Playwright and is not a runtime regression pass.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const frozen = {
  materials: '0b20a913621121848219e0966ba4bf4844d1bdb3',
  iteration: '2fe52fa46a0003762b5090b0d5af97654f7f5b2c',
};
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as ObjectValue;
}
function call(module: ObjectValue, name: string, ...args: unknown[]): unknown {
  const fn = module[name];
  assert(typeof fn === 'function', `Missing frozen factory ${name}`);
  return Reflect.apply(fn, undefined, args);
}
let checks = 0;
function checkSchema(
  schema: unknown,
  input: unknown,
  accepted: boolean,
  label: string,
) {
  const target = object(schema);
  assert(typeof target.safeParse === 'function', `Missing schema for ${label}`);
  const result: unknown = Reflect.apply(target.safeParse, target, [input]);
  assert.equal(object(result).success, accepted, label);
  checks++;
}
function check(
  module: ObjectValue,
  name: string,
  input: unknown,
  accepted: boolean,
) {
  checkSchema(module[name], input, accepted, name);
}
function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((entry, key) => {
    const parent = object(entry);
    assert(
      Object.hasOwn(parent, key),
      `Missing fixture path ${path.join('.')}`,
    );
    return parent[key];
  }, value);
}
function replace(
  value: unknown,
  path: string[],
  replacement: unknown,
): unknown {
  const copy: unknown = structuredClone(value);
  const parent = object(at(copy, path.slice(0, -1)));
  assert(Object.hasOwn(parent, path[path.length - 1]));
  parent[path[path.length - 1]] = replacement;
  return copy;
}
function verifyRoot(root: string, sha: string): string {
  const path = resolve(root);
  assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path,
      encoding: 'utf8',
    }).trim(),
    sha,
  );
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src/contracts'], {
    cwd: path,
  });
  assert.equal(
    execFileSync(
      'git',
      ['ls-files', '--others', '--exclude-standard', '--', 'src/contracts'],
      { cwd: path, encoding: 'utf8' },
    ).trim(),
    '',
  );
  return path;
}
async function load(root: string, name: string): Promise<ObjectValue> {
  const loaded: unknown = await import(
    pathToFileURL(join(root, 'src/contracts', name + '.ts')).href
  );
  return object(loaded);
}

const { values } = parseArgs({
  options: {
    'materials-root': { type: 'string' },
    'iteration-root': { type: 'string' },
  },
});
assert(
  values['materials-root'] && values['iteration-root'],
  'Pass both frozen worktree roots explicitly',
);
const materialsRoot = verifyRoot(values['materials-root'], frozen.materials);
const iterationRoot = verifyRoot(values['iteration-root'], frozen.iteration);
const sources = await load(materialsRoot, 'sources');
const materials = await load(materialsRoot, 'materials');
const materialFixtures = await load(materialsRoot, 'materials.fixtures');
const comparison = await load(iterationRoot, 'judgment-comparison');
const selection = await load(iterationRoot, 'selection-standard');
const iterationFixtures = await load(
  iterationRoot,
  'standard-iteration.fixtures',
);

for (const reference of Object.values(
  object(materialFixtures.materialReferencesFixture),
)) {
  check(sources, 'materialSourceReferenceSchema', reference, true);
}
check(
  sources,
  'materialSourceReferenceSchema',
  { excerpt: '演示：只有一段引文' },
  false,
);
const pdf = object(materialFixtures.materialReferencesFixture).pdf;
check(
  sources,
  'materialSourceReferenceSchema',
  replace(pdf, ['location', 'page'], 0),
  false,
);
check(
  sources,
  'materialSourceReferenceSchema',
  replace(pdf, ['location', 'textRange'], { start: 4, end: 4 }),
  false,
);
const image = object(materialFixtures.materialReferencesFixture).image;
check(
  sources,
  'materialSourceReferenceSchema',
  replace(image, ['location', 'region', 'right'], 1.1),
  false,
);
const code = object(materialFixtures.materialReferencesFixture).code;
check(
  sources,
  'materialSourceReferenceSchema',
  replace(code, ['location', 'path'], '../private.ts'),
  false,
);
const materialSources: unknown = materialFixtures.materialSourcesFixture;
assert(Array.isArray(materialSources));
const historical = materialSources.find(
  (entry) => object(entry).sourceCategory === 'historical_evaluation',
);
assert(historical);
check(sources, 'materialSourceSchema', historical, true);
check(
  sources,
  'materialSourceSchema',
  replace(historical, ['location'], object(image).location),
  false,
);
check(
  materials,
  'materialBatchInputSchema',
  materialFixtures.materialBatchInputFixture,
  true,
);
check(
  materials,
  'materialBatchInputSchema',
  replace(materialFixtures.materialBatchInputFixture, ['personIds'], []),
  true,
);

const cases: unknown = call(iterationFixtures, 'comparisonCasesFixture');
assert(Array.isArray(cases) && cases.length > 0);
const mapping = call(iterationFixtures, 'comparisonMappingFixture');
const caseSchema = call(comparison, 'createComparisonCaseSchema', mapping);
for (const entry of cases)
  checkSchema(caseSchema, entry, true, 'frozen comparison fixture');
const first: unknown = cases[0];
const frontSource = at(first, ['front', 'judgment', 'row', 'source']);
check(
  comparison,
  'comparisonCaseSchema',
  replace(first, ['back', 'judgment', 'row', 'source'], frontSource),
  false,
);
// Equal numeric row indexes in DIFFERENT originals remain legal.
const frontRow = at(first, ['front', 'judgment', 'row', 'row']);
assert(typeof frontRow === 'number');
let equalRows = replace(first, ['back', 'judgment', 'row', 'row'], frontRow);
equalRows = replace(
  equalRows,
  ['back', 'judgment', 'row', 'source', 'location', 'cell'],
  `A${frontRow}:H${frontRow}`,
);
check(comparison, 'comparisonCaseSchema', equalRows, true);
const manager = call(iterationFixtures, 'comparisonManagerFixture');
check(comparison, 'comparisonManagerPageSchema', manager, true);
check(
  comparison,
  'comparisonManagerPageSchema',
  { ...object(manager), confidence: 0.9 },
  false,
);

check(
  selection,
  'effectiveRuleVersionReadInputSchema',
  { category: 'dimension_anchors' },
  true,
);
check(
  selection,
  'effectiveRuleVersionReadInputSchema',
  { category: 'xe_selection' },
  true,
);
check(selection, 'effectiveRuleVersionReadInputSchema', {}, false);
const binding = {
  cohort: iterationFixtures.iterationDemoCohort,
  standardVersionId: 'xe-select-v1',
  boundAt: '2026-10-31T10:00:00Z',
};
check(
  selection,
  'selectionCohortBindingChangeSchema',
  { previous: binding, binding },
  true,
);
check(
  selection,
  'selectionCohortBindingChangeSchema',
  {
    previous: binding,
    binding: { ...binding, standardVersionId: 'xe-select-v2' },
  },
  false,
);
const receipt = object(call(iterationFixtures, 'selectionPublicationFixture'));
check(selection, 'selectionPublicationReceiptSchema', receipt, true);
const undo = {
  receipt,
  command: {
    operationId: 'demo-undo',
    publicationId: receipt.publicationId,
    expectedRevision: receipt.revision,
  },
  requestedAt: receipt.publishedAt,
  currentPublicationId: receipt.publicationId,
  currentRevision: receipt.revision,
};
check(selection, 'selectionPublicationUndoBoundarySchema', undo, true);
check(
  selection,
  'selectionPublicationUndoBoundarySchema',
  { ...undo, requestedAt: receipt.undoUntil },
  false,
);
check(
  selection,
  'selectionPublicationUndoBoundarySchema',
  { ...undo, currentPublicationId: 'demo-later-publication' },
  false,
);

console.log(
  JSON.stringify(
    {
      result: 'pass',
      level: 'frozen_schema_only',
      frozen,
      checks,
      notVerified: [
        'database transactions',
        'current server authorization',
        'original file access',
        'publication persistence or restart',
        'browser flows',
      ],
    },
    null,
    2,
  ),
);
