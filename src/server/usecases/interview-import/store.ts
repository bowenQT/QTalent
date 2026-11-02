import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DbExecutor, Database } from '../../db/client';
import { activeGrants } from '../../authz';
import {
  canManageNodeAssignments,
  cohortHrCanReadNodeSubject,
  type EvaluationAuthzContext,
} from '../../authz/evaluation-node';
import { employments } from '../../modules/directory';
import { evaluationNodes } from '../../modules/programs';
import { fragments } from '../../modules/records';
import {
  interviewImportBatches,
  interviewImportCandidates,
  interviewImportRows,
  type InterviewImportDecision,
} from '../../modules/records/interview-import/schema';
import type {
  ParsedInterviewReview,
  Selection as ParsedSelection,
} from '../../modules/records/attachments/interview-review/types';
import type {
  InterviewImportConfirmInput,
  InterviewImportPreviewResult,
  InterviewImportRow,
  InterviewImportRowResult,
} from '../../../contracts/interview-import';
import { loadEvaluationContext } from '../evaluation-context';
import { ForbiddenError } from '../project-context';
import {
  planInterviewImport,
  type InterviewImportFacts,
  type InterviewImportPlan,
} from './plan';

type Row = typeof interviewImportRows.$inferSelect;
type Candidate = typeof interviewImportCandidates.$inferSelect;
type Loaded = NonNullable<Awaited<ReturnType<typeof loadBatch>>>;
type Context = EvaluationAuthzContext;
type Directory = Awaited<ReturnType<typeof loadEvaluationContext>>['directory'];

/** Template scale labels as the preview shows them; the parser keeps only the value. */
const SCALES: Record<string, string> = {
  校招专业面试通用评价表: '1–5 分',
  '七牛面试评价表-专业面试官': 'A–D',
  '七牛面试评价表-HR': '优 / 良 / 中 / 差',
};
const UNREAD = '（未识别）';

async function loadBatch(db: DbExecutor, batchId: string) {
  const [batch] = await db
    .select({
      batch: interviewImportBatches,
      node: evaluationNodes,
    })
    .from(interviewImportBatches)
    .innerJoin(
      evaluationNodes,
      eq(evaluationNodes.id, interviewImportBatches.evaluationNodeId),
    )
    .where(eq(interviewImportBatches.id, batchId));
  if (!batch) return null;
  const candidates = await db
    .select()
    .from(interviewImportCandidates)
    .where(eq(interviewImportCandidates.batchId, batchId));
  const rows = await db
    .select({ row: interviewImportRows, fragment: fragments })
    .from(interviewImportRows)
    .innerJoin(
      fragments,
      and(
        eq(fragments.id, interviewImportRows.fragmentId),
        eq(fragments.originalVersionId, interviewImportRows.originalVersionId),
      ),
    )
    .where(eq(interviewImportRows.batchId, batchId))
    .orderBy(asc(interviewImportRows.ordinal));
  return { ...batch, candidates, rows };
}

async function loadEmployments(db: DbExecutor, personIds: string[]) {
  return personIds.length
    ? db
        .select({
          personId: employments.personId,
          validFrom: employments.validFrom,
          validTo: employments.validTo,
        })
        .from(employments)
        .where(inArray(employments.personId, personIds))
    : [];
}

/**
 * Directory names the way the PDFs print them. Demo people are stored without the
 * 「（演示）」 suffix while the 896 PDFs and recruitment records carry it; the plan
 * compares names exactly, so the suffix is added here and nowhere else. No fuzzy match:
 * a name one character off stays unmatched.
 */
export function shownName(person: { name: string; demo: boolean }) {
  return person.demo ? `${person.name}（演示）` : person.name;
}

const reviewOf = (row: Row): ParsedInterviewReview | null =>
  row.parsed.status === 'rejected'
    ? null
    : (row.parsed.reviews[row.reviewIndex] ?? null);

/** The recruitment record HR is asked about: the stored confirmation, else the one
 * record whose name equals the printed name. Never inferred from anything else. */
function proposalFor(row: Row, candidates: Candidate[]) {
  if (row.confirmedCandidateId)
    return candidates.find((c) => c.candidateId === row.confirmedCandidateId)!;
  const name = reviewOf(row)?.identity.candidateName?.value;
  const named = candidates.filter((c) => c.name === name);
  return named.length === 1 ? named[0] : null;
}

/** Whose row this is, as far as the stored facts say; empty when nobody is known. */
function subjectsFor(row: Row, candidates: Candidate[], directory: Directory) {
  const personId = proposalFor(row, candidates)?.personId;
  return personId && directory.people.some((p) => p.id === personId)
    ? [personId]
    : [];
}

