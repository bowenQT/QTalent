/** Explicit, opt-in schema checks against unchanged Git worktrees.
 * This is not collected by Vitest/Playwright and is not a runtime regression pass.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const frozen = {
  materials: 'e4462114690191fb9cbcd403f6fb0090bd3cfddb',
  iteration: '832209d177944b5ce18577794acb88314a6460da',
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
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function verifyRoot(root: string, sha: string): string {
  const path = resolve(root);
  assert.equal(
    git(path, 'rev-parse', 'HEAD'),
    sha,
    'Input is not the fixed commit',
  );
  assert.equal(
    git(path, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
    'Verification source tree must be clean',
  );
  return path;
}
function snapshot(root: string) {
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    tree: git(root, 'rev-parse', 'HEAD^{tree}'),
    clean: true,
  };
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
    maxWorkers: { type: 'string', default: '2' },
  },
});
assert(
  values['materials-root'] && values['iteration-root'],
  'Pass both frozen worktree roots explicitly',
);
assert.equal(
  process.versions.node.split('.')[0],
  '24',
  'Use the project Node24 runtime',
);
const maxWorkers = Number(values.maxWorkers);
assert(
  Number.isInteger(maxWorkers) && maxWorkers >= 1 && maxWorkers <= 2,
  'maxWorkers must be 1 or 2',
);
const toolRoot = git(
  dirname(fileURLToPath(import.meta.url)),
  'rev-parse',
  '--show-toplevel',
);
const tool = snapshot(verifyRoot(toolRoot, git(toolRoot, 'rev-parse', 'HEAD')));
const materialsRoot = verifyRoot(values['materials-root'], frozen.materials);
const iterationRoot = verifyRoot(values['iteration-root'], frozen.iteration);
const sources = await load(materialsRoot, 'sources');
const materials = await load(materialsRoot, 'materials');
const materialFixtures = await load(materialsRoot, 'materials.fixtures');
const review = await load(materialsRoot, 'material-review');
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

// Final 897 schema examples only. These are synthetic contract inputs, not
// persisted audits, authority grants or evidence that a model/transaction ran.
const reviewItems = materialFixtures.materialReviewItemsFixture;
assert(Array.isArray(reviewItems));
assert.deepEqual(
  reviewItems.map((entry) => object(entry).kind),
  [
    'speaker',
    'unknown_person',
    'image_scope',
    'unknown_interviewer',
    'unknown_project',
    'unknown_interview_candidate',
  ],
);
const resolutions: Record<string, ObjectValue> = {
  speaker: { action: 'bind', personId: 'demo-person' },
  unknown_person: { action: 'keep_original_only' },
  image_scope: { action: 'keep_attachment_only' },
  unknown_interviewer: {
    action: 'link_existing_interviewer',
    personId: 'demo-interviewer',
  },
  unknown_project: { action: 'mark_no_project' },
  unknown_interview_candidate: { action: 'keep_original_only' },
};
const resolvedExamples: ObjectValue[] = [];
for (const entry of reviewItems) {
  const item = object(entry);
  assert(typeof item.kind === 'string' && typeof item.revision === 'number');
  const resolution = resolutions[item.kind];
  check(
    review,
    'materialReviewItemSchema',
    item,
    true,
    `897/final ${item.kind} actual fixture`,
  );
  const command = {
    operationId: 'demo-contract-resolution',
    batchId: item.batchId,
    itemId: item.itemId,
    kind: item.kind,
    expectedRevision: item.revision,
    resolution,
  };
  check(
    review,
    'materialReviewCommandSchema',
    command,
    true,
    `897/final ${item.kind} typed command`,
  );
  const resolved = {
    itemId: item.itemId,
    batchId: item.batchId,
    evaluationNodeId: item.evaluationNodeId,
    materialId: item.materialId,
    originalVersionId: item.originalVersionId,
    source: item.source,
    kind: item.kind,
    revision: item.revision + 1,
    state: 'resolved',
    resolution,
    resolvedAt: '2026-11-01T03:00:00.000Z',
    auditId: 'demo-contract-audit',
    undo: { status: 'available' },
    ...('importRowId' in item ? { importRowId: item.importRowId } : {}),
    ...('observedName' in item ? { observedName: item.observedName } : {}),
    ...(item.kind === 'speaker' ? { quote: item.quote } : {}),
  };
  resolvedExamples.push(resolved);
  check(
    review,
    'materialReviewResolvedItemSchema',
    resolved,
    true,
    `897/final ${item.kind} question and resolved result`,
  );
  const questionField =
    item.kind === 'speaker'
      ? 'quote'
      : 'observedName' in item
        ? 'observedName'
        : null;
  if (questionField) {
    const missingQuestion = { ...resolved };
    delete missingQuestion[questionField];
    check(
      review,
      'materialReviewResolvedItemSchema',
      missingQuestion,
      false,
      `897/final ${item.kind} cannot omit question context`,
    );
  }
  const resolutionReceipt = {
    batchId: item.batchId,
    materialId: item.materialId,
    itemId: item.itemId,
    kind: item.kind,
    revision: resolved.revision,
    resolution,
    remainingReviewItemIds: ['demo-unrelated-review'],
    blockingReviewItemIds: [],
    invalidatedDraftIds: [],
    resume: null,
  };
  check(
    review,
    'materialReviewResolutionReceiptSchema',
    resolutionReceipt,
    true,
    `897/final ${item.kind} explicit target and action`,
  );
  if (
    ['keep_original_only', 'keep_attachment_only'].includes(
      String(resolution.action),
    )
  )
    check(
      review,
      'materialReviewResolutionReceiptSchema',
      {
        ...resolutionReceipt,
        resume: {
          stage:
            item.kind === 'image_scope'
              ? 'image_scope_check'
              : item.kind === 'unknown_interview_candidate'
                ? 'interview_import'
                : 'organizing',
          jobId: 'demo-forbidden-resume',
        },
      },
      false,
      `897/final ${item.kind} retention cannot enqueue model work`,
    );
  const undoCommand = {
    operationId: 'demo-contract-undo',
    batchId: item.batchId,
    itemId: item.itemId,
    kind: item.kind,
    action: 'undo',
    expectedRevision: resolved.revision,
  };
  check(
    review,
    'materialReviewUndoCommandSchema',
    undoCommand,
    true,
    `897/final ${item.kind} undo command`,
  );
  check(
    review,
    'materialReviewUndoCommandSchema',
    { ...undoCommand, actorId: 'demo-forged-actor' },
    false,
    `897/final ${item.kind} undo cannot claim authority`,
  );
  const undoReceipt = {
    previousRevision: resolved.revision,
    item: { ...item, revision: resolved.revision + 1, state: 'pending' },
    invalidatedDraftIds: ['demo-unconfirmed-draft'],
    auditId: 'demo-contract-undo-audit',
    resume: null,
  };
  check(
    review,
    'materialReviewUndoReceiptSchema',
    undoReceipt,
    true,
    `897/final ${item.kind} undo returns pending next revision`,
  );
  check(
    review,
    'materialReviewUndoReceiptSchema',
    { ...undoReceipt, previousRevision: resolved.revision - 1 },
    false,
    `897/final ${item.kind} undo cannot skip revision`,
  );
}
const projectResolved = resolvedExamples.find(
  (item) => item.kind === 'unknown_project',
);
assert(projectResolved);
const completedExample = {
  batchId: projectResolved.batchId,
  revision: 3,
  evaluationNodeId: projectResolved.evaluationNodeId,
  personIds: [],
  projectId: null,
  hasHiddenContent: false,
  status: 'completed',
  jobId: null,
  textMaterial: null,
  files: [
    {
      materialId: projectResolved.materialId,
      originalVersionId: projectResolved.originalVersionId,
      clientFileId: 'demo-contract-file',
      filename: '演示材料',
      status: 'parsed',
      parseVersionId: 'demo-contract-parse',
    },
  ],
  items: [],
  resolvedItems: [projectResolved],
  draftSet: null,
  confirmedDrafts: [],
  error: null,
  counts: {
    files: {
      total: 1,
      processing: 0,
      parsed: 1,
      needs_review: 0,
      unsupported: 0,
      failed: 0,
      original_only: 0,
      attachment_only: 0,
    },
    events: { total: 0, awaiting_confirmation: 0, confirmed: 0 },
    reviewItems: 0,
  },
};
check(
  materials,
  'materialBatchReceiptSchema',
  completedExample,
  true,
  '897/final resolved projection is not an unresolved count',
);
check(
  materials,
  'materialBatchReceiptSchema',
  { ...completedExample, hasHiddenContent: true },
  true,
  '897/final hidden-content boolean with visible counts',
);
for (const patch of [
  { hiddenCount: 1 },
  { hiddenPersonIds: ['demo-hidden-person'] },
  { hasHiddenContent: 1 },
])
  check(
    materials,
    'materialBatchReceiptSchema',
    { ...completedExample, ...patch },
    false,
    '897/final hidden identities and counts cannot be disclosed',
  );
for (const field of ['resolvedItems', 'hasHiddenContent']) {
  const missing: ObjectValue = { ...completedExample };
  delete missing[field];
  check(
    materials,
    'materialBatchReceiptSchema',
    missing,
    false,
    `897/final receipt requires ${field}`,
  );
}
const pendingProject = reviewItems.find(
  (item) => object(item).kind === 'unknown_project',
);
assert(pendingProject);
const pendingExample = {
  ...completedExample,
  status: 'needs_review',
  items: [pendingProject],
  resolvedItems: [],
  counts: { ...completedExample.counts, reviewItems: 1 },
};
check(
  materials,
  'materialBatchReceiptSchema',
  pendingExample,
  true,
  '897/final valid pending-only snapshot control',
);
check(
  materials,
  'materialBatchReceiptSchema',
  { ...pendingExample, resolvedItems: [projectResolved] },
  false,
  '897/final one item cannot be both pending and resolved',
);
const legacyInput = { ...object(materialFixtures.materialBatchInputFixture) };
delete legacyInput.projectId;
check(
  materials,
  'materialBatchInputSchema',
  legacyInput,
  false,
  '897/final old input without projectId is rejected',
);
const speakerResolved = resolvedExamples[0];
check(
  review,
  'materialReviewResolvedItemSchema',
  {
    ...speakerResolved,
    undo: { status: 'blocked', reason: 'dependent_draft_confirmed' },
  },
  true,
  '897/final confirmation cutoff is server display metadata',
);
check(
  review,
  'materialReviewResolvedItemSchema',
  {
    ...speakerResolved,
    undo: { status: 'blocked', reason: 'interview_row_imported' },
  },
  false,
  '897/final imported-row cutoff is interview-only',
);
const interviewResolved = resolvedExamples.find(
  (item) => item.kind === 'unknown_interviewer',
);
assert(interviewResolved);
check(
  review,
  'materialReviewResolvedItemSchema',
  {
    ...interviewResolved,
    undo: { status: 'blocked', reason: 'interview_row_imported' },
  },
  true,
  '897/final imported interview relation remains read-only metadata',
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

verifyRoot(toolRoot, tool.head);
verifyRoot(materialsRoot, frozen.materials);
verifyRoot(iterationRoot, frozen.iteration);

console.log(
  JSON.stringify(
    {
      result: failures.length === 0 ? 'pass' : 'fail',
      level: 'frozen_schema_only',
      frozen,
      tool: {
        ...tool,
        scriptSha256: createHash('sha256')
          .update(readFileSync(fileURLToPath(import.meta.url)))
          .digest('hex'),
      },
      inputs: {
        materials: snapshot(materialsRoot),
        iteration: snapshot(iterationRoot),
      },
      execution: { maxWorkers, parserCalls: 0 },
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
