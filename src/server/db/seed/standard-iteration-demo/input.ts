import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  comparisonActorSchema,
  comparisonCaseSchema,
  comparisonMappingSchema,
  comparisonJudgmentSchema,
} from '../../../../contracts/judgment-comparison';
import { selectionStandardContentSchema } from '../../../../contracts/selection-standard';

const exec = promisify(execFile);
export const FACT_SOURCE_COMMIT = '6dff525b42f812423d981d12fd40aff8999cf00f';
export const FACT_DIRECTORY = 'tests/fixtures/bow-923';
export const FACT_FILES = [
  'seed-input.json',
  'mapping.json',
  'selection-standard.json',
  'manual-comparability-marks.json',
  'source-rows.json',
  'manifest.json',
  '作品评审表.xlsx',
  '结营评审表.xlsx',
] as const;
export type FactFiles = Record<(typeof FACT_FILES)[number], Uint8Array>;
const id = z.string().min(1).regex(/\S/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const sideNames = ['front', 'back'] as const;
import {
  validateCanonicalComparisonImport,
  type CanonicalComparisonStage,
} from '../../../modules/evaluation-system/judgment-comparison/canonical-input';
const rawRowSchema = z.strictObject({
  personId: id,
  row: z.number().int().positive(),
  source: z.strictObject({
    fragmentId: id,
    originalVersionId: id,
    location: z.strictObject({
      kind: z.literal('spreadsheet'),
      sheet: id,
      cell: id,
    }),
    excerpt: id,
    sourceType: z.literal('spreadsheet'),
    sourceCategory: z.literal('original'),
    demo: z.literal(true),
  }),
});
const rawStageSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('missing'), reason: id }),
  z.strictObject({
    state: z.literal('present'),
    judgment: z.strictObject({
      ...comparisonJudgmentSchema.shape,
      row: rawRowSchema,
    }),
  }),
]);
const fields = comparisonCaseSchema.shape;
const caseSchema = z.strictObject({
  id: fields.id,
  batchId: fields.batchId,
  person: fields.person,
  judgment: fields.judgment,
  cohort: fields.cohort,
  selectionStandardVersionId: fields.selectionStandardVersionId,
  mappingVersionId: fields.mappingVersionId,
  frontNodeId: fields.frontNodeId,
  backNodeId: fields.backNodeId,
  work: fields.work,
  front: rawStageSchema,
  back: rawStageSchema,
});
const markSchema = z.strictObject({
  id,
  nature: z.literal('demo_human_mark'),
  caseId: id,
  batchId: id,
  personId: id,
  frontNodeId: id,
  backNodeId: id,
  reason: id,
  markedBy: comparisonActorSchema,
  markedAt: z.iso.datetime(),
});
const seedSchema = z.strictObject({
  fixtureVersion: z.literal('bow-923-v2'),
  demo: z.literal(true),
  contractSha: sha,
  notice: id,
  batch: z.strictObject({
    id,
    name: id,
    cohort: fields.cohort,
    selectionStandardVersionId: fields.selectionStandardVersionId,
    mappingVersionId: fields.mappingVersionId,
  }),
  selectionReviews: z.array(
    z.strictObject({
      personId: id,
      originalGrades: z.array(
        z.strictObject({ reviewPointId: id, grade: id.nullable() }),
      ),
    }),
  ),
  manualComparabilityMarks: z.array(markSchema),
  cases: z.array(caseSchema).min(1),
});
const rowsSchema = z.array(
  z.strictObject({
    personId: id,
    front: rawRowSchema,
    back: rawRowSchema,
  }),
);
const marksSchema = z.strictObject({
  fixtureVersion: z.literal('bow-923-v2'),
  demo: z.literal(true),
  notice: id,
  scenarioProvenance: z.strictObject({ commit: sha, path: id, meaning: id }),
  actorAuthority: z.strictObject({
    person: comparisonActorSchema,
    role: z.literal('hrbp'),
    provenance: z.strictObject({
      commit: sha,
      path: id,
      blob: sha,
      roleKey: z.literal('ROLES.hrbp'),
    }),
  }),
  marks: z.array(markSchema),
});
const originalSchema = z.strictObject({
  file: z.enum(['作品评审表.xlsx', '结营评审表.xlsx']),
  originalVersionId: id,
  sheet: id,
  lastColumn: z.enum(['P', 'J']),
  excerptColumn: z.enum(['P', 'J']),
  dateColumn: z.enum(['M', 'G']),
  sha256: hash,
  contentType: z.literal(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ),
  firstDataRow: z.literal(2),
  lastDataRow: z.number().int().positive(),
  personRows: z.number().int().positive(),
  identityColumns: z.tuple([z.literal('A'), z.literal('B')]),
  dateEncoding: z.literal('Excel numeric date, displayed in UTC'),
  presentEvaluations: z.number().int().nonnegative(),
});
const manifestSchema = z.strictObject({
  fixtureVersion: z.literal('bow-923-v2'),
  demo: z.literal(true),
  notice: id,
  contractSha: sha,
  rosterCommit: sha,
  evidenceStatus: z.literal('expected_only_actual_query_not_run'),
  originals: z.strictObject({ front: originalSchema, back: originalSchema }),
  inputFacts: z.strictObject({
    file: z.literal('manual-comparability-marks.json'),
    nature: z.literal('demo_human_mark'),
    records: z.number().int().nonnegative(),
    sha256: hash,
  }),
});
const workbookSchema = z.strictObject({
  sheet: id,
  cells: z.record(
    z.string().regex(/^[A-Z]+[1-9]\d*$/),
    z.strictObject({ type: z.enum(['str', 'n', '']), value: z.string() }),
  ),
});
function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}
function same(a: unknown, b: unknown) {
  const canonical = (v: unknown): string =>
    Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : v && typeof v === 'object'
        ? `{${Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => JSON.stringify(k) + ':' + canonical(x))
            .join(',')}}`
        : JSON.stringify(v);
  return canonical(a) === canonical(b);
}
function requireFact(condition: unknown, reason: string): asserts condition {
  if (!condition)
    throw new Error(`Invalid standard iteration facts: ${reason}`);
}
function unique<T>(rows: T[], key: (v: T) => string, name: string) {
  const map = new Map(rows.map((row) => [key(row), row]));
  requireFact(map.size === rows.length, `duplicate ${name}`);
  return map;
}