/** The HR grant whose cohort covers every subject of the row, or none. */
function hrCohortFor(context: Context, nodeId: string, subjects: string[]) {
  return activeGrants(context).find(
    (grant) =>
      grant.role === 'hr' &&
      grant.cohortId !== null &&
      subjects.every((personId) =>
        cohortHrCanReadNodeSubject(context, grant.cohortId!, nodeId, personId),
      ),
  )?.cohortId;
}

function factsFor(
  context: Context,
  directory: Directory,
  loaded: Loaded,
  entry: Loaded['rows'][number],
  employmentRows: Awaited<ReturnType<typeof loadEmployments>>,
  actorAccountId: string,
): InterviewImportFacts {
  const { row, fragment } = entry;
  const subjects = subjectsFor(row, loaded.candidates, directory);
  const hrCohortId = hrCohortFor(context, loaded.node.id, subjects);
  const review = reviewOf(row);
  return {
    context,
    batchId: row.batchId,
    rowId: row.rowId,
    evaluationNodeId: loaded.node.id,
    originalVersionId: row.originalVersionId,
    materialId: row.materialId,
    parsed: row.parsed,
    reviewIndex: row.reviewIndex,
    // The PDF prints no position code and the demo records carry none (BOW-900).
    observedIdentity: review
      ? {
          name: review.identity.candidateName?.value ?? null,
          positionCode: null,
        }
      : null,
    candidates: loaded.candidates.map((c) => ({
      candidateId: c.candidateId,
      personId: c.personId,
      name: c.name,
      positionCode: c.positionCode,
      interviewTime: c.interviewTime,
      status: c.status,
    })),
    confirmedCandidateId: row.confirmedCandidateId,
    confirmedForRowRevision: row.confirmedForRevision,
    confirmedInterviewerId: null,
    directory: directory.people.map((p) => ({ id: p.id, name: shownName(p) })),
    employments: employmentRows,
    source: {
      fragmentId: fragment.id,
      originalVersionId: fragment.originalVersionId,
      location: fragment.location,
      excerpt: fragment.excerpt,
      demo: fragment.demo,
      sourceCategory: fragment.sourceCategory,
      evaluationKind: fragment.evaluationKind,
    },
    existing: [],
    rowSnapshot: {
      batchId: row.batchId,
      rowId: row.rowId,
      evaluationNodeId: loaded.node.id,
      materialId: row.materialId,
      originalVersionId: row.originalVersionId,
      revision: row.revision,
      actorAccountId,
      hrCohortId: hrCohortId ?? 'none',
      access: hrCohortId === undefined ? 'forbidden' : 'allowed',
      subjectPersonIds: subjects,
      hasHiddenContent: false,
      // No review items are stored by this slice; sending to review comes later.
      blockingReviewItemIds: [],
      import: { state: 'unimported' },
    },
    pendingCandidate: null,
    candidateResolution: null,
    resolvedCandidate: null,
    resolvedInterviewer: null,
    pendingInterviewer: null,
    resolution: null,
  };
}

function decisionOf(
  plan: InterviewImportPlan,
  candidateId: string | null,
  decidedAt: string,
  decidedByAccountId: string,
): InterviewImportDecision {
  const base = { status: plan.status, decidedAt, decidedByAccountId };
  switch (plan.status) {
    case 'not_ready':
    case 'skipped':
    case 'conflict':
      return { ...base, reason: plan.reason };
    case 'needs_review':
      return { ...base, reviewItemKind: plan.item.kind };
    case 'duplicate':
      return base;
    case 'planned':
      return {
        ...base,
        personId: plan.personId,
        candidateId: candidateId ?? undefined,
        interviewerId: plan.signatures.interviewerId,
        duplicateKey: plan.duplicateKey,
      };
    default:
      return base;
  }
}

const selection = (value: ParsedSelection) =>
  value.status === 'recognized'
    ? { status: 'recognized' as const, value: value.value }
    : value.status === 'not_applicable'
      ? value
      : {
          status: 'unrecognized' as const,
          reason: value.reason,
          page: value.source.page,
          options: [],
          marked: [],
        };

