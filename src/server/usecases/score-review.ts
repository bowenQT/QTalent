import {
  reviewActiveItemSchema,
  reviewQueueActionSchema,
} from '../../contracts/review-queue';
import { recordEvidenceScoreSchema } from '../../contracts/record';
import { projectTalentRecord } from '../authz/talent';
import {
  accountBindings,
  grants,
  people,
  organizations,
} from '../modules/directory';
import {
  enrollments,
  assignments,
  evaluationNodes,
  evaluationNodeSubjects,
  evaluationRelations,
} from '../modules/programs';
import { projects, members } from '../modules/staffing';
import { anchors } from '../modules/evaluation-system';
import { createPostgresScoreReviewStore } from '../modules/talent/score-review/postgres';
import {
  digest,
  resolveScoreReview,
} from '../modules/talent/score-review/service';
import { readLockedRecordLedger } from './record-ledger';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { activeGrants } from '../authz';
import { canManageNodeAssignments } from '../authz/evaluation-node';
import type { DbExecutor, Database, Transaction } from '../db/client';
import { events } from '../modules/records';
import { scoreReviews } from '../modules/talent';
import {
  ScoreReviewForbiddenError,
  type ReviewAuthority,
  type ReviewTarget,
  type ScoreReviewWritePort,
  ScoreReviewStoreConflict,
} from '../modules/talent/score-review/ports';
import { loadEvaluationContext } from './evaluation-context';
import { ForbiddenError } from './project-context';

async function current(db: DbExecutor, accountId: string, now: string) {
  try {
    const loaded = await loadEvaluationContext(db, accountId, now);
    if (!activeGrants(loaded.context).some((grant) => grant.role === 'hr'))
      throw new ScoreReviewForbiddenError();
    return loaded.context;
  } catch (error) {
    if (error instanceof ForbiddenError) throw new ScoreReviewForbiddenError();
    throw error;
  }
}

/** Native current authority; actor noReview is not a prohibition on HR work. */
export async function readScoreReviewAuthority(
  db: DbExecutor,
  accountId: string,
  now: string,
): Promise<ReviewAuthority> {
  const context = await current(db, accountId, now);
  return {
    accountId: context.account.id,
    personId: context.account.personId,
    isSystemAdmin: false,
    hasHrRole: true,
  };
}

const targetColumns = {
  itemId: scoreReviews.id,
  eventId: events.id,
  personId: events.personId,
  evaluationNodeId: events.evaluationNodeId,
  dimensionId: scoreReviews.dimensionId,
  ruleVersion: events.ruleVersionId,
};

/** Metadata only, filtered before loading either score, reason, or citation.
 * A review's current revision and exact saved sides require the ledger reader.
 * These rows are not ready review items and grant no source access. */
export async function listAuthorizedScoreReviewIdentities(
  db: DbExecutor,
  accountId: string,
  now: string,
) {
  const context = await current(db, accountId, now);
  const rows = await db
    .select(targetColumns)
    .from(scoreReviews)
    .innerJoin(events, eq(events.id, scoreReviews.eventId))
    .where(
      and(
        eq(scoreReviews.status, 'open'),
        isNull(scoreReviews.withdrawnAt),
        isNull(events.withdrawnAt),
        inArray(scoreReviews.reason, [
          'score_gap',
          'ai_changed_without_reason',
        ]),
      ),
    )
    .orderBy(scoreReviews.id);
  return rows.filter(
    (row) =>
      row.evaluationNodeId !== null &&
      canManageNodeAssignments(context, row.evaluationNodeId, row.personId),
  );
}

/** Re-read both binding and target identity. A caller-supplied HR flag or a
 * person's permission at a different node cannot authorize this review. */
