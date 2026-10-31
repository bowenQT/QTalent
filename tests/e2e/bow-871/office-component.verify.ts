/** Explicit fixed-input Node worker regression; not application/browser E2E. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const officeHead = 'dbe30d13f1ad6ae0aaaef0bf920b258805417e5d';
const materialsHead = '0b20a913621121848219e0966ba4bf4844d1bdb3';
const unchangedTools = {
  'frozen-contracts.verify.ts':
    '607e4b8f057c319dbd1b4cd30026a8242c8e39e0ebefebb04a075370be37689f',
  'interview-component.verify.ts':
    '66b15b8dedb7b02895f7775fdf59d235680b80cc086fc02b7f6697edacd95e78',
};
const fixtures = [
  {
    file: 'ordered-slides.pptx',
    format: 'pptx',
    sha256: '524aa2f4eefda4578ba4f8e1c2ca3e97ce58d2f9d79260e6281ac5228688307f',
    bytes: 3708,
    fragments: 4,
  },
  {
    file: 'cached-values.xlsx',
    format: 'xlsx',
    sha256: 'eb6daea58e0cacf6490a335c39683b10398d06ea4c0b2ea06c772fd9f4bc5222',
    bytes: 2090,
    fragments: 19,
  },
  {
    file: 'cache-types.xlsx',
    format: 'xlsx',
    sha256: 'd69fc102492031c157ccd7ffdd17a61f06b757bddf440c8a67ee6aa210ec5e22',
    bytes: 2254,
    fragments: 14,
  },
] as const;
type Value = Record<string, unknown>;
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
  if (expected) assert.equal(head, expected, 'Input is not the fixed commit');
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

function assertPresentation(fragments: Value[]) {
  // Expected facts only: the fixed OOXML orders slide7 then slide2 and links notes3/8.
  assert.deepEqual(fragments, [
    {
      kind: 'slide_text',
      text: '演示第一页：团队甲共同完成交付。',
      location: { kind: 'presentation', slide: 1 },
    },
    {
      kind: 'speaker_notes',
      text: '演示第一页备注：没有个人身份映射。',
      location: { kind: 'presentation', slide: 1 },
    },
    {
      kind: 'slide_text',
      text: '演示第二页：共同成果保留团队归属。',
      location: { kind: 'presentation', slide: 2 },
    },
    {
      kind: 'speaker_notes',
      text: '演示第二页备注：不复制为个人分。',
      location: { kind: 'presentation', slide: 2 },
    },
  ]);
}
function assertSpreadsheet(fragments: Value[], typed: boolean) {
  assert(fragments.every((fragment) => fragment.kind === 'cell'));
  const find = (sheet: string, cell: string) =>
    fragments.find((fragment) => {
      const location = object(fragment.location);
      return location.sheet === sheet && location.cell === cell;
    });
  const at = (cell: string) => object(find('演示个人记录', cell));
  const team = fragments.filter(
    (fragment) => object(fragment.location).sheet === '演示团队结果',
  );
  assert(team.length > 0 && team.every((fragment) => fragment.hidden === true));
  assert.equal(object(find('演示团队结果', 'B2')).text, '4');
  assert.equal(
    find('演示团队结果', 'B3'),
    undefined,
    'Merged team value was copied',
  );
  if (!typed) {
    const cachedFacts = [
      {
        cell: 'D2',
        text: '42',
        expression: '1+1',
        cached: {
          state: 'present',
          value: { type: 'number', value: '42', raw: '42' },
        },
      },
      {
        cell: 'D3',
        text: null,
        expression: 'SUM(C2:C9)',
        cached: { state: 'missing' },
      },
      {
        cell: 'F2',
        text: '0',
        expression: '3-3',
        cached: {
          state: 'present',
          value: { type: 'number', value: '0', raw: '0' },
        },
      },
      {
        cell: 'F3',
        text: 'false',
        expression: '1=2',
        cached: {
          state: 'present',
          value: { type: 'boolean', value: false, raw: '0' },
        },
      },
      {
        cell: 'D4',
        text: '#DIV/0!',
        expression: '1/0',
        cached: {
          state: 'present',
          value: { type: 'error', value: '#DIV/0!', raw: '#DIV/0!' },
        },
      },
    ];
    for (const expected of cachedFacts) {
      const actual = at(expected.cell),
        content = object(actual.content);
      assert.equal(actual.text, expected.text);
      assert.equal(content.kind, 'formula');
      assert.equal(content.expression, expected.expression);
      assert.deepEqual(content.cached, expected.cached);
    }
    for (const [cell, text, value] of [
      ['C2', '3', { type: 'number', value: '3', raw: '3' }],
      ['F4', '0', { type: 'number', value: '0', raw: '0' }],
      ['H4', 'false', { type: 'boolean', value: false, raw: '0' }],
    ] as const) {
      assert.equal(at(cell).text, text);
      assert.deepEqual(at(cell).content, { kind: 'constant', value });
    }
    assert.equal(at('AA6').text, '演示：远列定位');
    return;
  }
  for (const [cell, text, value] of [
    ['A8', '', { type: 'text', value: '', raw: '0' }],
    ['B8', '演示富文本', { type: 'text', value: '演示富文本', raw: '1' }],
    ['D8', '=2+2', { type: 'text', value: '=2+2', raw: '=2+2' }],
    [
      'E8',
      '2026-10-31T12:30:00Z',
      {
        type: 'date',
        value: '2026-10-31T12:30:00Z',
        raw: '2026-10-31T12:30:00Z',
      },
    ],
    [
      'G8',
      '9007199254740993',
      { type: 'number', value: '9007199254740993', raw: '9007199254740993' },
    ],
    ['H8', '', { type: 'text', value: '', raw: '' }],
  ] as const) {
    assert.equal(at(cell).text, text);
    assert.deepEqual(at(cell).content, { kind: 'constant', value });
  }
  const empty = object(at('C8').content);
  assert.equal(at('C8').text, '');
  assert.equal(empty.kind, 'formula');
  assert.equal(empty.expression, '""');
  assert.deepEqual(empty.cached, {
    state: 'present',
    value: { type: 'text', value: '', raw: '' },
  });
  for (const [cell, expression, raw] of [
    ['F8', 'A8', '1'],
    ['F9', '', '2'],
  ] as const) {
    const content = object(at(cell).content);
    assert.equal(content.kind, 'formula');
    assert.equal(content.expression, expression);
    assert.equal(content.formulaType, 'shared');
    assert.equal(content.sharedIndex, '0');
    assert.deepEqual(content.cached, {
      state: 'present',
      value: { type: 'number', value: raw, raw },
    });
  }
  assert.equal(object(at('F8').content).range, 'F8:F9');
  assert.equal(
    find('演示个人记录', 'Z9'),
    undefined,
    'Style-only cell became a fact',
  );
}

async function main() {
  assert.equal(
    process.versions.node.split('.')[0],
    '24',
    'Use the project Node24 runtime',
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
    'Pass both fixed input roots explicitly',
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
  const officeRoot = resolve(values['component-root']);
  const materialsRoot = resolve(values['materials-root']);
  const tool = cleanRoot(toolRoot);
  const office = cleanRoot(officeRoot, officeHead);
  const materials = cleanRoot(materialsRoot, materialsHead);
  for (const [file, expected] of Object.entries(unchangedTools)) {
    assert.equal(
      hash(await readFile(join(toolRoot, 'tests/e2e/bow-871', file))),
      expected,
      `Existing tool changed: ${file}`,
    );
  }
  const adapter = await load(
    officeRoot,
    'src/server/modules/records/office/parse-isolated.ts',
  );
  const contract = await load(materialsRoot, 'src/contracts/sources.ts');
  const schema = object(contract.materialSourceLocationSchema);
  const baselinePorts = ports();
  const cases: {
    file: string;
    level: 'node_worker_component';
    result: 'pass' | 'fail';
    error?: string;
  }[] = [];
  let activeCalls = 0,
    peakCalls = 0,
    locatorsChecked = 0;
  for (const fixture of fixtures) {
    try {
      // Only repository bytes enter the parser. Expected values below are assertions, never input repair.
      const bytes = await readFile(
        join(officeRoot, 'tests/fixtures/office', fixture.file),
      );
      assert.equal(bytes.byteLength, fixture.bytes);
      assert.equal(hash(bytes), fixture.sha256);
      const before = Uint8Array.from(bytes);
      let response: unknown;
      activeCalls++;
      peakCalls = Math.max(peakCalls, activeCalls);
      assert(activeCalls <= maxWorkers);
      try {
        response = await call(
          adapter,
          'parseOfficeIsolated',
          { format: fixture.format, bytes },
          { maxDurationMs: 10000, maxOutputBytes: 1024 * 1024 },
        );
      } finally {
        activeCalls--;
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert(
          ports() <= baselinePorts,
          'Office parser left an active MessagePort',
        );
      }
      assert.deepEqual(
        Uint8Array.from(bytes),
        before,
        'Caller bytes changed or detached',
      );
      const result = object(response);
      assert.equal(result.format, fixture.format);
      assert.equal(result.inputSha256, fixture.sha256);
      assert.equal(result.locationContractSha, materialsHead);
      assert.equal(result.attribution, 'unresolved');
      assert.deepEqual(Object.keys(result).sort(), [
        'attribution',
        'format',
        'fragments',
        'inputSha256',
        'locationContractSha',
      ]);
      const fragments = array(result.fragments).map(object);
      assert.equal(fragments.length, fixture.fragments);
      if (fixture.format === 'pptx') assertPresentation(fragments);
      else assertSpreadsheet(fragments, fixture.file === 'cache-types.xlsx');
      for (const fragment of fragments) {
        const location = object(fragment.location);
        assert.deepEqual(call(schema, 'parse', location), location);
        assert.equal(
          object(
            call(schema, 'safeParse', {
              ...location,
              inventedPersonId: 'demo-forbidden',
            }),
          ).success,
          false,
        );
        locatorsChecked++;
      }
      cases.push({
        file: fixture.file,
        level: 'node_worker_component',
        result: 'pass',
      });
    } catch (error) {
      cases.push({
        file: fixture.file,
        level: 'node_worker_component',
        result: 'fail',
        error:
          error instanceof Error
            ? error.message.split('\n')[0]
            : 'Unknown failure',
      });
    }
  }
  assert.equal(activeCalls, 0);
  assert(ports() <= baselinePorts, 'Office worker resources remain active');
  cleanRoot(toolRoot, tool.head);
  cleanRoot(officeRoot, office.head);
  cleanRoot(materialsRoot, materials.head);
  const failed = cases.filter((entry) => entry.result === 'fail').length;
  console.log(
    JSON.stringify(
      {
        result: failed ? 'fail' : 'pass',
        level: 'node_worker_component',
        tool: {
          ...tool,
          scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
          unchangedTools,
        },
        inputs: { office, materials },
        node: process.version,
        execution: {
          maxWorkers,
          sequential: true,
          peakConcurrentParserCalls: peakCalls,
          activeParserCallsAtEnd: activeCalls,
          messagePortsBefore: baselinePorts,
          messagePortsAfter: ports(),
        },
        checks: cases.length,
        failedChecks: failed,
        locatorsChecked,
        cases,
        fixtures,
        notVerified: [
          'author cancellation/timeout/budget/negative cases not rerun',
          'production request/session authorization',
          'original object access and canonical fragment binding',
          'person attribution',
          'database transactions',
          'Next deployment worker loading',
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