// Restricted to the two pinned, digest-checked synthetic OOXML files. This is
// not a general upload parser. Python3 stdlib already validates these fixtures
// in CI; no third-party package, formula evaluation, external link or file write.
const WORKBOOK_READER = String.raw`
import io,json,sys,zipfile,xml.etree.ElementTree as E
b=sys.stdin.buffer.read(2000001)
if len(b)>2000000: raise ValueError('size')
with zipfile.ZipFile(io.BytesIO(b)) as z:
 infos=z.infolist(); names=[x.filename for x in infos]
 if len(names)>20 or len(set(names))!=len(names) or sum(x.file_size for x in infos)>4000000: raise ValueError('archive')
 for x in infos:
  if x.flag_bits&1 or x.file_size>2000000 or '..' in x.filename.split('/') or x.filename.startswith('/'): raise ValueError('member')
 def xml(name):
  raw=z.read(name)
  if b'<!DOCTYPE' in raw or b'<!ENTITY' in raw: raise ValueError('entity')
  return E.fromstring(raw)
 ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 book=xml('xl/workbook.xml'); sheets=book.findall('m:sheets/m:sheet',ns)
 if len(sheets)!=1 or book.find('m:workbookPr',ns) is not None: raise ValueError('workbook')
 rels=xml('xl/_rels/workbook.xml.rels')
 rid=sheets[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
 target=[r for r in rels if r.get('Id')==rid]
 if len(target)!=1 or target[0].get('Target')!='/xl/worksheets/sheet1.xml' or any(r.get('TargetMode')=='External' for r in rels): raise ValueError('relationships')
 root=xml('xl/worksheets/sheet1.xml'); cells={}
 for row in root.findall('m:sheetData/m:row',ns):
  for c in row:
   addr=c.get('r'); typ=c.get('t',''); children=list(c)
   if addr in cells or typ not in ('str','n','') or any(x.tag!='{'+ns['m']+'}v' for x in children) or len(children)>1: raise ValueError('cell')
   val=children[0].text or '' if children else ''
   cells[addr]={'type':typ,'value':val}
 print(json.dumps({'sheet':sheets[0].get('name'),'cells':cells},ensure_ascii=False))
`;
async function workbook(bytes: Uint8Array) {
  // execFile has no stdin option; use the bounded process stream explicitly.
  const { spawn } = await import('node:child_process');
  return new Promise<z.infer<typeof workbookSchema>>((resolve, reject) => {
    const child = spawn('python3', ['-I', '-c', WORKBOOK_READER], {
      env: {
        NODE_ENV: 'test',
        PATH: process.env.PATH,
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let invalid = false;
    const timer = setTimeout(() => {
      invalid = true;
      child.kill();
    }, 10000);
    child.stderr.resume();
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 4_000_000) {
        invalid = true;
        child.kill();
      } else chunks.push(chunk);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Synthetic workbook reader unavailable'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        requireFact(!invalid && code === 0, 'workbook decode');
        resolve(
          workbookSchema.parse(
            JSON.parse(Buffer.concat(chunks).toString('utf8')),
          ),
        );
      } catch {
        reject(new Error('Invalid standard iteration facts: workbook decode'));
      }
    });
    child.stdin.on('error', () => {
      invalid = true;
    });
    child.stdin.end(bytes);
  });
}