export async function canReviewScoreTarget(
  db: DbExecutor,
  authority: ReviewAuthority,
  target: ReviewTarget,
  now: string,
): Promise<boolean> {
  let context;
  try {
    context = await current(db, authority.accountId, now);
  } catch (error) {
    if (error instanceof ScoreReviewForbiddenError) return false;
    throw error;
  }
  if (context.account.personId !== authority.personId) return false;
  const [row] = await db
    .select(targetColumns)
    .from(scoreReviews)
    .innerJoin(events, eq(events.id, scoreReviews.eventId))
    .where(
      and(
        eq(scoreReviews.id, target.itemId),
        isNull(scoreReviews.withdrawnAt),
        isNull(events.withdrawnAt),
        inArray(scoreReviews.reason, [
          'score_gap',
          'ai_changed_without_reason',
        ]),
      ),
    );
  return (
    row !== undefined &&
    row.evaluationNodeId !== null &&
    row.eventId === target.eventId &&
    row.personId === target.personId &&
    row.evaluationNodeId === target.evaluationNodeId &&
    row.dimensionId === target.dimensionId &&
    row.ruleVersion === target.ruleVersion &&
    canManageNodeAssignments(context, row.evaluationNodeId, row.personId)
  );
}

export type ScoreReviewNativeClock = {
  businessNow(): string;
  wallNow(): string;
};

/** Caller already holds the shared ledger fence. Fix every server-owned
 * authorization relation, including all co-subjects, before the final reload. */
async function lockReviewAuthority(tx: Transaction) {
  await tx.execute(sql`lock table
    ${accountBindings}, ${grants}, ${people}, ${organizations},
    ${enrollments}, ${assignments}, ${evaluationNodes}, ${evaluationNodeSubjects},
    ${evaluationRelations}, ${projects}, ${members} in share mode`);
}

async function nativeTarget(
  tx: Transaction,
  itemId: string,
): Promise<ReviewTarget | null> {
  const [row] = await tx
    .select({
      ...targetColumns,
      revision: scoreReviews.revision,
      status: scoreReviews.status,
      withdrawnAt: scoreReviews.withdrawnAt,
    })
    .from(scoreReviews)
    .innerJoin(events, eq(events.id, scoreReviews.eventId))
    .where(eq(scoreReviews.id, itemId));
  if (!row?.evaluationNodeId) return null;
  const { withdrawnAt, ...identity } = row;
  return {
    ...identity,
    evaluationNodeId: row.evaluationNodeId,
    status:
      withdrawnAt !== null
        ? 'withdrawn'
        : row.status === 'open'
          ? 'open'
          : 'resolved',
  };
}

