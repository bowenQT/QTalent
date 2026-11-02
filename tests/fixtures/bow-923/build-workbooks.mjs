import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import {
  CONTRACT_SHA,
  FIXTURE_VERSION,
  backHeaders,
  buildScene,
  frontHeaders,
  originals,
} from './scene.mjs';
import { createSeedInput } from './seed-input.mjs';

const [extractDir, outputDir, qaDir, templateArg] = process.argv.slice(2);
assert(
  extractDir && outputDir && qaDir,
  'usage: node build-workbooks.mjs <extract-dir> <new-output-dir> <qa-dir> [template-dir]',
);
const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = templateArg ?? here;
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });
// Step two consumes step one's output only, never the committed copies.
const data = await buildScene(pathToFileURL(path.resolve(extractDir) + '/'));
// Committed fixtures follow the repository Prettier style; format on write so a
// rerun reproduces the committed bytes.
const prettierOptions = await prettier.resolveConfig(
  path.join(here, 'roster.json'),
);
const writeJson = async (name, value) =>
  fs.writeFile(
    path.join(outputDir, name),
    await prettier.format(JSON.stringify(value), {
      ...prettierOptions,
      filepath: name,
    }),
  );
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  fixtureVersion: FIXTURE_VERSION,
  demo: true,
  notice:
    '两份表均为化名重建的演示原表，不是历史原件；既有 prototype_snapshot 未修改。',
  contractSha: CONTRACT_SHA,
  rosterCommit: data.roster.provenance.commit,
  prototypeCommit: data.prototype.provenance.commit,
  evidenceStatus: 'expected_only_actual_query_not_run',
  originals: {},
};

const sides = {};
for (const side of ['front', 'back']) {
  const original = originals[side];
  sides[side] = {
    file: original.file,
    headers: side === 'front' ? frontHeaders : backHeaders,
    rows: side === 'front' ? data.frontRows : data.backRows,
    dateColumn: original.dateColumn,
  };
}
const rowsFile = path.join(qaDir, 'workbook-rows.json');
await fs.writeFile(rowsFile, `${JSON.stringify(sides)}\n`);
// Keep the reviewed container (styles/table/rels); rewrite only sheet data.
execFileSync('python3', [
  '-I',
  path.join(here, 'write-workbooks.py'),
  templateDir,
  rowsFile,
  outputDir,
]);
for (const side of ['front', 'back']) {
  const original = originals[side];
  const rows = sides[side].rows;
  const dateIndex = side === 'front' ? 12 : 6;
  const bytes = await fs.readFile(path.join(outputDir, original.file));
  manifest.originals[side] = {
    ...original,
    sha256: sha256(bytes),
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    firstDataRow: 2,
    lastDataRow: 94,
    personRows: 93,
    identityColumns: ['A', 'B'],
    dateEncoding: 'Excel numeric date, displayed in UTC',
    presentEvaluations: rows.filter((row) => row[dateIndex] !== null).length,
  };
}

await writeJson('selection-standard.json', data.standard);
await writeJson('roster.json', data.roster);
await writeJson('prototype-judgments.json', data.prototype);
await writeJson('mapping.json', data.mapping);
await writeJson('source-rows.json', data.sourceRows);
await writeJson('manual-comparability-marks.json', data.manualComparability);
manifest.inputFacts = {
  file: 'manual-comparability-marks.json',
  nature: 'demo_human_mark',
  records: data.manualComparability.marks.length,
  sha256: sha256(
    await fs.readFile(path.join(outputDir, 'manual-comparability-marks.json')),
  ),
};
await writeJson('seed-input.json', createSeedInput(data));
await writeJson(
  'expected-cases.json',
  data.cases.map(({ id, person, outcome }) => ({
    caseId: id,
    personId: person.id,
    expectedOutcome: outcome,
  })),
);
await writeJson('expected-results.json', data.expected);
await writeJson('cohort-scenarios.json', data.cohortScenarios);
await writeJson('manifest.json', manifest);
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const csv = [
  [
    '案例ID',
    '人员ID',
    '学员（演示）',
    '前段原档位',
    '后段原档位',
    '预期类别（非查询结果）',
    '档差',
    '计入不一致',
    '计入可对照样本',
    '前段评价人ID',
    '同队ID',
    '前段行',
    '后段行',
  ],
  ...data.cases.map((unit) => [
    unit.id,
    unit.person.id,
    unit.person.name,
    unit.front.state === 'present' ? unit.front.judgment.grade : null,
    unit.back.state === 'present' ? unit.back.judgment.grade : null,
    unit.outcome.state,
    'bands' in unit.outcome ? unit.outcome.bands : null,
    ['front_higher', 'front_lower'].includes(unit.outcome.state) ? '是' : '否',
    ['missing', 'not_comparable'].includes(unit.outcome.state) ? '否' : '是',
    unit.front.state === 'present' ? unit.front.judgment.evaluator.id : null,
    unit.work.kind === 'team' ? unit.work.teamId : null,
    data.sourceRows.find((entry) => entry.personId === unit.person.id).front
      .source.location.cell,
    data.sourceRows.find((entry) => entry.personId === unit.person.id).back
      .source.location.cell,
  ]),
]
  .map((row) => row.map(csvCell).join(','))
  .join('\n');
await fs.writeFile(path.join(outputDir, 'expected-cases.csv'), `${csv}\n`);
console.log(
  JSON.stringify({
    outputDir,
    originals: manifest.originals,
    status: manifest.evidenceStatus,
  }),
);
