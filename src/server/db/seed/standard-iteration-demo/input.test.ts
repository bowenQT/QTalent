import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { runStandardIterationImport } from './run';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  FACT_FILES,
  FACT_DIRECTORY,
  FACT_SOURCE_COMMIT,
  readStandardIterationFactFiles,
  prepareStandardIterationDemo,
  type FactFiles,
} from './input';
let baseline: FactFiles;
beforeAll(async () => {
  baseline = await readStandardIterationFactFiles(process.cwd());
});
function files() {
  return Object.fromEntries(
    FACT_FILES.map((name) => [name, Uint8Array.from(baseline[name])]),
  ) as FactFiles;
}
function data<T = Record<string, unknown>>(
  f: FactFiles,
  name: keyof FactFiles,
): T {
  return JSON.parse(Buffer.from(f[name]).toString());
}
function put(f: FactFiles, name: keyof FactFiles, value: unknown) {
  f[name] = Buffer.from(JSON.stringify(value));
}
function seed(f: FactFiles) {
  return data<{
    cases: Array<Record<string, unknown>>;
    manualComparabilityMarks: unknown[];
    selectionReviews: Array<{
      personId: string;
      originalGrades: Array<{ reviewPointId: string; grade: string | null }>;
    }>;
    batch: Record<string, unknown>;
  }>(f, 'seed-input.json');
}
function rehash(f: FactFiles, side: 'front' | 'back') {
  const m = data<{
    originals: Record<
      'front' | 'back',
      { file: keyof FactFiles; sha256: string }
    >;
  }>(f, 'manifest.json');
  m.originals[side].sha256 = createHash('sha256')
    .update(f[m.originals[side].file])
    .digest('hex');
  put(f, 'manifest.json', m);
}
function patchWorkbook(
  f: FactFiles,
  address: string,
  value: string,
  kind = 'str',
  side: 'front' | 'back' = 'front',
) {
  const name = side === 'front' ? '作品评审表.xlsx' : '结营评审表.xlsx';
  f[name] = execFileSync(
    'python3',
    [
      '-I',
      '-c',
      String.raw`
import io,sys,zipfile,xml.etree.ElementTree as E
src=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));out=io.BytesIO()
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
root=E.fromstring(src.read('xl/worksheets/sheet1.xml'))
cell=next(c for c in root.findall('.//m:c',ns) if c.get('r')==sys.argv[1])
for child in list(cell): cell.remove(child)
cell.set('t',sys.argv[3]);E.SubElement(cell,'{'+ns['m']+'}v').text=sys.argv[2]
with zipfile.ZipFile(out,'w') as dst:
 for n in src.namelist(): dst.writestr(n,E.tostring(root,encoding='utf-8') if n=='xl/worksheets/sheet1.xml' else src.read(n))
sys.stdout.buffer.write(out.getvalue())
`,
      address,
      value,
      kind,
    ],
    {
      input: f[name],
      maxBuffer: 2_000_000,
      env: { NODE_ENV: 'test', PATH: process.env.PATH },
    },
  );
  rehash(f, side);
}
describe('BOW-923 fixed input facts and real workbooks', () => {
  it('maps all input cases and both real rows, without computing outcomes or creating directory/grants', async () => {
    const p = await prepareStandardIterationDemo(files());
    expect(p.canonical.batch.sourceCommit).toBe(FACT_SOURCE_COMMIT);
    expect(p.canonical.cases).toHaveLength(93);
    expect(p.records.fragments).toHaveLength(186);
    expect(
      p.canonical.cases.filter((c) => c.front.state === 'present'),
    ).toHaveLength(87);
    expect(
      p.canonical.cases.filter((c) => c.back.state === 'present'),
    ).toHaveLength(86);
    expect(p.canonical.manualMarks).toHaveLength(4);
    expect(p.records.originals).toHaveLength(2);
    expect(
      new Set(p.records.originalVersions.map((v) => v.contentDigest)).size,
    ).toBe(2);
    expect(Object.keys(p.canonical.batch.inputFileHashes).sort()).toEqual(
      FACT_FILES.map((n) => `${FACT_DIRECTORY}/${n}`).sort(),
    );
    const present = p.canonical.cases[0].front;
    expect(present).toMatchObject({
      state: 'present',
      grade: '高分档',
      source: {
        rowPersonId: 'p-x01',
        row: 2,
        fragmentId: 'bow-923-front-row-001',
      },
    });
    const missing = p.canonical.cases.find(
      (c) => c.id === 'bow-923-case-014',
    )!.front;
    expect(missing).toEqual({
      state: 'missing',
      reason: '缺少入营选拔评审记录（演示）',
      source: {
        rowPersonId: 'p-x14',
        row: 15,
        fragmentId: 'bow-923-front-row-014',
        originalVersionId: 'bow-923-xe6-selection-original-v1',
      },
    });
    expect(p.canonical.cases.every((c) => !('outcome' in c))).toBe(true);
    expect(p).not.toHaveProperty('grants');
    expect(p).not.toHaveProperty('head');
    expect(await prepareStandardIterationDemo(files())).toEqual(p);
  });
  it('refuses missing, extra and oversized inputs before launching a workbook reader', async () => {
    const a = files();
    delete (a as Partial<FactFiles>)['mapping.json'];
    await expect(prepareStandardIterationDemo(a)).rejects.toThrow('whitelist');
    const b = files();
    Object.assign(b, { 'expectedAtCreation.json': Buffer.from('{}') });
    await expect(prepareStandardIterationDemo(b)).rejects.toThrow('whitelist');
    const c = files();
    c['seed-input.json'] = new Uint8Array(2_000_001);
    await expect(prepareStandardIterationDemo(c)).rejects.toThrow('size');
  });
  it.each(['outcome', 'expectedAtCreation', 'sample'])(
    'rejects answer field %s rather than using it',
    async (field) => {
      const f = files(),
        s = seed(f);
      s.cases[0][field] = { state: 'consistent' };
      put(f, 'seed-input.json', s);
      await expect(prepareStandardIterationDemo(f)).rejects.toThrow();
    },
  );
  it('rejects a digest mismatch and a malformed archive even when its manifest digest is updated', async () => {
    const f = files();
    f['作品评审表.xlsx'][0] ^= 1;
    await expect(prepareStandardIterationDemo(f)).rejects.toThrow('digest');
    f['作品评审表.xlsx'] = Buffer.from('not an archive');
    rehash(f, 'front');
    await expect(prepareStandardIterationDemo(f)).rejects.toThrow(
      'workbook decode',
    );
  });
  it.each([
    ['A2', 'p-other', 'str', 'workbook person'],
    ['B2', '另一人（演示）', 'str', 'workbook person'],
    ['P2', '不是已登记原文', 'str', 'actual excerpt'],
    ['J2', '刚过线档', 'str', 'workbook judgment'],
    ['K2', 'p-other', 'str', 'workbook judgment'],
    ['M2', '46084', 'n', 'numeric UTC date'],
    ['M2', '46083.04166666667', 'str', 'numeric UTC date'],
    ['G2', '刚过线档', 'str', 'review-point grade'],
    ['D2', 'other-work', 'str', 'work/team'],
    ['J15', '高分档', 'str', 'missing row'],
  ])(
    'verifies actual cell %s even with a matching byte digest',
    async (address, value, kind, reason) => {
      const f = files();
      patchWorkbook(f, address, value, kind);
      await expect(prepareStandardIterationDemo(f)).rejects.toThrow(reason);
    },
  );
  it.each([
    ['front', 'C1', '任意期次说明', 'str', 'workbook header'],
    ['front', 'J1', '任意档位说明', 'str', 'workbook header'],
    ['back', 'H1', '任意量表说明', 'str', 'workbook header'],
    ['front', 'A2', 'p-x01', 'n', 'text cell type'],
    ['back', 'A2', 'p-x01', 'n', 'text cell type'],
    ['front', 'F15', '', 'n', 'text cell type'],
  ] as const)(
    'rejects drift in %s %s header/type even after updating its digest',
    async (side, address, value, kind, reason) => {
      const f = files();
      patchWorkbook(f, address, value, kind, side);
      await expect(prepareStandardIterationDemo(f)).rejects.toThrow(reason);
    },
  );
  it('refuses a cross-person source row and duplicated case identities', async () => {
    const f = files();
    const rows = data<Array<{ personId: string; front: { personId: string } }>>(
      f,
      'source-rows.json',
    );
    rows[0].front.personId = 'p-x02';
    put(f, 'source-rows.json', rows);
    await expect(prepareStandardIterationDemo(f)).rejects.toThrow(
      'row identity',
    );
    const g = files(),
      s = seed(g);
    s.cases[1].id = s.cases[0].id;
    put(g, 'seed-input.json', s);
    await expect(prepareStandardIterationDemo(g)).rejects.toThrow(
      'duplicate case',
    );
  });
  it('keeps independent human marks and rejects retargeting, missing facts and silent trimming', async () => {
    const f = files(),
      s = seed(f);
    s.manualComparabilityMarks = [];
    put(f, 'seed-input.json', s);
    await expect(prepareStandardIterationDemo(f)).rejects.toThrow(
      'independent manual marks',
    );
    const g = files(),
      m = data<{ marks: Array<{ personId: string }> }>(
        g,
        'manual-comparability-marks.json',
      );
    m.marks[0].personId = 'p-x01';
    put(g, 'manual-comparability-marks.json', m);
    await expect(prepareStandardIterationDemo(g)).rejects.toThrow(
      'independent manual marks',
    );
    const h = files(),
      t = seed(h);
    t.cases[0].id = ' ' + t.cases[0].id;
    put(h, 'seed-input.json', t);
    await expect(prepareStandardIterationDemo(h)).rejects.toThrow(
      'normalization',
    );
  });
  it('rejects wrong physical references and manifest completeness instead of shortening the import', async () => {
    const f = files(),
      m = data<{ originals: { front: { personRows: number } } }>(
        f,
        'manifest.json',
      );
    m.originals.front.personRows--;
    put(f, 'manifest.json', m);
    await expect(prepareStandardIterationDemo(f)).rejects.toThrow('row count');
    const g = files(),
      s = seed(g);
    s.cases.pop();
    put(g, 'seed-input.json', s);
    await expect(prepareStandardIterationDemo(g)).rejects.toThrow(
      'complete input rows',
    );
  });
});

describe('923 explicit operator command', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([[], ['--dry-run'], ['--apply', '--force']])(
    'refuses ambiguous invocation %j before opening a connection',
    async (...args) => {
      await expect(runStandardIterationImport(args)).rejects.toThrow(
        'Explicit --apply required',
      );
    },
  );
  it('refuses production before opening a connection', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@127.0.0.1/unused_test');
    vi.stubEnv('BETTER_AUTH_SECRET', 'synthetic-test-only-secret-00000000');
    vi.stubEnv('BETTER_AUTH_URL', 'http://localhost:3000');
    vi.stubEnv('ACCESS_ENFORCED', 'true');
    vi.stubEnv('ACCESS_ISSUER', 'https://synthetic-test.cloudflareaccess.com');
    vi.stubEnv('ACCESS_AUDIENCE', 'synthetic-test');
    await expect(runStandardIterationImport(['--apply'])).rejects.toThrow(
      'Demo import is forbidden in production',
    );
  });
});
