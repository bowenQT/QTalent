import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';
import {
  BACK_DATE,
  CONTRACT_SHA,
  FRONT_DATE,
  backHeaders,
  buildScene,
  frontHeaders,
  originals,
} from './scene.mjs';

const [outputDir, qaDir] = process.argv.slice(2);
assert(
  outputDir && qaDir,
  'usage: node build-workbooks.mjs <new-output-dir> <qa-dir>',
);
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(qaDir, { recursive: true });
const data = await buildScene();
const writeJson = (name, value) =>
  fs.writeFile(
    path.join(outputDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
  );
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = {
  fixtureVersion: 'bow-923-v1',
  demo: true,
  notice:
    '两份表均为化名重建的演示原表，不是历史原件；既有 prototype_snapshot 未修改。',
  contractSha: CONTRACT_SHA,
  rosterCommit: data.roster.provenance.commit,
  evidenceStatus: 'expected_only_actual_query_not_run',
  originals: {},
};

for (const side of ['front', 'back']) {
  const original = originals[side];
  const headers = side === 'front' ? frontHeaders : backHeaders;
  const rows = side === 'front' ? data.frontRows : data.backRows;
  const dateIndex = side === 'front' ? 12 : 6;
  const wb = Workbook.create();
  const sheet = wb.worksheets.add(original.sheet);
  // Use Excel serials plus an explicit UTC display format. The SDK exports Date
  // objects as ISO t="d" cells; numeric dates also support older XLSX readers.
  const typedRows = rows.map((row) =>
    row.map((value, index) =>
      index === dateIndex && value !== null
        ? Date.parse(value) / 86_400_000 + 25_569
        : value,
    ),
  );
  sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length).values = [
    headers,
    ...typedRows,
  ];
  const all = sheet.getRange(`A1:${original.lastColumn}94`);
  all.format.font = { name: 'Arial', size: 11, color: '#24364B' };
  all.format.verticalAlignment = 'center';
  all.format.columnWidth = 21;
  all.format.rowHeight = 48;
  all.format.wrapText = true;
  const header = sheet.getRange(`A1:${original.lastColumn}1`);
  header.format = {
    fill: '#263D55',
    font: { name: 'Arial', size: 11, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    verticalAlignment: 'center',
    wrapText: true,
  };
  header.format.rowHeight = 54;
  header.format.borders = { bottom: { style: 'medium', color: '#A1AFBC' } };
  sheet.getRange('A2:A94').format.font = {
    name: 'Arial',
    size: 11,
    color: '#66778A',
  };
  sheet.getRange('A1:A94').format.columnWidth = 13;
  sheet.getRange('B1:B94').format.columnWidth = 20;
  sheet.getRange('C1:C94').format.columnWidth = 25;
  const comments = `${original.excerptColumn}1:${original.excerptColumn}94`;
  sheet.getRange(comments).format.columnWidth = 60;
  sheet
    .getRange(`${original.dateColumn}2:${original.dateColumn}94`)
    .setNumberFormat('yyyy-mm-dd hh:mm');
  sheet.getRange(
    `${original.dateColumn}1:${original.dateColumn}94`,
  ).format.columnWidth = 22;
  sheet.getRange(
    `${original.dateColumn}2:${original.dateColumn}94`,
  ).format.horizontalAlignment = 'center';
  if (side === 'front') {
    sheet.getRange('D1:D94').format.columnWidth = 30;
    sheet.getRange('G1:I94').format.columnWidth = 26;
    sheet.getRange('K1:K94').format.columnWidth = 14;
    sheet.getRange('O1:O94').format.columnWidth = 18;
  } else {
    sheet.getRange('E1:E94').format.columnWidth = 14;
    sheet.getRange('H1:H94').format.columnWidth = 33;
    sheet.getRange('I1:I94').format.columnWidth = 18;
  }
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(2);
  sheet.showGridLines = false;
  sheet.tabColor = '#526D82';
  const table = sheet.tables.add(
    `A1:${original.lastColumn}94`,
    true,
    side === 'front' ? 'DemoSelectionOriginal' : 'DemoGraduationOriginal',
  );
  table.showFilterButton = true;
  table.showTotals = false;
  wb.recalculate();
  const overview = await wb.inspect({
    kind: 'table',
    range: `'${original.sheet}'!A1:${original.lastColumn}8`,
    include: 'values,formulas',
    tableMaxRows: 8,
    tableMaxCols: headers.length,
    maxChars: 10000,
  });
  await fs.writeFile(
    path.join(qaDir, `${side}-inspect.ndjson`),
    overview.ndjson,
  );
  const errors = await wb.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#N/A|#NAME\\?|#NUM!|#SPILL!',
    options: { useRegex: true, maxResults: 100 },
    maxChars: 2500,
  });
  await fs.writeFile(
    path.join(qaDir, `${side}-error-scan.ndjson`),
    errors.ndjson,
  );
  const previewRanges =
    side === 'front'
      ? ['A1:F8', 'G1:L8', 'M1:P8', 'A13:F17', 'G13:P17', 'A89:F94']
      : ['A1:F8', 'G1:J8', 'A13:F17', 'G13:J17', 'A89:F94'];
  for (const [index, range] of previewRanges.entries()) {
    const preview = await wb.render({
      sheetName: original.sheet,
      range,
      scale: 1,
      format: 'png',
    });
    await fs.writeFile(
      path.join(qaDir, `${side}-${index + 1}.png`),
      new Uint8Array(await preview.arrayBuffer()),
    );
  }
  const output = await SpreadsheetFile.exportXlsx(wb);
  const filePath = path.join(outputDir, original.file);
  await output.save(filePath);
  await fs.rename(
    `${filePath}.inspect.ndjson`,
    path.join(qaDir, `${side}-export-inspect.ndjson`),
  );
  const bytes = await fs.readFile(filePath);
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
    presentEvaluations: side === 'front' ? 87 : 86,
  };
}

await writeJson('selection-standard.json', data.standard);
await writeJson('roster.json', data.roster);
await writeJson('mapping.json', data.mapping);
await writeJson('source-rows.json', data.sourceRows);
await writeJson('seed-input.json', {
  fixtureVersion: 'bow-923-v1',
  demo: true,
  contractSha: CONTRACT_SHA,
  notice:
    '待独立演示导入器消费的输入，不是数据库已导入的证据；不含对照计算结果。',
  batch: data.expected.batch,
  selectionReviews: data.frontRows.map((row) => ({
    personId: row[0],
    originalGrades: data.standard.reviewPoints.map((point, index) => ({
      reviewPointId: point.id,
      grade: row[index + 6],
    })),
  })),
  cases: data.cases.map((unit) =>
    Object.fromEntries(
      Object.entries(unit).filter(([key]) => key !== 'outcome'),
    ),
  ),
});
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
assert.equal(FRONT_DATE, '2026-03-02T01:00:00.000Z');
assert.equal(BACK_DATE, '2026-06-12T06:00:00.000Z');
console.log(
  JSON.stringify({
    outputDir,
    originals: manifest.originals,
    status: manifest.evidenceStatus,
  }),
);
