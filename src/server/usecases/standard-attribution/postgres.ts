import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { comparisonTableRowSchema } from '../../../contracts/judgment-comparison';
import {
  confirmedStandardAttributionSchema,
  standardAttributionHypothesisSchema,
  createGroundedStandardHypothesisSchema,
  confirmStandardAttributionResultSchema,
  generateStandardHypothesesResultSchema,
} from '../../../contracts/standard-attribution';
import type { Database, Transaction } from '../../db/client';
import { accountBindings } from '../../modules/directory';
import {
  attributionHypotheses,
  standardAttributions,
  selectionDraftProposals,
  attributionOperations,
} from '../../modules/evaluation-system';
import { recordAudit } from '../../platform/audit';
import {
  draftSelectionProposalResultSchema,
  selectionDraftProposalSchema,
} from './hypotheses';
import {
  createAttributionReadAdapter,
  type AttributionReadServices,
} from './read-adapter';
import type {
  AttributionPorts,
  AttributionOperation,
  HrAttributionBatch,
  SelectionDraftProposal,
} from './ports';

declare const transactionBrand: unique symbol;
export type AttributionTransaction = Readonly<{
  db: Transaction;
  [transactionBrand]: true;
}>;
export class AttributionPersistenceError extends Error {
  constructor(readonly kind: 'conflict' | 'forbidden' | 'unavailable') {
    super(
      kind === 'conflict'
        ? '归因操作或版本已变化'
        : kind === 'forbidden'
          ? '当前身份无法执行归因操作'
          : '归因存储不可用',
    );
  }
}
const text = z.string().trim().min(1);
const operationSchema = z
  .intersection(
    z.strictObject({
      fingerprint: text,
      evidenceFingerprint: text,
      reservationId: text,
      state: z.enum(['pending', 'finished']),
      result: z.unknown().optional(),
      modelRequestId: text.optional(),
    }),
    z.discriminatedUnion('state', [
      z.object({ state: z.literal('pending') }),
      z.object({ state: z.literal('finished'), result: z.unknown() }),
    ]),
  )
  .superRefine((v, ctx) => {
    if (
      v.state === 'pending'
        ? 'result' in v || 'modelRequestId' in v
        : v.result === undefined || v.result === null
    )
      ctx.addIssue({ code: 'custom', message: '操作状态和回执不一致' });
  });
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const x = a as Record<string, unknown>,
      y = b as Record<string, unknown>;
    return (
      Object.keys(x).length === Object.keys(y).length &&
      Object.keys(x).every((k) => Object.hasOwn(y, k) && same(x[k], y[k]))
    );
  }
  return Object.is(a, b);
};
type Effect = {
  action: 'hypotheses' | 'confirm' | 'draft';
  batchId: string;
  value: unknown;
};
type State = {
  active: boolean;
  accountId: string;
  operationId: string;
  personId: string;
  batches: Map<string, HrAttributionBatch>;
  drafts: Map<string, { attribution: unknown; standard: unknown }>;
  effect?: Effect;
  audited: boolean;
  written: boolean;
};
const conflict = (): never => {
  throw new AttributionPersistenceError('conflict');
};
function referencesMatch(
  batch: HrAttributionBatch,
  citations: {
    caseId: string;
    side: 'front' | 'back';
    nodeId: string;
    standardVersionId: string;
    row: unknown;
  }[],
) {
  return citations.every((c) => {
    const unit = batch.candidates.find(
      (v) => v.id === c.caseId && batch.authorizedCaseIds.includes(v.id),
    );
    const stage = unit?.[c.side];
    return (
      stage?.state === 'present' &&
      c.nodeId === stage.judgment.nodeId &&
      c.standardVersionId === stage.judgment.standardVersionId &&
      same(
        comparisonTableRowSchema.parse(c.row),
        comparisonTableRowSchema.parse(stage.judgment.row),
      )
    );
  });
}

