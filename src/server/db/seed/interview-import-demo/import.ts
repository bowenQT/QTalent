import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../client';
import { insertChecked } from '../../import';
import { people } from '../../../modules/directory';
import {
  evaluationNodes,
  evaluationNodeSubjects,
} from '../../../modules/programs';
import {
  originals,
  originalVersions,
  fragments,
  materialParses,
} from '../../../modules/records';
import {
  interviewImportBatches,
  interviewImportCandidates,
  interviewImportRows,
} from '../../../modules/records/interview-import/schema';
import { jobSnapshots } from '../../../jobs/schema';
import { parseInterviewPdfIsolated } from '../../../usecases/interview-import/pdf-isolation';

const FIXTURE_DIRECTORY = 'tests/fixtures/bow-896';

/**
 * The demo interview import (BOW-906, #248 ruling for /import): the 896 synthetic PDFs,
 * read from the release tree and checked against these digests (fixtures of ef4c37b0),
 * go through the isolated parser into one batch HR confirms row by row on /import.
 *
 * - hr.pdf is left out: its comment carries fictional origin and education labels meant
 *   for a comment filter that does not exist yet.
 * - professional-duplicate.pdf is left out: duplicate detection needs filed imports.
 * - score-missing is the row HR fills in on /import (one dimension left unread);
 *   score-multiple / flat-scores add nothing that row does not already show, and
 *   unknown-template is rejected by the parser.
 * - The rejected / offer candidates have no PDF, so the automatic skip never runs here.
 */
export const INTERVIEW_IMPORT_DEMO = {
  batchId: 'demo-interview-import-1',
  fileName: '面评导出-2026校招（演示）.pdf',
  uploadedByPersonId: 'p-suwan',
  uploadedAt: '2026-10-31T02:00:00.000Z',
  node: {
    id: 'demo-interview-hiring',
    name: '2026 校招面试（演示）',
    kind: 'interview' as const,
    cohortId: null,
  },
  subjectPersonIds: ['p-x08'],
  files: [
    {
      key: 'campus',
      sha256:
        '36af7006cf035f5f86c85814d4247a37de56e2328c3d2e46a52daa1ef1193e2d',
    },
    {
      key: 'professional',
      sha256:
        'd883d08e2ff0563494e46427fe6fc4a84be42f2aa4505aa4be076386bea385fc',
    },
    {
      key: 'score-missing',
      sha256:
        'cba08d955c22c7f68610723689152b2a1305ce4379cf9fc4c92a58c3669b2a1c',
    },
    {
      key: 'unknown-interviewer',
      sha256:
        '4936b677f5def37079a8aa0894fd230a1fa7923dbc5cb7c3b19cf352936f9c51',
    },
  ],
  candidatesSha256:
    '03d5d8c6246a828d2a407a242a80ec3dd28293a43c225c57c2752e236782614e',
  parserVersion: 'bow-900-interview-review-isolated',
  projectionVersion: 'interview-review-lines-v1',
} as const;

export class InterviewImportDemoError extends Error {
  constructor(
    readonly code:
      | 'fixture_missing'
      | 'fixture_digest_mismatch'
      | 'parse_failed'
      | 'directory_missing',
  ) {
    super(code);
    this.name = 'InterviewImportDemoError';
  }
}

const candidatesSchema = z.object({
  demo: z.literal(true),
  rows: z.array(
    z.object({
      candidateId: z.string().min(1),
      name: z.string().regex(/（演示）$/),
      directoryPersonId: z.string().min(1).nullable(),
      status: z.enum(['hired', 'rejected', 'offer_pending', 'offer_declined']),
    }),
  ),
});

const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}

async function readPinned(cwd: string, path: string, digest: string) {
  // Run from the release root: the fixtures ship in the archive, `.git` does not.
  const bytes = await readFile(join(cwd, path)).then(
    (buffer) => new Uint8Array(buffer),
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT')
        throw new InterviewImportDemoError('fixture_missing');
      throw error;
    },
  );
  if (sha256(bytes) !== digest)
    throw new InterviewImportDemoError('fixture_digest_mismatch');
  return bytes;
}