/** Read only fixed input facts, never scene, expected outputs or the working tree. */
export async function readStandardIterationFactFiles(
  cwd: string,
): Promise<FactFiles> {
  const entries = await Promise.all(
    FACT_FILES.map(async (name) => {
      const { stdout } = await exec(
        'git',
        ['show', `${FACT_SOURCE_COMMIT}:${FACT_DIRECTORY}/${name}`],
        { cwd, encoding: 'buffer', maxBuffer: 2_000_000, timeout: 10000 },
      );
      return [name, new Uint8Array(stdout)] as const;
    }),
  );
  return Object.fromEntries(entries) as FactFiles;
}

export async function prepareStandardIterationDemo(files: FactFiles) {
  requireFact(
    Object.keys(files).length === FACT_FILES.length &&
      FACT_FILES.every(
        (name) =>
          files[name] instanceof Uint8Array && files[name].length <= 2_000_000,
      ),
    'file whitelist or size',
  );
  const json = (name: keyof FactFiles): unknown =>
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(files[name]));
  const read = <S extends z.ZodType>(
    name: keyof FactFiles,
    schema: S,
  ): z.output<S> => {
    const raw = json(name),
      parsed = schema.parse(raw);
    requireFact(same(raw, parsed), 'input normalization');
    return parsed;
  };
  const seed = read('seed-input.json', seedSchema);
  const mapping = read('mapping.json', comparisonMappingSchema);
  const selectionStandard = read(
    'selection-standard.json',
    selectionStandardContentSchema,
  );
  const manual = read('manual-comparability-marks.json', marksSchema);
  const rows = read('source-rows.json', rowsSchema);
  const manifest = read('manifest.json', manifestSchema);
  const inputFileHashes = Object.fromEntries(
    FACT_FILES.map((name) => [name, digest(files[name])]),
  );
  requireFact(
    seed.contractSha === manifest.contractSha &&
      seed.batch.mappingVersionId === mapping.versionId,
    'contract/mapping version',
  );
  requireFact(
    same(seed.manualComparabilityMarks, manual.marks) &&
      manual.marks.length === manifest.inputFacts.records &&
      inputFileHashes[manifest.inputFacts.file] === manifest.inputFacts.sha256,
    'independent manual marks',
  );
  requireFact(
    same(mapping.confirmedBy, manual.actorAuthority.person),
    'demo HR mapping signature',
  );
  unique(seed.cases, (c) => c.id, 'case');
  const byPerson = unique(seed.cases, (c) => c.person.id, 'fixture person row');
  const byRowPerson = unique(rows, (r) => r.personId, 'source person');
  const reviews = unique(
    seed.selectionReviews,
    (r) => r.personId,
    'selection review',
  );
  requireFact(
    rows.length === seed.cases.length && reviews.size === seed.cases.length,
    'complete input rows',
  );
  const points = selectionStandard.reviewPoints.map((p) => p.id);
  requireFact(points.length === 3, 'fixed workbook review columns');
  const people = new Map<string, string>();
  const remember = (actor: z.infer<typeof comparisonActorSchema>) => {
    requireFact(
      actor.name.endsWith('（演示）') &&
        (!people.has(actor.id) || people.get(actor.id) === actor.name),
      'demo directory identity',
    );
    people.set(actor.id, actor.name);
  };
  remember(mapping.confirmedBy);
  for (const c of seed.cases) remember(c.person);
  const originals = [] as Array<{
    id: string;
    title: string;
    kind: 'original';
    displayNotice: string;
  }>;
  const originalVersions = [] as Array<{
    id: string;
    originalId: string;
    version: number;
    contentDigest: string;
    sourceCommit: string;
    sourceBlob: string;
    sourcePath: string;
  }>;
  const fragments = [] as Array<{
    id: string;
    originalVersionId: string;
    location: { kind: 'spreadsheet'; sheet: string; cell: string };
    excerpt: string;
  }>;
  const refs = new Map<
    string,
    {
      fragmentId: string;
      originalVersionId: string;
      rowPersonId: string;
      row: number;
    }
  >();
  const fragmentIds = new Set<string>();
  requireFact(
    manifest.originals.front.originalVersionId !==
      manifest.originals.back.originalVersionId,
    'independent originals',
  );
  for (const side of sideNames) {
    const descriptor = manifest.originals[side];
    requireFact(
      descriptor.file ===
        (side === 'front' ? '作品评审表.xlsx' : '结营评审表.xlsx') &&
        descriptor.lastColumn === (side === 'front' ? 'P' : 'J') &&
        descriptor.excerptColumn === descriptor.lastColumn &&
        descriptor.dateColumn === (side === 'front' ? 'M' : 'G'),
      'workbook layout',
    );
    requireFact(
      inputFileHashes[descriptor.file] === descriptor.sha256,
      'original byte digest',
    );
    requireFact(
      descriptor.personRows === seed.cases.length &&
        descriptor.lastDataRow ===
          descriptor.firstDataRow + descriptor.personRows - 1,
      'manifest row count',
    );
    const book = await workbook(files[descriptor.file]);
    requireFact(book.sheet === descriptor.sheet, 'physical sheet');
    const columnCount = side === 'front' ? 16 : 10;
    requireFact(
      Object.keys(book.cells).length ===
        (descriptor.personRows + 1) * columnCount,
      'workbook rectangle',
    );
    const cell = (column: string, row: number) => {
      const value = book.cells[`${column}${row}`];
      requireFact(value, 'missing cell');
      return value;
    };
    requireFact(
      cell('A', 1).value === '人员ID' && cell('B', 1).value === '学员（演示）',
      'identity headers',
    );
    if (side === 'front')
      selectionStandard.reviewPoints.forEach((point, index) =>
        requireFact(
          cell(['G', 'H', 'I'][index], 1).value === `${point.title}（原档位）`,
          'review point header',
        ),
      );
    const originalId = `bow-923-original-${side}`;
    originals.push({
      id: originalId,
      title: descriptor.file,
      kind: 'original',
      displayNotice: manifest.notice,
    });
    originalVersions.push({
      id: descriptor.originalVersionId,
      originalId,
      version: 1,
      contentDigest: descriptor.sha256,
      sourceCommit: FACT_SOURCE_COMMIT,
      sourceBlob: createHash('sha1')
        .update(`blob ${files[descriptor.file].length}\0`)
        .update(files[descriptor.file])
        .digest('hex'),
      sourcePath: `${FACT_DIRECTORY}/${descriptor.file}`,
    });
    let present = 0;
    const seenRows = new Set<number>();
    for (const c of seed.cases) {
      requireFact(
        c.batchId === seed.batch.id &&
          same(c.cohort, seed.batch.cohort) &&
          c.selectionStandardVersionId ===
            seed.batch.selectionStandardVersionId &&
          c.mappingVersionId === mapping.versionId &&
          c.frontNodeId !== c.backNodeId,
        'case batch/cohort/version/node',
      );
      const row = byRowPerson.get(c.person.id)?.[side];
      requireFact(row && row.personId === c.person.id, 'source row identity');
      const source = row.source;
      requireFact(
        source.location.kind === 'spreadsheet' &&
          source.location.sheet === descriptor.sheet &&
          source.location.cell ===
            `A${row.row}:${descriptor.lastColumn}${row.row}` &&
          source.originalVersionId === descriptor.originalVersionId &&
          source.demo === true,
        'source locator',
      );
      requireFact(
        row.row >= descriptor.firstDataRow &&
          row.row <= descriptor.lastDataRow &&
          !seenRows.has(row.row),
        'physical row uniqueness',
      );
      seenRows.add(row.row);
      requireFact(
        cell('A', row.row).value === c.person.id &&
          cell('B', row.row).value === c.person.name &&
          cell('C', row.row).value === c.cohort.name,
        'workbook person/cohort',
      );
      requireFact(
        cell(descriptor.excerptColumn, row.row).value === source.excerpt,
        'actual excerpt',
      );
      requireFact(!fragmentIds.has(source.fragmentId), 'duplicate fragment');
      fragmentIds.add(source.fragmentId);
      fragments.push({
        id: source.fragmentId,
        originalVersionId: source.originalVersionId,
        location: source.location,
        excerpt: source.excerpt,
      });
      refs.set(`${c.id}:${side}`, {
        fragmentId: source.fragmentId,
        originalVersionId: source.originalVersionId,
        rowPersonId: c.person.id,
        row: row.row,
      });
      const stage = c[side];
      if (side === 'front') {
        requireFact(
          cell('D', row.row).value === c.work.workId &&
            cell('E', row.row).value ===
              (c.work.kind === 'team' ? '组队作品' : '个人作品') &&
            (c.work.kind === 'team'
              ? cell('F', row.row).value.length > 0
              : cell('F', row.row).value === ''),
          'work/team row',
        );
        requireFact(
          cell('N', row.row).value === seed.batch.selectionStandardVersionId,
          'selection standard reference',
        );
        const review = reviews.get(c.person.id);
        requireFact(review, 'selection review');
        const grades = unique(
          review.originalGrades,
          (g) => g.reviewPointId,
          'review point',
        );
        requireFact(
          grades.size === points.length && points.every((p) => grades.has(p)),
          'review point set',
        );
        points.forEach((p, index) =>
          requireFact(
            cell(['G', 'H', 'I'][index], row.row).value ===
              (grades.get(p)!.grade ?? ''),
            'original review-point grade',
          ),
        );
        requireFact(
          review.originalGrades.every((g) =>
            stage.state === 'missing'
              ? g.grade === null
              : g.grade !== null &&
                mapping.rows.some((r) => r.frontGrade === g.grade),
          ),
          'review point grade state',
        );
      } else
        requireFact(
          cell('H', row.row).value === mapping.backScaleId,
          'back original scale',
        );
      const [gradeColumn, evaluatorColumn, nameColumn, stateColumn] =
        side === 'front' ? ['J', 'K', 'L', 'O'] : ['D', 'E', 'F', 'I'];
      if (stage.state === 'missing') {
        requireFact(
          [
            gradeColumn,
            evaluatorColumn,
            nameColumn,
            descriptor.dateColumn,
          ].every((col) => cell(col, row.row).value === '') &&
            cell(stateColumn, row.row).value === '缺段',
          'missing row must not fabricate judgment',
        );
      } else {
        present++;
        const j = stage.judgment;
        remember(j.evaluator);
        requireFact(
          j.nodeId === c[side === 'front' ? 'frontNodeId' : 'backNodeId'] &&
            j.cohortId === c.cohort.id &&
            same(j.row, row),
          'judgment identity/source',
        );
        requireFact(
          j.scaleId ===
            (side === 'front' ? mapping.frontScaleId : mapping.backScaleId) &&
            mapping.rows.some(
              (m) =>
                (side === 'front' ? m.frontGrade : m.backGrade) === j.grade,
            ),
          'original scale/grade',
        );
        requireFact(
          side !== 'front' ||
            j.standardVersionId === seed.batch.selectionStandardVersionId,
          'front standard',
        );
        requireFact(
          cell(gradeColumn, row.row).value === j.grade &&
            cell(evaluatorColumn, row.row).value === j.evaluator.id &&
            cell(nameColumn, row.row).value === j.evaluator.name &&
            cell(stateColumn, row.row).value === '已确认（演示）',
          'workbook judgment',
        );
        const date = cell(descriptor.dateColumn, row.row);
        const serial = Number(date.value);
        requireFact(
          date.type === 'n' &&
            Number.isFinite(serial) &&
            Math.abs((serial - 25569) * 86400000 - Date.parse(j.evaluatedAt)) <
              1,
          'numeric UTC date',
        );
      }
    }
    requireFact(
      present === descriptor.presentEvaluations,
      'present input completeness',
    );
  }
  const cases = seed.cases.map((c) => {
    const stage = (side: 'front' | 'back'): CanonicalComparisonStage => {
      const s = c[side],
        source = refs.get(`${c.id}:${side}`)!;
      return s.state === 'missing'
        ? { state: 'missing', reason: s.reason, source }
        : {
            state: 'present',
            source,
            judgmentId: s.judgment.judgmentId,
            sourceStandardReference: s.judgment.standardVersionId,
            scaleId: s.judgment.scaleId,
            grade: s.judgment.grade,
            evaluatorId: s.judgment.evaluator.id,
            evaluatedAt: s.judgment.evaluatedAt,
            confirmation: s.judgment.confirmation,
          };
    };
    return {
      id: c.id,
      personId: c.person.id,
      judgment: c.judgment,
      frontNodeId: c.frontNodeId,
      backNodeId: c.backNodeId,
      work: c.work,
      front: stage('front'),
      back: stage('back'),
    };
  });
  unique(manual.marks, (m) => m.id, 'manual mark');
  unique(manual.marks, (m) => m.caseId, 'marked case');
  const manualMarks = manual.marks.map((m) => {
    const c = byPerson.get(m.personId);
    requireFact(
      c &&
        c.id === m.caseId &&
        c.batchId === m.batchId &&
        c.frontNodeId === m.frontNodeId &&
        c.backNodeId === m.backNodeId &&
        c.front.state === 'present' &&
        c.back.state === 'present',
      'manual target',
    );
    requireFact(
      same(m.markedBy, manual.actorAuthority.person) &&
        Date.parse(m.markedAt) >=
          Math.max(
            Date.parse(c.front.judgment.evaluatedAt),
            Date.parse(c.back.judgment.evaluatedAt),
          ),
      'manual actor/time',
    );
    return {
      id: m.id,
      caseId: m.caseId,
      batchId: m.batchId,
      personId: m.personId,
      frontNodeId: m.frontNodeId,
      backNodeId: m.backNodeId,
      reason: m.reason,
      markedById: m.markedBy.id,
      markedAt: m.markedAt,
      sourceFileSha256: inputFileHashes['manual-comparability-marks.json'],
      nature: m.nature,
    };
  });
  return {
    canonical: validateCanonicalComparisonImport({
      batch: {
        id: seed.batch.id,
        name: seed.batch.name,
        cohortId: seed.batch.cohort.id,
        mappingVersionId: mapping.versionId,
        sourceCommit: FACT_SOURCE_COMMIT,
        contractSha: seed.contractSha,
        fixtureVersion: seed.fixtureVersion,
        inputFileHashes: Object.fromEntries(
          Object.entries(inputFileHashes).map(([name, hash]) => [
            `${FACT_DIRECTORY}/${name}`,
            hash,
          ]),
        ),
        inputCaseCount: cases.length,
        nature: 'demo_rebuilt' as const,
      },
      mapping: {
        versionId: mapping.versionId,
        frontScaleId: mapping.frontScaleId,
        backScaleId: mapping.backScaleId,
        rows: mapping.rows,
        confirmedById: mapping.confirmedBy.id,
        confirmedAt: mapping.confirmedAt,
        sourceCommit: FACT_SOURCE_COMMIT,
        sourceFileSha256: inputFileHashes['mapping.json'],
        nature: 'demo_human_confirmation' as const,
      },
      cases,
      manualMarks,
    }),
    records: { originals, originalVersions, fragments },
    selectionStandard: {
      versionId: seed.batch.selectionStandardVersionId,
      content: selectionStandard,
    },
    requiredPeople: [...people].map(([id, name]) => ({ id, name })),
    cohort: seed.batch.cohort,
  };
}
export type PreparedStandardIterationDemo = Awaited<
  ReturnType<typeof prepareStandardIterationDemo>
>;