async function readNativeReview(
  tx: Transaction,
  authority: ReviewAuthority,
  target: ReviewTarget,
  clock: ScoreReviewNativeClock,
) {
  const ledger = await readLockedRecordLedger(
    tx,
    {
      evaluationNodeId: target.evaluationNodeId,
      personId: target.personId,
    },
    { accountId: authority.accountId, now: clock.businessNow },
  );
  if (!(await canReviewScoreTarget(tx, authority, target, clock.businessNow())))
    return null;
  const entry = ledger.events.find((item) => item.event.id === target.eventId);
  if (
    !entry ||
    entry.event.withdrawnAt !== null ||
    entry.provenance.availability !== 'available' ||
    entry.sources.availability !== 'available'
  )
    return null;
  const review = entry.reviews.find((item) => item.row.id === target.itemId);
  if (
    !review ||
    review.ownership.availability !== 'available' ||
    review.row.withdrawnAt !== null ||
    !review.row.confirmationId ||
    !['score_gap', 'ai_changed_without_reason'].includes(review.row.reason)
  )
    return null;
  const kind = review.row.reason === 'score_gap' ? 'rater_gap' : 'ai_gap';
  const ids = [
    review.row.confirmationId,
    ...(kind === 'rater_gap' ? [review.row.counterpartConfirmationId] : []),
  ];
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return null;
  const stored = await createPostgresScoreReviewStore().calibration(
    tx,
    target.itemId,
  );
  if (target.status === 'resolved' && !stored) return null;
  const originalRevision = stored?.original.revision ?? target.revision;
  const scores = [];
  let aiScore;
  let suggestionId: string | null = null;
  for (const id of ids) {
    const human = entry.confirmations.find((item) => item.row.id === id);
    if (
      !human ||
      human.ownership.availability !== 'available' ||
      human.acceptedDecision.availability !== 'available' ||
      human.suggestion.availability !== 'available' ||
      !human.row.active ||
      human.row.status !== 'scored' ||
      human.row.dimensionId !== target.dimensionId ||
      human.row.ruleVersionId !== target.ruleVersion ||
      !human.row.evaluatorId ||
      !human.row.confirmedAt
    )
      return null;
    const decision = human.acceptedDecision.fact;
    const suggestion = human.suggestion.fact;
    if (
      suggestion.originalDraftScore.state !== 'suggested' ||
      (decision.action !== 'confirm' && decision.action !== 'edit') ||
      human.row.value !==
        (decision.action === 'edit'
          ? decision.value
          : suggestion.originalDraftScore.value)
    )
      return null;
    const references = suggestion.originalDraftScore.citations.map(
      (citation) => citation.reference,
    );
    const node = ledger.context.evaluationNodes?.find(
      (node) => node.id === target.evaluationNodeId,
    );
    if (!node) return null;
    // The existing projection checks all shared subjects and requiredKinds.
    // A single denied citation suppresses the complete score, never just its link.
    const subject = {
      personId: target.personId,
      evaluationNodeId: target.evaluationNodeId,
      cohortId: node.cohortId,
    };
    const visible = projectTalentRecord(
      ledger.context,
      {
        id: human.row.id,
        subject,
        kind: 'confirmed-score',
        fields: [
          {
            name: 'evidence',
            kind: 'confirmed-score',
            value: true,
            subjects: [],
            sources: references,
          },
        ],
      },
      entry.sources.fact,
      'source-read',
    );
    if (!visible || visible.fields.evidence !== true) return null;
    for (const citation of suggestion.originalDraftScore.citations) {
      const source = visible.sources.find(
        (source) =>
          source.fragmentId === citation.reference.fragmentId &&
          source.originalVersionId === citation.reference.originalVersionId,
      );
      if (
        !source ||
        !source.excerpt.includes(citation.quote) ||
        digest(source.location) !== digest(citation.reference.location)
      )
        return null;
    }
    const [anchor] = await tx
      .select()
      .from(anchors)
      .where(eq(anchors.id, human.row.anchorId!))
      .for('share');
    if (
      !anchor ||
      anchor.ruleVersionId !== target.ruleVersion ||
      anchor.dimensionId !== target.dimensionId ||
      anchor.value !== human.row.value
    )
      return null;
    const parsedScore = recordEvidenceScoreSchema.safeParse({
      value: human.row.value,
      anchor: {
        id: anchor.id,
        text: anchor.text,
        ruleVersion: anchor.ruleVersionId,
      },
      citations: suggestion.originalDraftScore.citations,
    });
    if (!parsedScore.success) return null;
    scores.push({
      ...parsedScore.data,
      raterId: human.row.evaluatorId,
      confirmedAt: human.row.confirmedAt.toISOString(),
      // Lineage text in confirmations.reason is not the user's input reason.
      reason: decision.action === 'edit' ? decision.reason : '',
    });
    if (kind === 'ai_gap') {
      const [aiAnchor] = await tx
        .select()
        .from(anchors)
        .where(eq(anchors.id, suggestion.row.anchorId!))
        .for('share');
      if (
        !aiAnchor ||
        aiAnchor.ruleVersionId !== target.ruleVersion ||
        aiAnchor.dimensionId !== target.dimensionId ||
        aiAnchor.value !== suggestion.row.value ||
        aiAnchor.text !== suggestion.originalDraftScore.anchor.text
      )
        return null;
      aiScore = recordEvidenceScoreSchema.parse({
        value: suggestion.row.value,
        anchor: {
          id: aiAnchor.id,
          text: aiAnchor.text,
          ruleVersion: aiAnchor.ruleVersionId,
        },
        citations: suggestion.originalDraftScore.citations,
      });
      suggestionId = suggestion.row.id;
    }
  }
  const base = {
    id: target.itemId,
    revision: originalRevision,
    eventId: target.eventId,
    personId: target.personId,
    dimensionId: target.dimensionId,
  };
  const parsed = reviewActiveItemSchema.safeParse(
    kind === 'rater_gap'
      ? { ...base, kind, sides: scores }
      : { ...base, kind, human: scores[0], ai: aiScore },
  );
  if (
    !parsed.success ||
    (stored && digest(stored.original) !== digest(parsed.data))
  )
    return null;
  return {
    item: parsed.data,
    bindings: {
      sourceFactRevision: ledger.revision,
      confirmationId: review.row.confirmationId,
      counterpartConfirmationId: review.row.counterpartConfirmationId,
      suggestionId,
    },
  };
}