/** Reads and parses outside any transaction; nothing here touches the database. */
export async function prepareInterviewImportDemo(cwd: string) {
  const demo = INTERVIEW_IMPORT_DEMO;
  const candidates = candidatesSchema.parse(
    JSON.parse(
      new TextDecoder().decode(
        await readPinned(
          cwd,
          `${FIXTURE_DIRECTORY}/candidates.json`,
          demo.candidatesSha256,
        ),
      ),
    ),
  );
  const files = [];
  for (const file of demo.files) {
    const bytes = await readPinned(
      cwd,
      `${FIXTURE_DIRECTORY}/interview/${file.key}.pdf`,
      file.sha256,
    );
    const outcome = await parseInterviewPdfIsolated({
      bytes,
      options: { positionKind: 'non_management', allowSyntheticDemo: true },
      budget: {
        maxInputBytes: 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxDurationMs: 15000,
      },
    });
    // A review with an unread item is stored as parsed; HR fills the item on /import.
    if (outcome.status !== 'parsed' || outcome.result.status === 'rejected')
      throw new InterviewImportDemoError('parse_failed');
    files.push({ ...file, result: outcome.result });
  }
  return { candidates: candidates.rows, files };
}
export type PreparedInterviewImportDemo = Awaited<
  ReturnType<typeof prepareInterviewImportDemo>
>;

/** Database rows for the prepared demo; identities are derived from the file key. */
export function interviewImportDemoRecords(
  prepared: PreparedInterviewImportDemo,
) {
  const demo = INTERVIEW_IMPORT_DEMO;
  const records = {
    originals: [] as (typeof originals.$inferInsert)[],
    originalVersions: [] as (typeof originalVersions.$inferInsert)[],
    jobs: [] as (typeof jobSnapshots.$inferInsert)[],
    parses: [] as (typeof materialParses.$inferInsert)[],
    fragments: [] as (typeof fragments.$inferInsert)[],
    rows: [] as (typeof interviewImportRows.$inferInsert)[],
  };
  let ordinal = 0;
  for (const file of prepared.files) {
    const originalId = `demo-interview-pdf-${file.key}`;
    const versionId = `${originalId}-v1`;
    const parseId = `${versionId}-parse-1`;
    const jobId = `demo-interview-parse-${file.key}`;
    const result = file.result;
    records.originals.push({
      id: originalId,
      title: `${file.key}.pdf（演示）`,
      kind: 'original',
    });
    records.originalVersions.push({
      id: versionId,
      originalId,
      version: 1,
      contentDigest: file.sha256,
      sourcePath: `${FIXTURE_DIRECTORY}/interview/${file.key}.pdf`,
    });
    records.jobs.push({
      jobId,
      kind: 'interview_pdf_parse',
      resourceId: versionId,
      inputVersion: file.sha256,
      status: 'completed',
      attempt: 1,
      revision: 1,
      updatedAt: demo.uploadedAt,
    });
    records.parses.push({
      id: parseId,
      originalVersionId: versionId,
      contentDigest: file.sha256,
      parserVersion: demo.parserVersion,
      projectionVersion: demo.projectionVersion,
      resultDigest: sha256(canonical(result)),
      jobId,
      attempt: 1,
    });
    result.reviews.forEach((review, reviewIndex) => {
      const { page, textRange } = review.templateSource;
      const pageText = result.pageTexts.find((p) => p.page === page)?.text;
      const excerpt = pageText?.slice(textRange.start, textRange.end) ?? '';
      if (!excerpt.trim()) throw new InterviewImportDemoError('parse_failed');
      const fragmentId = `${versionId}-review-${reviewIndex}`;
      // The 897 location keeps page and text range only; the box stays parser-internal.
      records.fragments.push({
        id: fragmentId,
        originalVersionId: versionId,
        parseVersionId: parseId,
        sourceCategory: 'historical_evaluation',
        evaluationKind: 'interview',
        demo: true,
        location: { kind: 'pdf', page, textRange },
        excerpt,
      });
      records.rows.push({
        batchId: demo.batchId,
        rowId: `${file.key}-${reviewIndex + 1}`,
        ordinal: ++ordinal,
        materialId: originalId,
        originalVersionId: versionId,
        parseVersionId: parseId,
        fragmentId,
        reviewIndex,
        parsed: result,
      });
    });
  }
  return records;
}

