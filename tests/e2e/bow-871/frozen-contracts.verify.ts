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
  iteration: 'da3012e1037564c89fabebaceb66bb5a1fc1aa03',
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
const failures: {
  label: string;
  expectedAccepted: boolean;
  actualAccepted: boolean;
}[] = [];
function checkSchema(
  schema: unknown,
  input: unknown,
  accepted: boolean,
  label: string,
) {
  const target = object(schema);
  assert(typeof target.safeParse === 'function', `Missing schema for ${label}`);
  const result: unknown = Reflect.apply(target.safeParse, target, [input]);
  const actualAccepted = object(result).success;
  assert(
    typeof actualAccepted === 'boolean',
    `Missing success flag for ${label}`,
  );
  if (actualAccepted !== accepted)
    failures.push({ label, expectedAccepted: accepted, actualAccepted });
  checks++;
}
function check(
  module: ObjectValue,
  name: string,
  input: unknown,
  accepted: boolean,
  label = name,
) {
  checkSchema(module[name], input, accepted, label);
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
const attribution = await load(iterationRoot, 'standard-attribution');
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

// 917 R1: an unedited AI proposal has no human signature. These use the
// upstream frozen fixtures directly; no contract implementation is copied here.
const draft = object(call(iterationFixtures, 'selectionUneditedDraftFixture'));
assert.equal(draft.humanVersion, null);
const pending = object(call(iterationFixtures, 'selectionRevisionFixture'));
const managerRevision = object(
  call(iterationFixtures, 'selectionManagerRevisionFixture'),
);
const success = (result: unknown) => ({
  status: 'success',
  replayed: false,
  result,
});
check(
  selection,
  'selectionRevisionSchema',
  draft,
  true,
  '917/R1 unedited draft has null humanVersion',
);
check(
  selection,
  'selectionRevisionReadResultSchema',
  { status: 'success', view: { audience: 'hr', revision: draft } },
  true,
  '917/R1 HR reads an unedited draft',
);
const managerDraft = { ...managerRevision, state: 'draft', humanVersion: null };
check(
  selection,
  'selectionRevisionReadResultSchema',
  { status: 'success', view: { audience: 'manager', revision: managerDraft } },
  true,
  '917/R1 manager reads an unedited draft',
);
check(
  selection,
  'createSelectionRevisionResultSchema',
  success(draft),
  true,
  '917/R1 create returns unedited draft',
);
const edited = { ...draft, humanVersion: pending.humanVersion };
check(
  selection,
  'createSelectionRevisionResultSchema',
  success(edited),
  false,
  '917/R1 creation cannot claim an HR version',
);
check(
  selection,
  'saveSelectionRevisionResultSchema',
  success(draft),
  false,
  '917/R1 save cannot keep the human version empty',
);
check(
  selection,
  'saveSelectionRevisionResultSchema',
  success(edited),
  true,
  '917/R1 an actual HR save remains draft',
);
check(
  selection,
  'submitSelectionRevisionResultSchema',
  success(edited),
  false,
  '917/R1 submission must leave draft',
);
check(
  selection,
  'submitSelectionRevisionResultSchema',
  success(pending),
  true,
  '917/R1 submitted revision retains human version',
);
check(
  selection,
  'selectionRevisionSchema',
  { ...pending, humanVersion: null },
  false,
  '917/R1 pending confirmation requires a human version',
);

// An honest empty model result differs from a provider failure, and each
// nonempty hypothesis still needs its actual supporting citations.
check(
  attribution,
  'generateStandardHypothesesResultSchema',
  success([]),
  true,
  '917/R1 empty hypotheses are a successful result',
);
check(
  attribution,
  'generateStandardHypothesesResultSchema',
  { status: 'model_failed', message: '演示：供应商失败' },
  true,
  '917/R1 provider failure remains failure',
);
check(
  attribution,
  'generateStandardHypothesesResultSchema',
  { status: 'model_failed', message: '演示：供应商失败', result: [] },
  false,
  '917/R1 failure cannot carry an empty success result',
);
const hypothesis = call(iterationFixtures, 'standardHypothesisFixture');
check(
  attribution,
  'generateStandardHypothesesResultSchema',
  success([hypothesis]),
  true,
  '917/R1 grounded nonempty hypothesis',
);
check(
  attribution,
  'generateStandardHypothesesResultSchema',
  success([replace(hypothesis, ['citations'], [])]),
  false,
  '917/R1 actual hypotheses still require citations',
);

// Contract postconditions only: this does not execute the future 918 database
// transaction, reopen a cohort, or prove persistence after restart.
const undoTransaction = call(
  iterationFixtures,
  'selectionPublicationUndoTransactionFixture',
);
check(
  selection,
  'selectionPublicationUndoTransactionSchema',
  undoTransaction,
  true,
  '917/R1 complete paired undo postconditions',
);
for (const [path, replacement, label] of [
  [
    ['restoredVersion', 'versionId'],
    'xe-select-unrelated',
    'only the original previous version can be restored',
  ],
  [
    ['restoredVersion', 'transition', 'role'],
    'manager',
    'restore_after_undo is system-only',
  ],
  [
    ['restoredVersion', 'transition', 'publicationId'],
    'unrelated-publication',
    'restoration belongs to the same publication',
  ],
  [
    ['withdrawnVersion', 'transition', 'to'],
    'draft',
    'withdrawn version returns to pending confirmation',
  ],
  [
    ['effectiveVersionAfterUndo', 'versionId'],
    'xe-select-v2',
    'current category read cannot retain the withdrawn version',
  ],
  [
    ['effectiveVersionAfterUndo', 'category'],
    'dimension_anchors',
    'restoration uses the selection category',
  ],
  [
    ['receipt', 'restoredDefaultForNewCohorts'],
    'xe-select-v2',
    'new cohort default returns to the previous version',
  ],
  [
    ['receipt', 'preservedBindings'],
    [],
    'existing cohort bindings cannot disappear',
  ],
  [
    ['historicalResultsPolicy'],
    'recompute',
    'history remains on its original version',
  ],
  [['recomputeHistoricalResults'], true, 'undo cannot recalculate history'],
  [
    ['boundary', 'requestedAt'],
    at(undoTransaction, ['boundary', 'receipt', 'undoUntil']),
    'the undo deadline remains exclusive',
  ],
] as const) {
  check(
    selection,
    'selectionPublicationUndoTransactionSchema',
    replace(undoTransaction, [...path], replacement),
    false,
    `917/R1 ${label}`,
  );
}
const bindings = at(undoTransaction, ['bindingsBefore']);
assert(Array.isArray(bindings) && bindings.length > 0);
check(
  selection,
  'selectionPublicationUndoTransactionSchema',
  replace(
    undoTransaction,
    ['receipt', 'preservedBindings'],
    bindings.map((b, index) =>
      index === 0 ? { ...object(b), standardVersionId: 'xe-select-v2' } : b,
    ),
  ),
  false,
  '917/R1 undo cannot rebind an existing cohort',
);

// Fixed name order is independent of sample counts. Same names use stable IDs;
// a reverse list or duplicate identity must fail even with otherwise valid data.
const hr = object(call(iterationFixtures, 'comparisonHrFixture'));
check(
  comparison,
  'comparisonHrPageSchema',
  hr,
  true,
  '917/R1 valid HR baseline',
);
const raters = hr.raters;
assert(Array.isArray(raters) && raters.length > 1);
check(
  comparison,
  'comparisonRatersSchema',
  raters,
  true,
  '917/R1 raters follow frozen name order',
);
check(
  comparison,
  'comparisonRatersSchema',
  [...raters].reverse(),
  false,
  '917/R1 reverse name order is rejected',
);
const tied = [
  {
    evaluator: { id: 'demo-rater-a', name: '演示同名评价人' },
    sample: {
      state: 'insufficient_sample',
      label: '样本不足',
      threshold: 5,
      comparableCaseCount: 0,
      caseIds: [],
    },
  },
  {
    ...object(raters[0]),
    evaluator: { id: 'demo-rater-b', name: '演示同名评价人' },
  },
];
check(
  comparison,
  'comparisonRatersSchema',
  tied,
  true,
  '917/R1 same names use ID order even across sample counts',
);
check(
  comparison,
  'comparisonRatersSchema',
  [...tied].reverse(),
  false,
  '917/R1 reversed stable IDs are rejected',
);
check(
  comparison,
  'comparisonRatersSchema',
  [tied[0], tied[0]],
  false,
  '917/R1 duplicate evaluator identities are rejected',
);

// Known upstream P1, reproduced at the SAME frozen SHA. Expect rejection of
// each contaminated distribution; a currently accepted payload is a failure,
// never a compatibility expectation or a skipped regression.
const rater = object(raters[0]);
const raterSample = object(rater.sample);
const ownIds = raterSample.caseIds;
const allCases = hr.cases;
const viewerId = object(rater.evaluator).id;
assert(Array.isArray(ownIds) && ownIds.length === 5 && Array.isArray(allCases));
const ownCases = allCases.filter((c) => ownIds.includes(object(c).id));
const access = {
  viewerId,
  now: '2026-10-31T10:00:00Z',
  ownCaseIds: ownIds,
  mapping,
  grants: ownCases.flatMap((c) => {
    const unit = object(c);
    return [unit.frontNodeId, unit.backNodeId].map((nodeId) => ({
      personId: object(unit.person).id,
      nodeId,
      validFrom: '2026-10-31T00:00:00Z',
      validUntil: null,
    }));
  }),
};
const raterPage = {
  audience: 'rater',
  viewerId,
  policy: hr.policy,
  cases: ownCases,
  sample: raterSample,
};
const authorized = call(
  comparison,
  'createAuthorizedRaterComparisonSchema',
  access,
);
checkSchema(
  authorized,
  raterPage,
  true,
  '917/P1 valid five-case authorized baseline',
);
checkSchema(
  authorized,
  replace(raterPage, ['sample', 'distribution'], hr.counts),
  false,
  '917/P1 own distribution cannot include HR-global counts',
);
checkSchema(
  authorized,
  replace(
    raterPage,
    ['sample', 'caseIds'],
    [...ownIds.slice(0, -1), 'demo-unrelated-case'],
  ),
  false,
  '917/P1 wrong case IDs remain rejected',
);
const hiddenOriginal = allCases.find((c) => {
  const unit = object(c);
  const front = object(unit.front);
  return (
    !ownIds.includes(unit.id) &&
    front.state === 'present' &&
    at(front, ['judgment', 'evaluator', 'id']) === viewerId
  );
});
assert(hiddenOriginal);
const hidden: ObjectValue = {
  ...object(hiddenOriginal),
  back: { state: 'withheld' },
  outcome: { state: 'withheld' },
};
const hiddenAccess = {
  ...access,
  ownCaseIds: [...ownIds, hidden.id],
  grants: [
    ...access.grants,
    {
      personId: object(hidden.person).id,
      nodeId: hidden.frontNodeId,
      validFrom: '2026-10-31T00:00:00Z',
      validUntil: null,
    },
  ],
};
const hiddenPage = { ...raterPage, cases: [...ownCases, hidden] };
const hiddenAuthorized = call(
  comparison,
  'createAuthorizedRaterComparisonSchema',
  hiddenAccess,
);
checkSchema(
  hiddenAuthorized,
  hiddenPage,
  true,
  '917/P1 withheld case with unchanged visible counts is valid',
);
const mixedHidden = replace(
  hiddenPage,
  ['sample', 'distribution', 'clear', 'consistent'],
  Number(at(hiddenPage, ['sample', 'distribution', 'clear', 'consistent'])) + 1,
);
checkSchema(
  hiddenAuthorized,
  mixedHidden,
  false,
  '917/P1 hidden-case statistics cannot enter visible distribution',
);
const mixedRaters = raters.map((r, index) =>
  index === 0
    ? {
        ...object(r),
        sample: { ...object(object(r).sample), distribution: hr.counts },
      }
    : r,
);
check(
  comparison,
  'comparisonHrPageSchema',
  { ...hr, raters: mixedRaters },
  false,
  '917/P1 per-rater HR distribution cannot include other raters',
);

console.log(
  JSON.stringify(
    {
      result: failures.length === 0 ? 'pass' : 'fail',
      level: 'frozen_schema_only',
      frozen,
      checks,
      passedChecks: checks - failures.length,
      failedChecks: failures.length,
      failures,
      upstreamIssue:
        'https://github.com/bowenQT/QTalent/pull/258#issuecomment-6547181016',
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

if (failures.length > 0) process.exitCode = 1;