/** Concrete four-table persistence. Canonical facts/selection content have no default reader. */
export function createAttributionPostgresStore(
  db: Database,
  services: AttributionReadServices,
  options: { now?: () => Date } = {},
): AttributionPorts<AttributionTransaction> {
  const reader = createAttributionReadAdapter(services);
  const now = options.now ?? (() => new Date());
  const states = new WeakMap<AttributionTransaction, State>();
  function state(
    tx: AttributionTransaction,
    accountId?: string,
    operationId?: string,
  ) {
    const s = states.get(tx);
    if (
      !s?.active ||
      (accountId !== undefined && s.accountId !== accountId) ||
      (operationId !== undefined && s.operationId !== operationId)
    )
      throw new AttributionPersistenceError('forbidden');
    return s;
  }
  function batch(tx: AttributionTransaction, id: string) {
    const s = state(tx),
      b = s.batches.get(id);
    if (!b || b.actor.id !== s.personId)
      throw new AttributionPersistenceError('forbidden');
    return b;
  }
  function effect(tx: AttributionTransaction, item: Effect) {
    const s = state(tx);
    if (s.effect || s.written || s.audited) conflict();
    s.effect = item;
  }
  async function operationRow(tx: AttributionTransaction) {
    const s = state(tx);
    const [row] = await tx.db
      .select()
      .from(attributionOperations)
      .where(
        and(
          eq(attributionOperations.accountId, s.accountId),
          eq(attributionOperations.operationId, s.operationId),
        ),
      )
      .for('update');
    if (row && row.actorPersonId !== s.personId)
      throw new AttributionPersistenceError('forbidden');
    return row;
  }
  return {
    async transaction(accountId, operationId, work) {
      text.parse(accountId);
      text.parse(operationId);
      return db.transaction(
        async (raw) => {
          await raw.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['standard-attribution', accountId, operationId])}, 0))`,
          );
          const [binding] = await raw
            .select()
            .from(accountBindings)
            .where(eq(accountBindings.accountId, accountId))
            .for('share');
          if (!binding || binding.isSystemAdmin)
            throw new AttributionPersistenceError('forbidden');
          const tx = Object.freeze({ db: raw }) as AttributionTransaction;
          const s: State = {
            active: true,
            accountId,
            operationId,
            personId: binding.personId,
            batches: new Map(),
            drafts: new Map(),
            audited: false,
            written: false,
          };
          states.set(tx, s);
          try {
            const result = await work(tx);
            if (s.effect && (!s.audited || !s.written)) conflict();
            return result;
          } finally {
            s.active = false;
          }
        },
        { isolationLevel: 'read committed' },
      );
    },
    async loadHrBatch(tx, accountId, batchId, at) {
      const s = state(tx, accountId);
      const b = await reader.loadHrBatch(tx.db, accountId, batchId, at);
      s.batches.delete(batchId);
      if (!b || b.actor.id !== s.personId) return null;
      s.batches.set(batchId, b);
      return b;
    },
    async loadDraftContext(tx, accountId, attributionId, baseVersionId, at) {
      const s = state(tx, accountId);
      // Only batch routing metadata is read before authorization, never returned.
      const [route] = await tx.db
        .select({ batchId: standardAttributions.batchId })
        .from(standardAttributions)
        .where(eq(standardAttributions.id, attributionId));
      if (!route) return null;
      const b = await this.loadHrBatch(tx, accountId, route.batchId, at);
      if (!b) return null;
      const [row] = await tx.db
        .select()
        .from(standardAttributions)
        .where(
          and(
            eq(standardAttributions.id, attributionId),
            eq(standardAttributions.batchId, b.batchId),
          ),
        );
      if (!row) return null;
      const attribution = confirmedStandardAttributionSchema.parse(row.payload);
      if (
        attribution.id !== attributionId ||
        attribution.revision !== row.revision ||
        !referencesMatch(b, attribution.citations)
      )
        return null;
      const standard = await reader.readStandard(tx.db, baseVersionId);
      if (!standard) return null;
      const freshBatch = await this.loadHrBatch(
        tx,
        accountId,
        route.batchId,
        at,
      );
      if (!freshBatch || !referencesMatch(freshBatch, attribution.citations))
        return null;
      s.drafts.set(JSON.stringify([attributionId, baseVersionId]), {
        attribution,
        standard,
      });
      return { batch: freshBatch, attribution, standard };
    },
    async readHypothesis(tx, batchId, hypothesisId) {
      const b = batch(tx, batchId);
      const [row] = await tx.db
        .select()
        .from(attributionHypotheses)
        .where(
          and(
            eq(attributionHypotheses.id, hypothesisId),
            eq(attributionHypotheses.batchId, batchId),
          ),
        );
      if (!row) return null;
      const value = standardAttributionHypothesisSchema.parse(row.payload);
      return referencesMatch(b, value.citations) ? value : null;
    },
    async readOperation(tx, accountId, operationId) {
      state(tx, accountId, operationId);
      const row = await operationRow(tx);
      if (!row) return null;
      return operationSchema.parse({
        fingerprint: row.fingerprint,
        evidenceFingerprint: row.evidenceFingerprint,
        reservationId: row.reservationId,
        state: row.state,
        ...(row.state === 'finished'
          ? {
              result: row.result,
              ...(row.modelRequestId
                ? { modelRequestId: row.modelRequestId }
                : {}),
            }
          : {}),
      }) as AttributionOperation;
    },
    async writeOperation(tx, accountId, operationId, input) {
      const s = state(tx, accountId, operationId);
      if (s.written) conflict();
      const value = operationSchema.parse(input);
      const existing = await operationRow(tx);
      if (
        existing &&
        (existing.state !== 'pending' ||
          value.state !== 'finished' ||
          existing.reservationId !== value.reservationId ||
          existing.fingerprint !== value.fingerprint ||
          existing.evidenceFingerprint !== value.evidenceFingerprint)
      )
        conflict();
      if (value.state === 'pending') {
        if (s.effect || s.audited || s.batches.size === 0) conflict();
      } else {
        const outcome = z
          .union([
            generateStandardHypothesesResultSchema,
            confirmStandardAttributionResultSchema,
            draftSelectionProposalResultSchema,
          ])
          .parse(value.result);
        if (outcome.status === 'success') {
          if (!s.effect || !s.audited || !same(outcome.result, s.effect.value))
            conflict();
        } else if (s.effect || s.audited) conflict();
      }
      const writtenAt = now().toISOString();
      const finishedAt = value.state === 'finished' ? writtenAt : null;
      const fields = {
        state: value.state,
        result: value.state === 'finished' ? value.result : null,
        modelRequestId:
          value.state === 'finished' ? (value.modelRequestId ?? null) : null,
        finishedAt,
      };
      if (!existing) {
        await tx.db.insert(attributionOperations).values({
          accountId,
          operationId,
          actorPersonId: s.personId,
          fingerprint: value.fingerprint,
          evidenceFingerprint: value.evidenceFingerprint,
          reservationId: value.reservationId,
          createdAt: writtenAt,
          ...fields,
        });
      } else {
        const changed = await tx.db
          .update(attributionOperations)
          .set(fields)
          .where(
            and(
              eq(attributionOperations.accountId, accountId),
              eq(attributionOperations.operationId, operationId),
              eq(attributionOperations.actorPersonId, s.personId),
              eq(attributionOperations.state, 'pending'),
              eq(attributionOperations.reservationId, value.reservationId),
              eq(attributionOperations.fingerprint, value.fingerprint),
              eq(
                attributionOperations.evidenceFingerprint,
                value.evidenceFingerprint,
              ),
            ),
          )
          .returning({ id: attributionOperations.operationId });
        if (changed.length !== 1) conflict();
      }
      s.written = true;
    },
    async saveHypotheses(tx, values) {
      const s = state(tx);
      const batchIds = new Set(values.map((v) => v.batchId));
      if (batchIds.size > 1) conflict();
      const b = values.length
        ? batch(tx, values[0].batchId)
        : [...s.batches.values()].at(-1);
      if (!b) throw new AttributionPersistenceError('forbidden');
      const schema = createGroundedStandardHypothesisSchema(
        b.candidates.filter((v) => b.authorizedCaseIds.includes(v.id)),
      );
      const checked = values.map((v) => schema.parse(v));
      effect(tx, { action: 'hypotheses', batchId: b.batchId, value: checked });
      if (checked.length)
        await tx.db.insert(attributionHypotheses).values(
          checked.map((payload) => ({
            id: payload.id,
            batchId: payload.batchId,
            payload,
          })),
        );
    },
    async saveAttribution(tx, input) {
      const v = confirmedStandardAttributionSchema.parse(input),
        b = batch(tx, v.batchId);
      if (
        v.revision !== 1 ||
        !same(v.confirmedBy, b.actor) ||
        !referencesMatch(b, v.citations)
      )
        conflict();
      if (
        v.hypothesisId &&
        !(await this.readHypothesis(tx, v.batchId, v.hypothesisId))
      )
        conflict();
      effect(tx, { action: 'confirm', batchId: v.batchId, value: v });
      await tx.db.insert(standardAttributions).values({
        id: v.id,
        revision: v.revision,
        batchId: v.batchId,
        hypothesisId: v.hypothesisId,
        confirmedByPersonId: v.confirmedBy.id,
        confirmedAt: v.confirmedAt,
        payload: v,
      });
    },
    async saveProposal(tx, input: SelectionDraftProposal) {
      const v = selectionDraftProposalSchema.parse(input),
        s = state(tx);
      const context = s.drafts.get(
        JSON.stringify([v.attributionId, v.baseVersionId]),
      );
      const [stored] = await tx.db
        .select()
        .from(standardAttributions)
        .where(eq(standardAttributions.id, v.attributionId));
      if (
        !context ||
        !stored ||
        !same(v.aiDraft.basis, stored.payload) ||
        !same(context.attribution, stored.payload) ||
        !v.aiDraft.basis.categories.includes('evaluation_standard')
      )
        conflict();
      batch(tx, stored.batchId);
      effect(tx, { action: 'draft', batchId: stored.batchId, value: v });
      await tx.db.insert(selectionDraftProposals).values({
        id: v.id,
        attributionId: v.attributionId,
        attributionRevision: v.aiDraft.basis.revision,
        baseVersionId: v.baseVersionId,
        payload: v,
      });
    },
    async audit(tx, event) {
      const s = state(tx, event.accountId, event.operationId);
      if (
        s.audited ||
        !s.effect ||
        s.effect.action !== event.action ||
        s.effect.batchId !== event.batchId
      )
        conflict();
      // Shared audit_events.actor_id is the account across every flow; the
      // person signature stays on the attribution record itself.
      await recordAudit(tx.db, {
        actorId: s.accountId,
        action: 'standard_attribution.' + event.action,
        resourceId: event.batchId,
      });
      s.audited = true;
    },
  };
}
