/** Explicit component regression; never collected as application E2E. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const inputHead = 'c1822464f466851a37594f7ff2cf734b86711646';
const materialsHead = 'e4462114690191fb9cbcd403f6fb0090bd3cfddb';
const schemaToolHash =
  '4cded1b4619475b0f18f5cadcc6a89137f467add7bb0270c1e888c6494a114df';
const dependencies = {
  nodeAuthorization: 'd5cf82fa264e022b8e4c928b008461e98c53293d',
  pdfParser: '624e05b26b97a6ed5684f0d11637ea387301f8a5',
  materials: '0b20a913621121848219e0966ba4bf4844d1bdb3',
  syntheticFixtures: '9533f64306ed68a6c2d2966474ef6d89033a5e31',
};
type Value = Record<string, unknown>;
type Level = 'node_worker_component' | 'pure_composition';
function object(value: unknown): Value {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Value;
}
function array(value: unknown): unknown[] {
  assert(Array.isArray(value));
  return value;
}
function call(namespace: Value, name: string, ...args: unknown[]): unknown {
  const fn = namespace[name];
  assert(typeof fn === 'function', `Missing actual function: ${name}`);
  return Reflect.apply(fn, namespace, args);
}
function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function cleanRoot(root: string, expected?: string) {
  const head = git(root, 'rev-parse', 'HEAD');
  if (expected)
    assert.equal(
      head,
      expected,
      'Input HEAD changed or is not the fixed component commit',
    );
  assert.equal(
    git(root, 'status', '--porcelain=v1', '--untracked-files=all'),
    '',
    'Verification source tree must be clean',
  );
  return { head, tree: git(root, 'rev-parse', 'HEAD^{tree}'), clean: true };
}
async function load(root: string, file: string): Promise<Value> {
  const imported: unknown = await import(pathToFileURL(join(root, file)).href);
  return object(imported);
}
const hash = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const ports = () =>
  process.getActiveResourcesInfo().filter((name) => name === 'MessagePort')
    .length;

async function main() {
  assert.equal(
    process.versions.node.split('.')[0],
    '24',
    'Run with the project Node24 runtime',
  );
  const { values } = parseArgs({
    options: {
      'component-root': { type: 'string' },
      'materials-root': { type: 'string' },
      maxWorkers: { type: 'string', default: '2' },
    },
  });
  assert(
    values['component-root'] && values['materials-root'],
    'Pass component and final contract roots explicitly',
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
  const root = resolve(values['component-root']);
  const tool = cleanRoot(toolRoot);
  const input = cleanRoot(root, inputHead);
  const materialsRoot = resolve(values['materials-root']);
  const materialContract = cleanRoot(materialsRoot, materialsHead);
  for (const sha of Object.values(dependencies))
    git(root, 'merge-base', '--is-ancestor', sha, input.head);
  const existingTool = hash(
    await readFile(
      join(toolRoot, 'tests/e2e/bow-871/frozen-contracts.verify.ts'),
    ),
  );
  assert.equal(
    existingTool,
    schemaToolHash,
    'Frozen schema tool does not match this verifier revision',
  );
  const adapter = await load(
    root,
    'src/server/usecases/interview-import/pdf-isolation.ts',
  );
  const importer = await load(
    root,
    'src/server/usecases/interview-import/plan.ts',
  );
  const sources = await load(materialsRoot, 'src/contracts/sources.ts');
  const authorization = await load(root, 'src/server/authz/evaluation-node.ts');
  const fixtures = await load(
    root,
    'src/server/modules/programs/reassignment.fixtures.ts',
  );
  const manifest = object(
    JSON.parse(
      await readFile(
        join(root, 'tests/fixtures/bow-896/manifest.json'),
        'utf8',
      ),
    ),
  );
  const candidateOracle = object(
    array(
      object(
        JSON.parse(
          await readFile(
            join(root, 'tests/fixtures/bow-896/candidates.json'),
            'utf8',
          ),
        ),
      ).rows,
    )[0],
  );
  const cases: {
    label: string;
    level: Level;
    result: 'pass' | 'fail';
    error?: string;
  }[] = [];
  async function check(
    level: Level,
    label: string,
    run: () => unknown | Promise<unknown>,
  ) {
    try {
      await run();
      cases.push({ label, level, result: 'pass' });
    } catch (error) {
      cases.push({
        label,
        level,
        result: 'fail',
        error:
          error instanceof Error
            ? error.message.split('\n')[0]
            : 'Unknown failure',
      });
    }
  }
  const parsed = new Map<string, Value>();
  const assets: { file: string; sha256: string; bytes: number }[] = [];
  const baselinePorts = ports();
  let activeCalls = 0,
    peakCalls = 0,
    sourceRegionsChecked = 0;
  for (const name of ['campus', 'hr', 'professional']) {
    await check(
      'node_worker_component',
      `C1/${name}: real isolated PDF, original scale and text provenance`,
      async () => {
        const file = `interview/${name}.pdf`;
        const content = await readFile(
          join(root, 'tests/fixtures/bow-896', file),
        );
        const asset = object(
          array(manifest.assets).find((value) => object(value).file === file),
        );
        assert.equal(
          hash(content),
          asset.sha256,
          'Fixture bytes differ from the fixed manifest',
        );
        assert.equal(content.byteLength, asset.bytes);
        assets.push({ file, sha256: hash(content), bytes: content.byteLength });
        let response: unknown;
        activeCalls++;
        peakCalls = Math.max(peakCalls, activeCalls);
        assert(activeCalls <= maxWorkers);
        try {
          response = await call(adapter, 'parseInterviewPdfIsolated', {
            bytes: content,
            options: {
              positionKind: 'non_management',
              allowSyntheticDemo: true,
            },
            budget: {
              maxInputBytes: 1024 * 1024,
              maxOutputBytes: 1024 * 1024,
              maxDurationMs: 10000,
            },
          });
        } finally {
          activeCalls--;
          await new Promise<void>((resolve) => setImmediate(resolve));
          assert(
            ports() <= baselinePorts,
            'Parser left an active MessagePort after settling',
          );
        }
        const outcome = object(response);
        assert.equal(outcome.status, 'parsed', 'Isolated worker failed');
        const native = object(outcome.result);
        assert.equal(
          native.status,
          'parsed',
          'Normal synthetic PDF did not yield a complete review',
        );
        parsed.set(name, native); // Actual output only; never replace it with manifest expectations.
        const rows = array(native.reviews);
        assert.equal(rows.length, 1);
        const row = object(rows[0]);
        const oracle = object(
          array(manifest.interviewCases).find(
            (value) => object(value).id === name,
          ),
        );
        assert.equal(row.template, oracle.template);
        const identity = object(row.identity);
        assert.equal(
          object(identity.candidateName).value,
          candidateOracle.name,
        );
        assert.equal(
          identity.positionNumber,
          null,
          'No position identifier may be invented',
        );
        for (const expected of array(oracle.rows).map(object)) {
          const selected =
            expected.label === '面试评级'
              ? row.interviewRating
              : expected.label === '建议职级'
                ? row.suggestedLevel
                : object(
                    array(row.dimensions).find(
                      (value) => object(value).name === expected.label,
                    ),
                  ).selection;
          const actual = object(selected);
          if (expected.applicable === false)
            assert.equal(actual.status, 'not_applicable');
          else {
            assert.equal(actual.status, 'recognized');
            assert.equal(actual.value, String(expected.expected));
          }
        }
        const pages = array(native.pageTexts).map(object);
        for (const page of pages) {
          assert.equal(page.extractionVersion, 'interview-review-lines-v1');
          assert(typeof page.text === 'string');
          assert.equal(hash(page.text), page.sha256);
        }
        const excerpt = (value: unknown) => {
          const region = object(value),
            range = object(region.textRange);
          const page = object(
            pages.find((value) => value.page === region.page),
          );
          assert(
            typeof page.text === 'string' &&
              typeof range.start === 'number' &&
              typeof range.end === 'number',
          );
          return page.text.slice(range.start, range.end);
        };
        assert(
          excerpt(row.templateSource).includes(String(row.template)),
          'Template citation points to different text',
        );
        for (const value of [
          identity.candidateName,
          ...Object.values(object(row.metadata)),
        ]) {
          if (value === null) continue;
          const field = object(value);
          assert(typeof field.value === 'string');
          assert(
            array(field.sources).map(excerpt).join('\n').includes(field.value),
            'Field value cannot be recovered from its cited original text',
          );
        }
        for (const [label, value] of [
          ...array(row.dimensions).map((value) => [
            object(value).name,
            object(value).selection,
          ]),
          ['面试评级', row.interviewRating],
          ['建议职级', row.suggestedLevel],
        ]) {
          const selection = object(value);
          if (selection.status === 'not_applicable') continue;
          const text = excerpt(selection.source);
          assert(
            typeof label === 'string' && text.includes(label),
            'Selection citation points to a different scale row',
          );
          if (selection.status === 'recognized')
            assert(
              typeof selection.value === 'string' &&
                text.includes(selection.value),
              'Selected raw label is absent from its cited row',
            );
        }
        const fields = [
          identity.candidateName,
          ...Object.values(object(row.metadata)),
        ];
        const regions = [
          row.templateSource,
          ...fields.flatMap((value) =>
            value === null ? [] : array(object(value).sources),
          ),
          ...[
            ...array(row.dimensions).map((value) => object(value).selection),
            row.interviewRating,
            row.suggestedLevel,
          ].flatMap((value) =>
            object(value).status === 'not_applicable'
              ? []
              : [object(value).source],
          ),
        ];
        for (const value of regions) {
          const region = object(value),
            range = object(region.textRange);
          const page = object(
            pages.find((value) => value.page === region.page),
          );
          assert(typeof page.text === 'string');
          assert(
            typeof range.start === 'number' &&
              Number.isInteger(range.start) &&
              range.start >= 0,
          );
          assert(
            typeof range.end === 'number' &&
              Number.isInteger(range.end) &&
              range.end > range.start &&
              range.end <= page.text.length,
          );
          assert(page.text.slice(range.start, range.end).trim().length > 0);
          const location = {
            kind: 'pdf',
            page: region.page,
            textRange: region.textRange,
          };
          assert.deepEqual(
            call(
              object(sources.materialSourceLocationSchema),
              'parse',
              location,
            ),
            location,
          );
          assert.equal(
            object(
              call(object(sources.materialSourceLocationSchema), 'safeParse', {
                ...location,
                box: region.box,
              }),
            ).success,
            false,
          );
          sourceRegionsChecked++;
        }
      },
    );
  }
  function context(): Value {
    return object(call(fixtures, 'evaluationContextFixture'));
  }
  function incompleteFacts(ctx: Value, name = 'professional') {
    const native = object(parsed.get(name)),
      row = object(array(native.reviews)[0]),
      identity = object(row.identity);
    return {
      context: ctx,
      batchId: 'demo-871-unpersisted-batch',
      rowId: `demo-871-${name}`,
      evaluationNodeId: 'demo-node',
      originalVersionId: '',
      materialId: null,
      parsed: native,
      reviewIndex: 0,
      observedIdentity: {
        name: object(identity.candidateName).value,
        positionCode: identity.positionNumber,
      },
      candidates: [],
      confirmedCandidateId: null,
      directory: [],
      employments: [],
      source: null,
      existing: [],
      pendingInterviewer: null,
      resolution: null,
    };
  }
  for (const name of ['campus', 'hr', 'professional']) {
    await check(
      'pure_composition',
      `N06/${name}: actual absent position prevents import planning`,
      () => {
        assert.deepEqual(
          call(
            importer,
            'planInterviewImport',
            incompleteFacts(context(), name),
          ),
          { status: 'not_ready', reason: 'candidate_identity_missing' },
        );
      },
    );
  }
  for (const role of ['employee', 'evaluator', 'manager']) {
    await check(
      'pure_composition',
      `C3/${role}: non-HR cannot obtain an interview import plan`,
      () => {
        const ctx = context(),
          account = object(ctx.account);
        if (role === 'manager')
          ctx.grants = array(ctx.grants).map((value) => ({
            ...object(value),
            role: 'manager',
            scope: 'company',
            cohortId: null,
          }));
        else {
          ctx.grants = [];
          account.id = `demo-871-${role}`;
          account.personId =
            role === 'evaluator' ? 'demo-new-evaluator' : 'demo-person';
        }
        assert.deepEqual(
          call(importer, 'planInterviewImport', incompleteFacts(ctx)),
          { status: 'forbidden' },
        );
      },
    );
  }
  const evaluator = (personId: string) => {
    const ctx = context();
    ctx.grants = [];
    object(ctx.account).id = 'demo-871-evaluator';
    object(ctx.account).personId = personId;
    return ctx;
  };
  await check(
    'pure_composition',
    'N01/current relation permits its own node',
    () => {
      assert.equal(
        call(
          authorization,
          'canEvaluateNode',
          evaluator('demo-new-evaluator'),
          'demo-node',
          'demo-person',
        ),
        true,
      );
    },
  );
  await check(
    'pure_composition',
    'N01/same person across another node is denied',
    () => {
      assert.equal(
        call(
          authorization,
          'canEvaluateNode',
          evaluator('demo-new-evaluator'),
          'demo-other-node',
          'demo-person',
        ),
        false,
      );
    },
  );
  for (const [label, delta, allowed] of [
    ['one millisecond before expiry', -1, true],
    ['exact expiry', 0, false],
  ] as const) {
    await check('pure_composition', `N01/${label}`, () => {
      const ctx = evaluator('demo-old-evaluator');
      const relation = object(
        array(ctx.evaluationRelations).find(
          (value) => object(value).id === 'demo-old-relation',
        ),
      );
      assert(typeof relation.validTo === 'string');
      ctx.now = new Date(Date.parse(relation.validTo) + delta).toISOString();
      assert.equal(
        call(authorization, 'canEvaluateNode', ctx, 'demo-node', 'demo-person'),
        allowed,
      );
    });
  }
  assert.equal(activeCalls, 0);
  assert(ports() <= baselinePorts, 'Worker resources remain active');
  cleanRoot(root, input.head);
  cleanRoot(materialsRoot, materialContract.head);
  cleanRoot(toolRoot, tool.head);
  const failed = cases.filter((value) => value.result === 'fail').length;
  console.log(
    JSON.stringify(
      {
        result: failed ? 'fail' : 'pass',
        tool: {
          ...tool,
          scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
          schemaToolSha256: existingTool,
        },
        input: { ...input, dependencies },
        materialContract,
        compatibility: {
          producerMaterialsAncestor: dependencies.materials,
          validatedAgainst: materialContract.head,
          scope: 'locator_shape_only',
        },
        node: process.version,
        execution: {
          maxWorkers,
          sequential: true,
          peakConcurrentParserCalls: peakCalls,
          activeParserCallsAtEnd: activeCalls,
          messagePortsBefore: baselinePorts,
          messagePortsAfter: ports(),
        },
        levels: Object.fromEntries(
          ['node_worker_component', 'pure_composition'].map((level) => [
            level,
            {
              checks: cases.filter((value) => value.level === level).length,
              passed: cases.filter(
                (value) => value.level === level && value.result === 'pass',
              ).length,
            },
          ]),
        ),
        checks: cases.length,
        failedChecks: failed,
        cases,
        assets,
        sourceRegionsChecked,
        notVerified: [
          '906 production consumer adoption of final897 review/receipt contract',
          'production request/session authorization',
          'original object access',
          'candidate matching/HR confirmation',
          'canonical persistence/PG transactions',
          'publication/restart',
          'model calls',
          'browser/runtime E2E',
        ],
      },
      null,
      2,
    ),
  );
  if (failed) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(
    JSON.stringify({
      result: 'fail',
      stage: 'input_or_tool_guard',
      error:
        error instanceof Error
          ? error.message.split('\n')[0]
          : 'Unknown verifier failure',
    }),
  );
  process.exitCode = 1;
});
