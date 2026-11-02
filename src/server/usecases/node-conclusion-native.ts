import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { createClock } from '../../lib/clock';
import {
  materialSourceReferenceSchema,
  type MaterialSourceReference,
} from '../../contracts/sources';
import type { Database, Transaction } from '../db/client';
import { projectTalentRecord, type TalentSource } from '../authz/talent';
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
import {
  NodeConclusionError,
  canConfirmNodeConclusion,
  nodeConclusionReferenceKey,
  readNodeConclusionInputSchema,
  confirmNodeConclusionInputSchema,
  type NodeConclusionIdentity,
  type NodeScoreAuthority,
  type ResolvedNodeConclusionSource,
} from '../modules/programs/node-conclusion';
import { createPostgresNodeConclusionContext } from '../modules/programs/node-conclusions/postgres';
import { createPostgresNodeConclusionStore } from '../modules/programs/node-conclusions/store';
import { createNodeConclusionUsecase } from './node-conclusion';
import { ForbiddenError } from './project-context';
import {
  readLockedRecordLedger,
  type NativeRecordLedger,
} from './record-ledger';

type Confirmation = Extract<
  NodeScoreAuthority,
  { status: 'ready' }
>['confirmations'][number];
type Issue = {
  code:
    | 'native_ownership_unverified'
    | 'accepted_decision_unverified'
    | 'suggestion_unverified'
    | 'source_unavailable'
    | 'anchor_unverified'
    | 'review_unverified'
    | 'review_pending'
    | 'review_resolution_unverified'
    | 'confirmation_scope_not_recorded';
  eventId?: string;
  confirmationId?: string;
  reviewId?: string;
};
export interface NativeNodeConclusionEvidence extends NodeConclusionIdentity {
  /** Fact digest only, never an authorization token or a completion claim. */
  revision: string;
  confirmations: Confirmation[];
  status: 'unavailable' | 'pending';
  issues: Issue[];
}

function identityOf(value: NodeConclusionIdentity): NodeConclusionIdentity {
  return { evaluationNodeId: value.evaluationNodeId, personId: value.personId };
}

