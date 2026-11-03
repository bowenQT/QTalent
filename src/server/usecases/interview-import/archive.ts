import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { jobSnapshots } from '../../jobs/schema';
import {
  historicalEvaluations,
  originals,
  originalVersions,
  materialParses,
  materialPdfPages,
  fragments,
} from '../../modules/records';
import {
  interviewImportArchives,
  type interviewImportRows,
} from '../../modules/records/interview-import/schema';
import {
  readInterviewArchives,
  type InterviewArchiveFacts,
} from '../../modules/records/interview-import/read';
import {
  prepareMaterialParse,
  readMaterialParse,
} from '../../modules/records/material-sources/store';
import type { MaterialSource } from '../../../contracts/sources';
import type { InterviewImportPlan, InterviewImportIdentity } from './plan';
import { archiveScale, INTERVIEW_HISTORY_KIND } from './archive-model';
import { recordAudit } from '../../platform/audit';

type Row = typeof interviewImportRows.$inferSelect;
type Planned = Extract<InterviewImportPlan, { status: 'planned' }>;
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
/** The legacy 906 parser receipt used sorted JSON, not the material bundle digest. */
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
export function archiveProjectionId(
  row: Pick<Row, 'batchId' | 'rowId' | 'parseVersionId'>,
) {
  return (
    'interview-archive:' +
    digest(JSON.stringify([row.batchId, row.rowId, row.parseVersionId]))
  );
}
export function archiveFragmentId(parseId: string, field: string, index = 0) {
  return `${parseId}:${field}:${index}`;
}

/** Publish a new, immutable material projection of the already stored 900 parse.
 * This is an HR archive derivation, not a new parser-job completion. The old seed
 * receipt and fragments remain unchanged, and the standard material reader stays strict. */
async function publishArchiveSource(tx: DbExecutor, row: Row, plan: Planned) {
  const [prior] = await tx
    .select({
      parse: materialParses,
      version: originalVersions,
      original: originals,
      job: jobSnapshots,
    })
    .from(materialParses)
    .innerJoin(
      originalVersions,
      eq(originalVersions.id, materialParses.originalVersionId),
    )
    .innerJoin(originals, eq(originals.id, originalVersions.originalId))
    .innerJoin(jobSnapshots, eq(jobSnapshots.jobId, materialParses.jobId))
    .where(eq(materialParses.id, row.parseVersionId));
  if (
    !prior ||
    row.parsed.status === 'rejected' ||
    prior.version.id !== row.originalVersionId ||
    prior.original.id !== row.materialId ||
    prior.original.kind !== 'original' ||
    prior.parse.contentDigest !== prior.version.contentDigest ||
    prior.parse.parserVersion !== 'bow-900-interview-review-isolated' ||
    prior.parse.projectionVersion !== 'interview-review-lines-v1' ||
    prior.parse.resultDigest !== digest(canonical(row.parsed)) ||
    prior.job.kind !== 'interview_pdf_parse' ||
    prior.job.resourceId !== row.originalVersionId ||
    prior.job.inputVersion !== prior.version.contentDigest ||
    prior.job.attempt !== prior.parse.attempt ||
    prior.job.status !== 'completed' ||
    prior.job.cancelRequestedAt !== null ||
    row.parsed.pageTexts.some((page) => digest(page.text) !== page.sha256)
  )
    throw new Error(
      'Interview archive source does not match its parser receipt',
    );
  const parseId = archiveProjectionId(row);
  const scale = archiveScale(plan.originalReview, row.filled);
  const regions = [
    { field: 'overview', regions: [plan.originalReview.templateSource] },
    ...scale.map((item, index) => ({
      field: `scale-${index}`,
      regions: item.regions,
    })),
    {
      field: 'interviewer',
      regions: plan.originalReview.metadata.interviewer!.sources,
    },
    {
      field: 'interview-time',
      regions: plan.originalReview.metadata.interviewTime!.sources,
    },
  ];
  const published: MaterialSource[] = regions.flatMap(({ field, regions }) =>
    regions.map((region, index) => {
      const page =
        row.parsed.status !== 'rejected'
          ? row.parsed.pageTexts.find((page) => page.page === region.page)
          : undefined;
      if (!page) throw new Error('Interview archive page is missing');
      return {
        fragmentId: archiveFragmentId(parseId, field, index),
        originalVersionId: row.originalVersionId,
        sourceCategory: 'historical_evaluation' as const,
        evaluationKind: 'interview' as const,
        demo: plan.originalReview.demo,
        location: {
          kind: 'pdf' as const,
          page: region.page,
          textRange: region.textRange,
        },
        excerpt: page.text.slice(region.textRange.start, region.textRange.end),
      };
    }),
  );
  const publication = prepareMaterialParse({
    binding: {
      parseVersionId: parseId,
      originalVersionId: row.originalVersionId,
      contentDigest: prior.parse.contentDigest,
      parserVersion: prior.parse.parserVersion,
      projectionVersion: 'interview-archive-material-v1',
    },
    fragments: published,
    pages: row.parsed.pageTexts.map(({ page, text }) => ({ page, text })),
  });
  const existing = await readMaterialParse(tx, parseId);
  if (existing) {
    if (
      JSON.stringify(existing) !==
      JSON.stringify({
        ...publication,
        jobId: prior.parse.jobId,
        attempt: prior.parse.attempt,
      })
    )
      throw new Error('Interview archive projection identity conflict');
  } else {
    await tx.insert(materialParses).values({
      id: parseId,
      originalVersionId: row.originalVersionId,
      contentDigest: prior.parse.contentDigest,
      parserVersion: prior.parse.parserVersion,
      projectionVersion: publication.binding.projectionVersion,
      resultDigest: publication.resultDigest,
      jobId: prior.parse.jobId,
      attempt: prior.parse.attempt,
    });
    await tx
      .insert(materialPdfPages)
      .values(
        publication.pages.map((page) => ({ ...page, parseVersionId: parseId })),
      );
    await tx.insert(fragments).values(
      publication.fragments.map((fragment) => ({
        id: fragment.fragmentId,
        originalVersionId: fragment.originalVersionId,
        parseVersionId: parseId,
        sourceCategory: 'historical_evaluation' as const,
        evaluationKind: 'interview' as const,
        demo: fragment.demo,
        location: fragment.location,
        excerpt: fragment.excerpt,
      })),
    );
  }
  return {
    fragmentId: archiveFragmentId(parseId, 'overview'),
    originalVersionId: row.originalVersionId,
  };
}