/** Columns the seed owns; HR's revision, confirmation and decision are never compared. */
const ROW_IMMUTABLE = [
  'batchId',
  'rowId',
  'ordinal',
  'materialId',
  'originalVersionId',
  'parseVersionId',
  'fragmentId',
  'reviewIndex',
  'parsed',
];

/** One native transaction. A replay of the same facts inserts nothing and returns
 * `unchanged`; a differing existing fact fails the whole transaction. */
export async function importInterviewImportDemo(db: Database, cwd: string) {
  const prepared = await prepareInterviewImportDemo(cwd);
  const records = interviewImportDemoRecords(prepared);
  const demo = INTERVIEW_IMPORT_DEMO;
  return db.transaction(async (tx) => {
    const needed = [
      demo.uploadedByPersonId,
      ...demo.subjectPersonIds,
      ...prepared.candidates.flatMap((c) =>
        c.directoryPersonId ? [c.directoryPersonId] : [],
      ),
    ];
    const found = await tx
      .select({ id: people.id, demo: people.demo })
      .from(people)
      .where(inArray(people.id, needed));
    if (new Set(needed).size !== found.length || found.some((p) => !p.demo))
      throw new InterviewImportDemoError('directory_missing');
    const inserted = [
      await insertChecked(tx, evaluationNodes, [demo.node]),
      await insertChecked(
        tx,
        evaluationNodeSubjects,
        demo.subjectPersonIds.map((personId) => ({
          evaluationNodeId: demo.node.id,
          personId,
        })),
        ['evaluationNodeId', 'personId'],
      ),
      await insertChecked(tx, originals, records.originals),
      await insertChecked(tx, originalVersions, records.originalVersions),
      await insertChecked(
        tx,
        jobSnapshots,
        records.jobs,
        ['jobId'],
        ['jobId', 'kind', 'resourceId', 'inputVersion', 'status', 'attempt'],
      ),
      await insertChecked(tx, materialParses, records.parses),
      await insertChecked(tx, fragments, records.fragments),
      await insertChecked(
        tx,
        interviewImportBatches,
        [
          {
            id: demo.batchId,
            evaluationNodeId: demo.node.id,
            fileName: demo.fileName,
            pageCount: prepared.files.reduce(
              (sum, file) => sum + file.result.pageTexts.length,
              0,
            ),
            uploadedByPersonId: demo.uploadedByPersonId,
            uploadedAt: demo.uploadedAt,
            demo: true,
          },
        ],
        ['id'],
        ['id', 'evaluationNodeId', 'fileName', 'pageCount', 'demo'],
      ),
      await insertChecked(
        tx,
        interviewImportCandidates,
        prepared.candidates.map((c) => ({
          batchId: demo.batchId,
          candidateId: c.candidateId,
          name: c.name,
          personId: c.directoryPersonId,
          positionCode: null,
          interviewTime: null,
          status: c.status,
          demo: true,
        })),
        ['batchId', 'candidateId'],
      ),
      await insertChecked(
        tx,
        interviewImportRows,
        records.rows,
        ['batchId', 'rowId'],
        ROW_IMMUTABLE,
      ),
    ];
    return {
      status: inserted.some((rows) => rows.length)
        ? ('created' as const)
        : ('unchanged' as const),
      batchId: demo.batchId,
      rows: records.rows.length,
    };
  });
}