/** The row as the preview shows it; every value comes from the stored row and facts. */
function view(
  loaded: Loaded,
  entry: Loaded['rows'][number],
  directory: Directory,
  employmentRows: Awaited<ReturnType<typeof loadEmployments>>,
  plan: InterviewImportPlan,
): InterviewImportRow {
  const { row } = entry;
  const review = reviewOf(row)!;
  const pages =
    row.parsed.status === 'rejected'
      ? [review.templateSource.page]
      : row.parsed.pageTexts.map((p) => p.page);
  const proposal = proposalFor(row, loaded.candidates);
  const person = proposal?.personId
    ? directory.people.find((p) => p.id === proposal.personId)
    : undefined;
  const joined = employmentRows
    .filter((e) => e.personId === person?.id)
    .map((e) => e.validFrom)
    .sort()[0];
  const observedInterviewer = review.metadata.interviewer?.value ?? null;
  const interviewerMatches = directory.people.filter(
    (p) => shownName(p) === observedInterviewer,
  );
  const confirmed =
    row.confirmedCandidateId !== null &&
    row.confirmedForRevision === row.revision;
  return {
    rowId: row.rowId,
    pages: { from: Math.min(...pages), to: Math.max(...pages) },
    observedName: review.identity.candidateName?.value ?? UNREAD,
    // Without a record the row waits to be identified; the status is not read then.
    candidateStatus: proposal?.status ?? 'hired',
    // Name, position code and interview time locate a record: never on demo rows.
    located:
      !confirmed && plan.status === 'skipped' && plan.reason === 'not_hired',
    template: { name: review.template, scale: SCALES[review.template] ?? '' },
    interviewedOn:
      review.metadata.interviewTime?.value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ??
      '',
    match: person
      ? {
          personId: person.id,
          name: shownName(person),
          hue: person.hue,
          photo: person.photo,
          org:
            directory.organizations.find((o) => o.id === person.organizationId)
              ?.name ?? '',
          title: person.jobTitle ?? '',
          joinedOn: joined ?? '',
        }
      : null,
    interviewer:
      interviewerMatches.length === 1
        ? { status: 'matched', name: observedInterviewer! }
        : {
            status: 'pending',
            observedName: observedInterviewer ?? UNREAD,
            // The id plan.ts gives this row's unknown_interviewer item.
            reviewItemId:
              'interview-import:' +
              createHash('sha256')
                .update(
                  JSON.stringify([
                    row.batchId,
                    row.rowId,
                    row.originalVersionId,
                  ]),
                )
                .digest('hex'),
          },
    scale: [
      ...review.dimensions.map((d) => ({
        item: d.name,
        selection: selection(d.selection),
      })),
      { item: '面试评级', selection: selection(review.interviewRating) },
    ],
    result: review.metadata.interviewResult?.value ?? '',
    comment: review.metadata.overallComment?.value ?? null,
    redacted: 0,
    duplicate: null,
    reviewItemId: null,
    confirmed,
    filled: {},
  };
}

async function readAll(
  db: DbExecutor,
  accountId: string,
  batchId: string,
  now: string,
) {
  let loadedContext;
  try {
    loadedContext = await loadEvaluationContext(db, accountId, now);
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: 'forbidden' as const };
    throw error;
  }
  const { context, directory } = loadedContext;
  if (!activeGrants(context).some((g) => g.role === 'hr'))
    return { status: 'forbidden' as const };
  const loaded = await loadBatch(db, batchId);
  if (!loaded || loaded.node.kind !== 'interview')
    return { status: 'not_found' as const };
  const employmentRows = await loadEmployments(
    db,
    loaded.candidates.flatMap((c) => (c.personId ? [c.personId] : [])),
  );
  return {
    status: 'ok' as const,
    context,
    directory,
    loaded,
    employmentRows,
  };
}

/** HR sees a row only while a current HR grant covers everyone the row is about. */
function visible(
  context: Context,
  loaded: Loaded,
  entry: Loaded['rows'][number],
  directory: Directory,
) {
  const subjects = subjectsFor(entry.row, loaded.candidates, directory);
  return (
    reviewOf(entry.row) !== null &&
    subjects.every((personId) =>
      canManageNodeAssignments(context, loaded.node.id, personId),
    ) &&
    hrCohortFor(context, loaded.node.id, subjects) !== undefined
  );
}

