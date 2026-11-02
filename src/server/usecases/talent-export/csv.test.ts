import { expect, it } from 'vitest';
import { csvCell, exportTimestamp, buildExportCsv } from './csv';
import { projectTalentExport } from './policy';
import { snapshot } from './test-helpers';
it.each([
  '=1+1',
  '+SUM(1,2)',
  '-1+2',
  '@SUM(1)',
  '  =HYPERLINK("synthetic")',
  '\t=1',
  '\n=2',
  '\ufeff=3',
  '\u200b@SUM(1)',
])('neutralizes formula input %j', (text) => {
  expect(csvCell(text).slice(0, 2)).toBe('"\'');
});
it('quotes separators, quote characters and line breaks without creating extra cells', () => {
  expect(csvCell('演示,"内容"\r\n第二行')).toBe('"演示,""内容""\r\n第二行"');
  expect(csvCell(4)).toBe('"4"');
  expect(csvCell(null)).toBe('""');
});
it('rejects an invalid wall clock instead of guessing an export date', () => {
  expect(() => exportTimestamp(new Date('invalid'))).toThrow();
});
it('emits BOM, scope/basis/exporter/time, every source location and no aggregate talent score', async () => {
  const data = snapshot();
  data.directory.people[0]!.name = '=synthetic formula';
  const file = buildExportCsv(
    await projectTalentExport(data, { scopeId: 'all', range: 'all' }),
    new Date('2026-11-01T12:00:00Z'),
  );
  expect(file.csv.startsWith('\ufeff"导出时间')).toBe(true);
  expect(file.csv).toContain('"\'=synthetic formula"');
  expect(file.csv).toContain('fieldPath');
  expect(file.csv).toContain('行为锚点');
  expect(file.csv).toContain('评价规则版本');
  expect(file.csv).not.toMatch(/总分|排名|百分比|confidence/);
  expect(file.fileName).not.toMatch(/[\r\n/\\:]/);
});