export function latestRowArchive(
  archives: InterviewArchiveFacts,
  row: Pick<Row, 'batchId' | 'rowId'>,
) {
  return archives
    .filter(
      ({ archive }) =>
        archive.batchId === row.batchId && archive.rowId === row.rowId,
    )
    .sort((a, b) => b.archive.importRevision - a.archive.importRevision)[0];
}
export function activeInterviewIdentities(
  archives: InterviewArchiveFacts,
): (InterviewImportIdentity & { evaluationId: string })[] {
  return archives.flatMap(({ archive, history, row, operation }) => {
    const review =
      row.parsed.status === 'rejected'
        ? null
        : row.parsed.reviews[row.reviewIndex];
    const candidateId = operation.after.confirmation?.candidateId;
    const interviewTime = review?.metadata.interviewTime?.value;
    if (
      archive.withdrawnAt !== null ||
      !candidateId ||
      !review ||
      !interviewTime
    )
      return [];
    return [
      {
        evaluationId: history.id,
        candidateId,
        interviewTime,
        interviewerId: history.recorderId,
        template: review.template,
      },
    ];
  });
}

/** The current row operation must already exist, in this same transaction. */
export async function archiveInterviewRow(
  tx: DbExecutor,
  row: Row,
  plan: Planned,
) {
  const source = await publishArchiveSource(tx, row, plan);
  const evaluationId = randomUUID();
  const occurredOn =
    plan.identity.interviewTime.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!occurredOn) throw new Error('Interview date cannot be archived');
  await tx.insert(historicalEvaluations).values({
    id: evaluationId,
    sourceRecordId: `interview-import:${row.batchId}:${row.rowId}`,
    evaluationNodeId: plan.evaluationNodeId,
    personId: plan.personId,
    recorderId: plan.signatures.interviewerId,
    occurredOn,
    kind: INTERVIEW_HISTORY_KIND,
    period: plan.originalReview.template,
    scale: archiveScale(plan.originalReview, row.filled).map(
      ({ item, value }) => [item, value],
    ),
    sourceCategory: 'original',
    ...source,
  });
  await tx.insert(interviewImportArchives).values({
    evaluationId,
    batchId: row.batchId,
    rowId: row.rowId,
    importRevision: row.revision,
    duplicateKey: plan.duplicateKey,
    importerPersonId: plan.signatures.importerPersonId,
  });
  return evaluationId;
}

export async function withdrawInterviewRow(
  tx: DbExecutor,
  accountId: string,
  row: Row,
  at: string,
) {
  const active = latestRowArchive(await readInterviewArchives(tx), row);
  if (!active || active.archive.withdrawnAt !== null) return;
  const auditId = await recordAudit(tx, {
    actorId: accountId,
    action: 'interview_import.archive.withdraw',
    resourceId: active.history.id,
    metadata: { channel: 'web', revision: row.revision + 1 },
  });
  await tx
    .update(interviewImportArchives)
    .set({ withdrawnAt: at, withdrawalAuditId: auditId })
    .where(
      and(
        eq(interviewImportArchives.evaluationId, active.history.id),
        isNull(interviewImportArchives.withdrawnAt),
      ),
    );
}