export async function readInterviewImportPreview(
  db: DbExecutor,
  accountId: string,
  batchId: string,
  now: string,
): Promise<InterviewImportPreviewResult> {
  const read = await readAll(db, accountId, batchId, now);
  if (read.status !== 'ok') return read;
  const { context, directory, loaded, employmentRows } = read;
  const rows = loaded.rows.filter((entry) =>
    visible(context, loaded, entry, directory),
  );
  const uploader = directory.people.find(
    (p) => p.id === loaded.batch.uploadedByPersonId,
  );
  return {
    status: 'ok',
    preview: {
      batch: {
        id: loaded.batch.id,
        file: loaded.batch.fileName,
        pageCount: loaded.batch.pageCount,
        uploadedBy: uploader ? shownName(uploader) : '',
        uploadedAt: new Date(loaded.batch.uploadedAt).toISOString(),
        prior: null,
        rows: rows.map((entry) =>
          view(
            loaded,
            entry,
            directory,
            employmentRows,
            planInterviewImport(
              factsFor(
                context,
                directory,
                loaded,
                entry,
                employmentRows,
                accountId,
              ),
            ),
          ),
        ),
      },
      revisions: Object.fromEntries(
        rows.map(({ row }) => [row.rowId, row.revision]),
      ),
    },
  };
}

const CONFLICT = '这一行已变化，请刷新后再看';

/**
 * HR's answer to「这是谁」for one row, or taking it back. One transaction: the row is
 * locked, the expected revision compared, the revision advanced, and the 906 plan for
 * the new revision stored as the row's decision. A confirmation the plan cannot use
 * (anything other than planned or a not-hired skip) is refused and nothing is written.
 */
export async function confirmInterviewImportRow(
  db: Database,
  accountId: string,
  input: InterviewImportConfirmInput,
  /** `now` is the business clock authorization runs on; `at` stamps what was stored. */
  { now, at }: { now: string; at: string },
): Promise<InterviewImportRowResult> {
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(interviewImportRows)
      .where(
        and(
          eq(interviewImportRows.batchId, input.batchId),
          eq(interviewImportRows.rowId, input.rowId),
        ),
      )
      .for('update');
    if (!locked)
      return { status: 'not_found', message: '这一行已不在这份导入里' };
    const read = await readAll(tx, accountId, input.batchId, now);
    if (read.status !== 'ok')
      return {
        status: read.status,
        message:
          read.status === 'forbidden'
            ? '你的查看权限已更新，请刷新后再看'
            : '这一行已不在这份导入里',
      };
    const { context, directory, loaded, employmentRows } = read;
    const entry = loaded.rows.find((e) => e.row.rowId === input.rowId)!;
    if (!visible(context, loaded, entry, directory))
      return {
        status: 'forbidden',
        message: '你的查看权限已更新，请刷新后再看',
      };
    if (locked.revision !== input.expectedRevision)
      return { status: 'conflict', message: CONFLICT };
    const confirmedNow =
      locked.confirmedCandidateId !== null &&
      locked.confirmedForRevision === locked.revision;
    if (confirmedNow === input.ok)
      return { status: 'conflict', message: CONFLICT };
    const proposal = proposalFor(locked, loaded.candidates);
    if (input.ok && !proposal)
      return { status: 'conflict', message: '这一行还不知道是谁，不能确认' };
    const revision = locked.revision + 1;
    const next: Row = {
      ...locked,
      revision,
      ...(input.ok
        ? {
            confirmedCandidateId: proposal!.candidateId,
            confirmedForRevision: revision,
            confirmedByAccountId: accountId,
            confirmedAt: at,
          }
        : {
            confirmedCandidateId: null,
            confirmedForRevision: null,
            confirmedByAccountId: null,
            confirmedAt: null,
          }),
    };
    const nextEntry = { ...entry, row: next };
    const plan = planInterviewImport(
      factsFor(
        context,
        directory,
        loaded,
        nextEntry,
        employmentRows,
        accountId,
      ),
    );
    if (
      input.ok &&
      plan.status !== 'planned' &&
      !(plan.status === 'skipped' && plan.reason === 'not_hired')
    )
      return {
        status: 'conflict',
        message: '这一行还有没处理完的项，处理后再确认',
      };
    const decision = decisionOf(plan, next.confirmedCandidateId, at, accountId);
    const [stored] = await tx
      .update(interviewImportRows)
      .set({
        revision,
        confirmedCandidateId: next.confirmedCandidateId,
        confirmedForRevision: next.confirmedForRevision,
        confirmedByAccountId: next.confirmedByAccountId,
        confirmedAt: next.confirmedAt,
        decision,
        decisionRevision: revision,
      })
      .where(
        and(
          eq(interviewImportRows.batchId, input.batchId),
          eq(interviewImportRows.rowId, input.rowId),
          eq(interviewImportRows.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!stored) return { status: 'conflict', message: CONFLICT };
    return {
      status: 'ok',
      row: view(
        loaded,
        { ...entry, row: stored },
        directory,
        employmentRows,
        plan,
      ),
      revision,
    };
  });
}
