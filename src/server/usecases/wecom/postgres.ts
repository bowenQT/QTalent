import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Database, Transaction } from '../../db/client';
import { accountBindings } from '../../modules/directory';
import { wecomMessages, wecomReceiptAttempts } from '../../modules/records';
import { wecomBindings } from '../../auth/entry/schema';
import {
  createEntryIdentityService,
  type EntryIdentity,
  type EntryIdentityService,
} from '../../auth/entry/identity';
import {
  createWecomEntryAuthenticator,
  type VerifiedWecomSender,
} from '../../auth/entry/persistent';
import type { WecomMessage } from '../../integrations/wecom/protocol';
import type { createWecomClient } from '../../integrations/wecom/client';
import type { WecomBatchReceipt } from '../../integrations/wecom/receipts';
import type { MaterialBatchReceipt } from '../../../contracts/materials';
import {
  ArrangeModelInputBudgetExceeded,
  readArrangeJobRecord,
  type createRecordBatchArrangeRequests,
} from '../record-batch-arrange-requests';
import { parseBatchMetadata } from '../record-batch-arrange-state';
import { recordEntryAudit } from '../entry/audit';
import { entryFailure, EntryUsecaseError } from '../entry/context';
import {
  describeWecomDelivery,
  describeWecomReceipt,
  planWecomReceiptAttempt,
  WecomDeliveryConflict,
  type WecomReceiptFact,
} from './message';
import { prepareWecomTextBatch } from './receiver';

type MessageRow = typeof wecomMessages.$inferSelect;
type Actor = Awaited<ReturnType<EntryIdentityService['current']>>;
type ReceiptKind = 'group_ack' | 'private_receipt';
type Failure = ReturnType<typeof entryFailure>;
type Accepted = {
  status: 'accepted';
  replayed: boolean;
  messageKey: string;
  batchId: string;
};
type Delivery =
  { status: 'acknowledged' | 'outcome_unknown' | 'not_applicable' } | Failure;
export type WecomPostgresDependencies = {
  db: Database;
  requests: ReturnType<typeof createRecordBatchArrangeRequests>;
  now(): Date;
  notifications?: {
    /** The actual authenticated client state, not a supplied sender. */
    connection(): Readonly<{ scope: string; botId: string }> | null;
    send(receiptKey: string): Promise<void>;
  };
  /** Installed by the server's verified, live WS closure, never by request JSON.
   * Must return null once that connection/proof is no longer valid. */
  verifiedSender(message: WecomMessage): Promise<VerifiedWecomSender | null>;
  sender: Pick<
    ReturnType<typeof createWecomClient>,
    'acknowledgeGroup' | 'sendPrivateReceipt'
  >;
};
function failure(error: unknown): Failure {
  if (
    error instanceof ArrangeModelInputBudgetExceeded ||
    error instanceof ZodError
  )
    return { status: 'validation_error' };
  if (error instanceof WecomDeliveryConflict) return { status: 'conflict' };
  return entryFailure(error);
}
function safeReceipt(receipt: MaterialBatchReceipt): WecomBatchReceipt | null {
  if (receipt.status === 'completed') return null;
  // Never forward the internal receipt (people, hidden flag/counts, drafts).
  return {
    batchId: receipt.batchId,
    revision: receipt.revision,
    status: receipt.status,
  };
}
/** Real persistent receiver. All mutations use the caller-owned transaction;
 * the existing producer remains the sole source/job/model pipeline. */