async function lockAuthority(tx: Transaction) {
  await tx.execute(sql`lock table ${accountBindings}, ${grants}, ${people}, ${organizations},
    ${enrollments}, ${assignments}, ${evaluationNodes}, ${evaluationNodeSubjects},
    ${evaluationRelations}, ${projects}, ${members} in share mode`);
}
function sourceKey(reference: {
  fragmentId: string;
  originalVersionId: string;
}) {
  return JSON.stringify([reference.fragmentId, reference.originalVersionId]);
}
/** Uses the complete canonical graph from the shared ledger, not client subjects. */
function resolveReferences(
  ledger: NativeRecordLedger,
  references: MaterialSourceReference[],
): ResolvedNodeConclusionSource[] | null {
  const sources = new Map<string, TalentSource>();
  for (const event of ledger.events) {
    if (event.sources.availability !== 'available') continue;
    for (const source of event.sources.fact)
      sources.set(sourceKey(source), source);
  }
  const resolved: ResolvedNodeConclusionSource[] = [];
  for (const reference of references) {
    const source = sources.get(sourceKey(reference));
    if (
      !source ||
      !source.subjects.length ||
      source.subjects.some((subject) => !subject.evaluationNodeId)
    )
      return null;
    const actual = materialSourceReferenceSchema.safeParse({
      fragmentId: source.fragmentId,
      originalVersionId: source.originalVersionId,
      location: source.location,
    });
    if (
      !actual.success ||
      nodeConclusionReferenceKey(actual.data) !==
        nodeConclusionReferenceKey(reference)
    )
      return null;
    resolved.push({
      reference: actual.data,
      subjects: source.subjects.map((subject) => ({
        personId: subject.personId,
        evaluationNodeId: subject.evaluationNodeId!,
      })),
      kind: source.kind,
      requiredKinds: source.requiredKinds ?? [],
    });
  }
  return resolved;
}
async function evidence(
  tx: Transaction,
  ledger: NativeRecordLedger,
): Promise<NativeNodeConclusionEvidence> {
  const confirmations: Confirmation[] = [];
  const issues: Issue[] = [];
  const node = ledger.context.evaluationNodes.find(
    (node) => node.id === ledger.target.evaluationNodeId,
  )!;
  for (const entry of ledger.events) {
    if (entry.event.withdrawnAt !== null) continue;
    for (const confirmation of entry.confirmations) {
      const row = confirmation.row;
      if (!row.active) continue;
      const issue = (code: Issue['code']) =>
        issues.push({ code, eventId: entry.event.id, confirmationId: row.id });
      if (
        entry.provenance.availability !== 'available' ||
        confirmation.ownership.availability !== 'available'
      ) {
        issue('native_ownership_unverified');
        continue;
      }
      if (confirmation.acceptedDecision.availability !== 'available') {
        issue('accepted_decision_unverified');
        continue;
      }
      if (confirmation.suggestion.availability !== 'available') {
        issue('suggestion_unverified');
        continue;
      }
      const decision = confirmation.acceptedDecision.fact;
      const draft = confirmation.suggestion.fact.originalDraftScore;
      if (
        row.status !== 'scored' ||
        !row.evaluatorId ||
        !row.confirmedAt ||
        draft.state !== 'suggested' ||
        (decision.action !== 'confirm' && decision.action !== 'edit') ||
        row.value !==
          (decision.action === 'edit' ? decision.value : draft.value)
      ) {
        issue('accepted_decision_unverified');
        continue;
      }
      if (entry.sources.availability !== 'available') {
        issue('source_unavailable');
        continue;
      }
      const references = draft.citations.map((citation) => citation.reference);
      const visible = projectTalentRecord(
        ledger.context,
        {
          id: row.id,
          subject: { ...ledger.target, cohortId: node.cohortId },
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
      if (
        !visible ||
        visible.fields.evidence !== true ||
        draft.citations.some((citation) => {
          const source = visible.sources.find(
            (source) => sourceKey(source) === sourceKey(citation.reference),
          );
          const actual =
            source &&
            materialSourceReferenceSchema.safeParse({
              fragmentId: source.fragmentId,
              originalVersionId: source.originalVersionId,
              location: source.location,
            });
          return (
            !source ||
            !source.excerpt.includes(citation.quote) ||
            !actual ||
            !actual.success ||
            nodeConclusionReferenceKey(actual.data) !==
              nodeConclusionReferenceKey(citation.reference)
          );
        })
      ) {
        issue('source_unavailable');
        continue;
      }
      const [anchor] = await tx
        .select()
        .from(anchors)
        .where(
          and(
            eq(anchors.id, row.anchorId!),
            eq(anchors.dimensionId, row.dimensionId),
            eq(anchors.ruleVersionId, row.ruleVersionId),
            eq(anchors.value, row.value!),
          ),
        )
        .for('share');
      if (!anchor) {
        issue('anchor_unverified');
        continue;
      }
      confirmations.push({
        confirmationId: row.id,
        evaluatorId: row.evaluatorId,
        version: row.revision,
        confirmedAt: row.confirmedAt.toISOString(),
      });
    }
    for (const review of entry.reviews) {
      if (review.row.withdrawnAt !== null) continue;
      const code =
        review.ownership.availability !== 'available'
          ? 'review_unverified'
          : review.row.status === 'open'
            ? 'review_pending'
            : 'review_resolution_unverified';
      // A status change alone is not a verified calibration/closure receipt.
      issues.push({ code, eventId: entry.event.id, reviewId: review.row.id });
    }
  }
  // ca0 has exact saved facts but deliberately no all-judges completion proof.
  // Current relations, active row counts and completed tasks cannot create one.
  issues.push({ code: 'confirmation_scope_not_recorded' });
  confirmations.sort((a, b) =>
    a.confirmationId.localeCompare(b.confirmationId),
  );
  return {
    ...ledger.target,
    revision: ledger.revision,
    confirmations,
    status: issues.some((issue) => issue.code === 'review_pending')
      ? 'pending'
      : 'unavailable',
    issues,
  };
}

/** Actual native read/confirm composition. There is no injectable ready callback.
 * Until the authoritative completion scope is supplied, new confirmation fails
 * closed; historical reads/replays still use current complete source authority.
 */
export function createNativeNodeConclusionUsecase(
  db: Database,
  options: { environment: string; wallNow?: () => Date },
) {
  const wallNow = options.wallNow ?? (() => new Date());
  const clock = createClock(options.environment, wallNow);
  const context = createPostgresNodeConclusionContext(db);
  const store = createPostgresNodeConclusionStore(db);
  async function locked<T>(
    accountId: string,
    identity: NodeConclusionIdentity,
    run: (tx: Transaction, ledger: NativeRecordLedger) => Promise<T>,
  ) {
    try {
      return await db.transaction(
        async (tx) => {
          // Global ledger fence first, then current authority, then operation/identity.
          // No nested transaction, repeatable-read snapshot, or external call.
          await readLockedRecordLedger(tx, identity, {
            accountId,
            now: () => clock.now().toISOString(),
          });
          await lockAuthority(tx);
          const ledger = await readLockedRecordLedger(tx, identity, {
            accountId,
            now: () => clock.now().toISOString(),
          });
          return run(tx, ledger);
        },
        { isolationLevel: 'read committed' },
      );
    } catch (error) {
      if (error instanceof NodeConclusionError) throw error;
      if (error instanceof ForbiddenError)
        throw new NodeConclusionError('forbidden', '当前身份不可用');
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (
        typeof cause === 'object' &&
        cause !== null &&
        'code' in cause &&
        ['23505', '23503', '23514', '40001', '40P01'].includes(
          String(cause.code),
        )
      )
        throw new NodeConclusionError('conflict', '节点结论事实已变化');
      throw new Error('节点结论存储不可用');
    }
  }
  function command(accountId: string, identity: NodeConclusionIdentity) {
    const facts = new WeakMap<Transaction, NativeRecordLedger>();
    return createNodeConclusionUsecase<Transaction>({
      ...context,
      ...store,
      environment: options.environment,
      wallNow,
      newId: randomUUID,
      transaction: (run) =>
        locked(accountId, identity, async (tx, ledger) => {
          facts.set(tx, ledger);
          return run(tx);
        }),
      readScoreConfirmations: async (tx, target) => {
        const result = await evidence(tx, facts.get(tx)!);
        return { ...target, status: result.status };
      },
      resolveSources: async (tx, _account, target, references) => {
        const ledger = await readLockedRecordLedger(tx, target, {
          accountId,
          now: () => clock.now().toISOString(),
        });
        return resolveReferences(ledger, references);
      },
    });
  }
  return {
    async inspect(accountId: string, raw: unknown) {
      const identity = identityOf(readNodeConclusionInputSchema.parse(raw));
      return locked(accountId, identity, async (tx, ledger) => {
        const loaded = await context.loadAuthorization(
          tx,
          accountId,
          clock.now().toISOString(),
        );
        if (!canConfirmNodeConclusion(loaded.context, identity))
          throw new NodeConclusionError(
            'forbidden',
            '仅范围内HR可检查结论确认依据',
          );
        return evidence(tx, ledger);
      });
    },
    async confirm(accountId: string, raw: unknown) {
      const parsed = confirmNodeConclusionInputSchema.safeParse(raw);
      // Retain the original usecase's validation result without starting SQL.
      const identity = parsed.success
        ? identityOf(parsed.data)
        : { evaluationNodeId: 'invalid', personId: 'invalid' };
      return command(accountId, identity).confirm(accountId, raw);
    },
    async read(accountId: string, raw: unknown) {
      const parsed = readNodeConclusionInputSchema.safeParse(raw);
      const identity = parsed.success
        ? identityOf(parsed.data)
        : { evaluationNodeId: 'invalid', personId: 'invalid' };
      return command(accountId, identity).read(accountId, raw);
    },
  };
}