/** Actual native command composition. It is not yet wired to a public route.
 * The caller supplies the authenticated account, never a client person/role.
 */
export async function resolveNativeScoreReview(
  db: Database,
  accountId: string,
  input: unknown,
  clock: ScoreReviewNativeClock,
) {
  const parsed = reviewQueueActionSchema.safeParse(input);
  const store = createPostgresScoreReviewStore();
  const transaction = <T>(work: (port: ScoreReviewWritePort) => Promise<T>) =>
    db.transaction(
      async (tx) => {
        // Metadata locates the fence. It grants no access and is re-read below.
        await readScoreReviewAuthority(tx, accountId, clock.businessNow());
        const first = parsed.success
          ? await nativeTarget(tx, parsed.data.itemId)
          : null;
        if (first) {
          await readLockedRecordLedger(
            tx,
            {
              evaluationNodeId: first.evaluationNodeId,
              personId: first.personId,
            },
            { accountId, now: clock.businessNow },
          );
          await lockReviewAuthority(tx);
        }
        const port: ScoreReviewWritePort = {
          currentAuthority: (id) =>
            readScoreReviewAuthority(tx, id, clock.businessNow()),
          listOpenTargets: async () => {
            const rows = await listAuthorizedScoreReviewIdentities(
              tx,
              accountId,
              clock.businessNow(),
            );
            const targets = await Promise.all(
              rows.map((row) => nativeTarget(tx, row.itemId)),
            );
            return targets.filter(
              (target): target is ReviewTarget => target !== null,
            );
          },
          target: (id) => nativeTarget(tx, id),
          canReview: (authority, target) =>
            canReviewScoreTarget(tx, authority, target, clock.businessNow()),
          authorizedItem: async (authority, target) =>
            (await readNativeReview(tx, authority, target, clock))?.item ??
            null,
          lockOperation: (id, operationId) =>
            store.lockOperation(tx, id, operationId),
          // The shared fence already fixes all event/review rows. This must not
          // introduce the obsolete score-event advisory lock or a different order.
          lockEvent: async (eventId) => {
            if (!first || first.eventId !== eventId)
              throw new ScoreReviewStoreConflict();
          },
          operation: (id, operationId) => store.operation(tx, id, operationId),
          calibration: (id) => store.calibration(tx, id),
          anchor: async (target, value) => {
            const [row] = await tx
              .select()
              .from(anchors)
              .where(
                and(
                  eq(anchors.dimensionId, target.dimensionId),
                  eq(anchors.ruleVersionId, target.ruleVersion),
                  eq(anchors.value, value),
                ),
              )
              .for('share');
            return row
              ? {
                  id: row.id,
                  text: row.text,
                  ruleVersion: row.ruleVersionId,
                  dimensionId: row.dimensionId,
                  value: row.value,
                }
              : null;
          },
          applyCalibration: async (write) => {
            const authority = await readScoreReviewAuthority(
              tx,
              accountId,
              clock.businessNow(),
            );
            if (authority.personId !== write.actorPersonId)
              throw new ScoreReviewForbiddenError();
            const facts = await readNativeReview(
              tx,
              authority,
              write.target,
              clock,
            );
            if (!facts || digest(facts.item) !== write.originalFingerprint)
              throw new ScoreReviewStoreConflict();
            await store.applyCalibration(tx, write, facts.bindings);
          },
        };
        return work(port);
      },
      { isolationLevel: 'read committed' },
    );
  return resolveScoreReview(
    { read: transaction, transaction },
    accountId,
    input,
    () => new Date(clock.wallNow()),
  );
}