export function createWecomPostgresReceiver(deps: WecomPostgresDependencies) {
  async function identityFor(message: WecomMessage) {
    const identities = createEntryIdentityService(
      {
        wecom: createWecomEntryAuthenticator(
          deps.db,
          async () => {
            const proof = await deps.verifiedSender(message);
            return proof &&
              proof.scope === message.source.scope &&
              proof.botId === message.source.botId &&
              proof.senderId === message.source.senderId
              ? proof
              : null;
          },
          deps.now,
        ),
      },
      deps.now,
    );
    const identity = await identities.authenticate('wecom', message);
    return { identities, identity };
  }
  async function lockMessage(tx: Transaction, key: string) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'qtalent:wecom:message:' + key}, 0))`,
    );
    const [row] = await tx
      .select()
      .from(wecomMessages)
      .where(eq(wecomMessages.key, key))
      .for('update');
    return row;
  }
  async function lockedActor(
    tx: Transaction,
    identities: EntryIdentityService,
    identity: EntryIdentity,
  ) {
    const before = await identities.current(identity);
    await tx
      .select({ id: wecomBindings.id })
      .from(wecomBindings)
      .where(eq(wecomBindings.id, before.credentialId))
      .for('share');
    await tx
      .select({ id: accountBindings.accountId })
      .from(accountBindings)
      .where(eq(accountBindings.accountId, before.accountId))
      .for('share');
    // Re-read after any credential/directory lock wait. Pool reader sees current
    // committed facts; held SHARE locks prevent a rebind until this tx completes.
    return identities.current(identity);
  }
  function sameActor(row: MessageRow, actor: Actor) {
    if (
      row.actorAccountId !== actor.accountId ||
      row.actorPersonId !== actor.personId ||
      row.credentialId !== actor.credentialId ||
      row.credentialRevision !== actor.credentialRevision
    )
      throw new EntryUsecaseError('not_found');
  }
  async function actualReceipt(tx: Transaction, row: MessageRow, actor: Actor) {
    sameActor(row, actor);
    if (!row.jobId || !row.inputId || !row.batchId)
      throw new EntryUsecaseError('unavailable');
    const job = await readArrangeJobRecord(tx, row.jobId, true);
    if (!job) throw new EntryUsecaseError('not_found');
    const input = await deps.requests.native.inputForJob(tx, job);
    if (
      !input ||
      input.id !== row.inputId ||
      input.batchId !== row.batchId ||
      input.jobId !== row.jobId ||
      !(await deps.requests.native.authorized(tx, actor.accountId, job, input))
    )
      throw new EntryUsecaseError('not_found');
    const metadata = parseBatchMetadata(job.result);
    if (!metadata) throw new EntryUsecaseError('unavailable');
    return deps.requests.native.receipt(tx, job, input, metadata);
  }
  async function receive(
    message: WecomMessage,
    serverTarget: unknown,
  ): Promise<Accepted | Failure | { status: 'unavailable'; reason: string }> {
    try {
      const descriptor = describeWecomDelivery(message);
      const auth = await identityFor(message);
      const prepared = prepareWecomTextBatch(message, serverTarget);
      if (prepared.status !== 'ready') return prepared;
      return await deps.db.transaction(async (tx) => {
        const old = await lockMessage(tx, descriptor.key);
        const actor = await lockedActor(tx, auth.identities, auth.identity);
        if (old) {
          await actualReceipt(tx, old, actor);
          if (
            old.inputDigest !== descriptor.inputDigest ||
            old.evaluationNodeId !== prepared.input.evaluationNodeId ||
            old.projectId !== prepared.input.projectId ||
            JSON.stringify([...(old.personIds ?? [])].sort()) !==
              JSON.stringify([...prepared.input.personIds].sort())
          )
            throw new EntryUsecaseError('conflict');
        }
        // Its replay path rechecks current full subjects and authorization. A
        // non-success must escape the tx too: no partial receiver ledger/audit.
        const result = await deps.requests.createInTransaction(
          tx,
          actor.accountId,
          prepared.input,
        );
        if (result.status !== 'success')
          throw new EntryUsecaseError(result.status);
        if (old) {
          if (old.batchId !== result.result.batchId)
            throw new EntryUsecaseError('unavailable');
          await auth.identities.current(auth.identity);
          return {
            status: 'accepted',
            replayed: true,
            messageKey: old.key,
            batchId: old.batchId!,
          };
        }
        const jobId = result.result.jobId;
        const job = jobId && (await readArrangeJobRecord(tx, jobId, true));
        const input = job && (await deps.requests.native.inputForJob(tx, job));
        if (!job || !input || input.batchId !== result.result.batchId)
          throw new EntryUsecaseError('unavailable');
        const now = deps.now();
        await tx.insert(wecomMessages).values({
          key: descriptor.key,
          scope: message.source.scope,
          botId: message.source.botId,
          senderId: message.source.senderId,
          messageId: message.source.messageId,
          actorAccountId: actor.accountId,
          actorPersonId: actor.personId,
          credentialId: actor.credentialId,
          credentialRevision: actor.credentialRevision,
          inputDigest: descriptor.inputDigest,
          partCount: descriptor.partCount,
          evaluationNodeId: input.evaluationNodeId,
          personIds: [...input.personIds],
          projectId: input.projectId,
          collectionId: null,
          archiveRefs: [],
          inputId: input.id,
          batchId: input.batchId,
          jobId: job.jobId,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });
        await recordEntryAudit(tx, {
          actorId: actor.accountId,
          channel: 'wecom',
          action: 'wecom.message.accept',
          resourceId: result.result.batchId,
          revision: result.result.revision,
        });
        await auth.identities.current(auth.identity);
        return {
          status: 'accepted',
          replayed: false,
          messageKey: descriptor.key,
          batchId: result.result.batchId,
        };
      });
    } catch (error) {
      return failure(error);
    }
  }
  async function reserve(
    tx: Transaction,
    messageKey: string,
    kind: ReceiptKind,
    actor: Actor,
    safe: WecomBatchReceipt | null,
  ) {
    const value =
      kind === 'group_ack'
        ? { kind: 'group_ack' as const }
        : safe
          ? { kind: 'private_receipt' as const, ...safe }
          : null;
    if (!value) return { status: 'not_applicable' as const };
    const fact = describeWecomReceipt(messageKey, value);
    const [previous] = await tx
      .select()
      .from(wecomReceiptAttempts)
      .where(eq(wecomReceiptAttempts.key, fact.key))
      .for('update');
    const plan = planWecomReceiptAttempt(
      previous
        ? { fingerprint: previous.fingerprint, state: previous.state }
        : null,
      fact.fingerprint,
    );
    if (plan !== 'reserve') return { status: plan };
    await tx.insert(wecomReceiptAttempts).values({
      key: fact.key,
      messageKey,
      kind,
      batchId: kind === 'private_receipt' ? safe!.batchId : null,
      batchRevision: kind === 'private_receipt' ? safe!.revision : null,
      batchStatus: kind === 'private_receipt' ? safe!.status : null,
      fingerprint: fact.fingerprint,
      state: 'reserved',
      attemptedAt: deps.now(),
    });
    await recordEntryAudit(tx, {
      actorId: actor.accountId,
      channel: 'wecom',
      action: 'wecom.receipt.reserve',
      resourceId: safe?.batchId ?? null,
      revision: safe?.revision ?? null,
    });
    return { status: 'reserved' as const, fact, safe };
  }
  async function acknowledgeReserved(key: string) {
    const rows = await deps.db
      .update(wecomReceiptAttempts)
      .set({ state: 'acknowledged', acknowledgedAt: deps.now() })
      .where(
        and(
          eq(wecomReceiptAttempts.key, key),
          eq(wecomReceiptAttempts.state, 'reserved'),
        ),
      )
      .returning({ key: wecomReceiptAttempts.key });
    if (rows.length !== 1) throw new EntryUsecaseError('unavailable');
  }
  async function markUnknown(key: string) {
    try {
      await deps.db
        .update(wecomReceiptAttempts)
        .set({ state: 'outcome_unknown' })
        .where(
          and(
            eq(wecomReceiptAttempts.key, key),
            eq(wecomReceiptAttempts.state, 'reserved'),
          ),
        );
    } catch {
      /* Durable reserved itself prevents resend if this update fails. */
    }
  }
  async function deliver(
    message: WecomMessage,
    kind: ReceiptKind,
  ): Promise<Delivery> {
    let reservedKey: string | undefined;
    try {
      if (kind === 'group_ack' && message.source.chatType !== 'group')
        throw new EntryUsecaseError('validation_error');
      const descriptor = describeWecomDelivery(message);
      const auth = await identityFor(message);
      async function current(tx: Transaction) {
        const row = await lockMessage(tx, descriptor.key);
        const actor = await lockedActor(tx, auth.identities, auth.identity);
        if (!row) throw new EntryUsecaseError('not_found');
        const receipt = await actualReceipt(tx, row, actor);
        if (row.inputDigest !== descriptor.inputDigest)
          throw new EntryUsecaseError('conflict');
        const safe = safeReceipt(receipt);
        const fact =
          kind === 'group_ack'
            ? { kind: 'group_ack' as const }
            : safe
              ? { kind: 'private_receipt' as const, ...safe }
              : null;
        return {
          actor,
          safe,
          fact: fact && describeWecomReceipt(row.key, fact),
        };
      }
      const reservation = await deps.db.transaction(async (tx) => {
        const data = await current(tx);
        const result = await reserve(
          tx,
          descriptor.key,
          kind,
          data.actor,
          data.safe,
        );
        await auth.identities.current(auth.identity);
        return result;
      });
      if (reservation.status !== 'reserved') return reservation;
      reservedKey = reservation.fact.key;
      // Reservation has committed. Recheck identity, complete source authority
      // and current batch status before crossing the external send boundary.
      await deps.db.transaction(async (tx) => {
        const data = await current(tx);
        if (
          data.fact?.key !== reservation.fact.key ||
          data.fact.fingerprint !== reservation.fact.fingerprint
        )
          throw new EntryUsecaseError('conflict');
        await auth.identities.current(auth.identity);
      });
      if (kind === 'group_ack') await deps.sender.acknowledgeGroup(message);
      else await deps.sender.sendPrivateReceipt(message, reservation.safe!);
      await acknowledgeReserved(reservedKey);
      return { status: 'acknowledged' };
    } catch (error) {
      if (!reservedKey) return failure(error);
      // DB failure after a real ACK also remains unknown; do not return success
      // or retry. If this write fails, durable reserved itself prevents resend.
      await markUnknown(reservedKey);
      return { status: 'outcome_unknown' };
    }
  }
  async function canSend(
    message: WecomMessage,
    expected: WecomReceiptFact,
  ): Promise<boolean> {
    try {
      const descriptor = describeWecomDelivery(message);
      if (expected.kind === 'group_ack' && message.source.chatType !== 'group')
        return false;
      const auth = await identityFor(message);
      return await deps.db.transaction(async (tx) => {
        const row = await lockMessage(tx, descriptor.key);
        const actor = await lockedActor(tx, auth.identities, auth.identity);
        if (!row) return false;
        const receipt = safeReceipt(await actualReceipt(tx, row, actor));
        if (row.inputDigest !== descriptor.inputDigest) return false;
        const actual =
          expected.kind === 'group_ack'
            ? { kind: 'group_ack' as const }
            : receipt
              ? { kind: 'private_receipt' as const, ...receipt }
              : null;
        if (!actual) return false;
        await auth.identities.current(auth.identity);
        return (
          describeWecomReceipt(row.key, actual).fingerprint ===
          describeWecomReceipt(row.key, expected).fingerprint
        );
      });
    } catch {
      return false;
    }
  }
  function liveConnection(row?: MessageRow) {
    const connection = deps.notifications?.connection();
    if (!connection) throw new EntryUsecaseError('unavailable');
    if (
      row &&
      (connection.scope !== row.scope || connection.botId !== row.botId)
    )
      throw new EntryUsecaseError('not_found');
    return connection;
  }
  async function storedIdentity(row: MessageRow) {
    liveConnection(row);
    const identities = createEntryIdentityService(
      {
        wecom: createWecomEntryAuthenticator(
          deps.db,
          async () => {
            liveConnection(row);
            return {
              scope: row.scope,
              botId: row.botId,
              senderId: row.senderId,
            };
          },
          deps.now,
        ),
      },
      deps.now,
    );
    const identity = await identities.authenticate('wecom', row.key);
    return { identities, identity };
  }
  /** The protocol resolver calls this only for the private in-flight reservation.
   * No message reconstruction, callback request ID, or old transport proof. */
  async function resolvePersistedReceipt(key: string) {
    try {
      if (!/^[a-f0-9]{64}$/.test(key)) return null;
      liveConnection();
      const [lookup] = await deps.db
        .select({ messageKey: wecomReceiptAttempts.messageKey })
        .from(wecomReceiptAttempts)
        .where(eq(wecomReceiptAttempts.key, key));
      if (!lookup) return null;
      return await deps.db.transaction(async (tx) => {
        const row = await lockMessage(tx, lookup.messageKey);
        if (!row) return null;
        const auth = await storedIdentity(row);
        const actor = await lockedActor(tx, auth.identities, auth.identity);
        const safe = safeReceipt(await actualReceipt(tx, row, actor));
        if (!safe) return null;
        const fact = describeWecomReceipt(row.key, {
          kind: 'private_receipt',
          ...safe,
        });
        const [attempt] = await tx
          .select()
          .from(wecomReceiptAttempts)
          .where(eq(wecomReceiptAttempts.key, key))
          .for('update');
        if (
          !attempt ||
          attempt.state !== 'reserved' ||
          attempt.kind !== 'private_receipt' ||
          key !== fact.key ||
          attempt.fingerprint !== fact.fingerprint
        )
          return null;
        await auth.identities.current(auth.identity);
        liveConnection(row);
        return { senderId: row.senderId, receipt: safe };
      });
    } catch {
      return null;
    }
  }
  /** One bounded keyset page. Caller schedules the next page/cycle in the
   * existing worker lifecycle; this never creates a job or invokes the model. */
  async function notifyPending(
    after?: string,
  ): Promise<{ status: 'success'; nextCursor: string | null } | Failure> {
    try {
      if (after !== undefined && !/^[a-f0-9]{64}$/.test(after))
        throw new EntryUsecaseError('validation_error');
      const connection = liveConnection();
      const rows = await deps.db
        .select({ key: wecomMessages.key })
        .from(wecomMessages)
        .where(
          and(
            eq(wecomMessages.scope, connection.scope),
            eq(wecomMessages.botId, connection.botId),
            isNotNull(wecomMessages.jobId),
            after === undefined ? undefined : gt(wecomMessages.key, after),
          ),
        )
        .orderBy(asc(wecomMessages.key))
        .limit(32);
      for (const candidate of rows) {
        let reservation;
        try {
          reservation = await deps.db.transaction(async (tx) => {
            const row = await lockMessage(tx, candidate.key);
            if (!row) return null;
            const auth = await storedIdentity(row);
            const actor = await lockedActor(tx, auth.identities, auth.identity);
            const safe = safeReceipt(await actualReceipt(tx, row, actor));
            const result = await reserve(
              tx,
              row.key,
              'private_receipt',
              actor,
              safe,
            );
            await auth.identities.current(auth.identity);
            liveConnection(row);
            return result;
          });
        } catch (error) {
          // Unreadable rows are skipped without disclosing identities/counts.
          // Infrastructure failure aborts the page so the caller retries its cursor.
          if (
            ['not_found', 'forbidden', 'unauthenticated'].includes(
              failure(error).status,
            )
          )
            continue;
          throw error;
        }
        if (reservation?.status !== 'reserved') continue;
        try {
          await deps.notifications!.send(reservation.fact.key);
          await acknowledgeReserved(reservation.fact.key);
        } catch {
          await markUnknown(reservation.fact.key);
          // Stop this page on uncertain transmission. Resuming cannot resend it.
          throw new EntryUsecaseError('unavailable');
        }
      }
      liveConnection();
      return {
        status: 'success',
        nextCursor: rows.length === 32 ? rows[31]!.key : null,
      };
    } catch (error) {
      return failure(error);
    }
  }
  return { receive, deliver, canSend, notifyPending, resolvePersistedReceipt };
}
