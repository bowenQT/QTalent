import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database, Transaction } from '../db/client';
import {
  recordBatchDraftSetSchema,
  recordBatchDraftSchema,
  recordSaveReceiptSchema,
  type RecordBatchDraftSet,
} from '../../contracts/record';
import {
  materialBatchReceiptSchema,
  type MaterialBatchReceipt,
} from '../../contracts/materials';
import { createJobStore } from '../jobs/repository';
import type { JobStore, JobPolicy } from '../jobs/service';
import type { JobRecord } from '../jobs/state';
import { arrangeInputs } from '../modules/records/arrange/input-state/schema';
import type { StoredArrangeInput } from '../modules/records/arrange/input-state/schema';
import { lockArrangeInput } from '../modules/records/arrange/input-state/store';
import { readIntakeTable } from './talent-source-projection';
import {
  recordDraftBatches,
  recordDrafts,
  recordSaves,
  recordDraftEvents,
  storeTrustedRecordDraftBatch,
  reviseTrustedRecordDraftBatch,
  batchDigest,
} from '../modules/records';
import { readBatchArrangeRules } from '../modules/records/arrange/batch-rules';
import { projectBatchReceipt } from '../modules/records/arrange/batch-receipt';
import { MODELINK_MODEL } from '../integrations/maas';
import {
  loadArrangeActor,
  canWriteArrange,
  requireNativeInput,
  loadRecordBatchSnapshot,
  NativeArrangeUnavailable,
} from './record-arrange-context';
import {
  batchMetadataSchema,
  parseBatchMetadata,
  batchOperationFromJob,
  updateBatchJob,
  type BatchJobMetadata,
} from './record-batch-arrange-state';
import type {
  BatchArrangePorts,
  BatchArrangeCommit,
  BatchArrangeTransaction,
} from './record-batch-arrange';

export interface NativeBatchDependencies {
  db: Database;
  businessNow(): string;
  now(): Date;
  enqueue(tx: Transaction, job: JobRecord): Promise<void>;
  newId?(): string;
}
export async function readNativeDraftSet(
  tx: Transaction,
  batchId: string,
  expected: Pick<
    StoredArrangeInput,
    'creatorAccountId' | 'occurredOn' | 'originalInput'
  >,
): Promise<RecordBatchDraftSet | null> {
  const [batch] = await tx
    .select()
    .from(recordDraftBatches)
    .where(eq(recordDraftBatches.batchId, batchId))
    .for('update');
  if (!batch) return null;
  if (
    batch.createdByAccountId !== expected.creatorAccountId ||
    batch.occurredOn !== expected.occurredOn ||
    !isDeepStrictEqual(batch.originalInput, expected.originalInput)
  )
    throw new NativeArrangeUnavailable('native_batch_owner_or_source_changed');
  const drafts = await tx
    .select()
    .from(recordDrafts)
    .where(eq(recordDrafts.batchId, batchId))
    .orderBy(recordDrafts.draftId)
    .for('update');
  const raw = {
    batchId,
    revision: batch.revision,
    duplicateCandidates: batch.duplicateCandidates,
    drafts: drafts
      .map((row) => row.draft)
      .sort((a, b) => a.draftId.localeCompare(b.draftId)),
  };
  if (
    !recordBatchDraftSetSchema.safeParse(raw).success ||
    drafts.some(
      (row) =>
        row.draftId !== row.draft.draftId ||
        row.batchId !== row.draft.batchId ||
        row.revision !== row.draft.revision,
    )
  )
    throw new NativeArrangeUnavailable('native_draft_rows_invalid');
  return raw;
}
/** Preserve immutable producer metadata when842 clears a public result on retry.
 * This modifies the same locked job row, not a second status or operation store. */
function nativeJobStore(db: Database): JobStore<Transaction> {
  const base = createJobStore(db);
  return {
    locked: (jobId, run) =>
      base.locked(jobId, async (tx) => {
        let current = tx.record;
        return run({
          ...tx,
          save: async (next) => {
            const old = current && parseBatchMetadata(current.result);
            if (
              old &&
              next.status === 'queued' &&
              current?.status === 'failed' &&
              next.result === null
            )
              next.result = {
                ...old,
                trace: null,
                manifest: old.manifest,
              } satisfies BatchJobMetadata;
            await tx.save(next);
            current = next;
          },
        });
      }),
  };
}
export function createNativeBatchStore(deps: NativeBatchDependencies) {
  const store = nativeJobStore(deps.db);
  const now = () => deps.now().toISOString();
  const newId = deps.newId ?? randomUUID;
  async function inputForJob(tx: Transaction, job: JobRecord) {
    const row = await lockArrangeInput(tx, job.resourceId);
    return row &&
      row.jobId === job.jobId &&
      row.inputVersion === job.inputVersion
      ? row
      : null;
  }
  async function authorized(
    tx: Transaction,
    accountId: string,
    job: JobRecord,
    input?: StoredArrangeInput | null,
  ) {
    if (job.kind !== 'record_organize') return false;
    const value = input ?? (await inputForJob(tx, job));
    const metadata = parseBatchMetadata(job.result);
    if (
      !value ||
      !metadata ||
      value.creatorAccountId !== accountId ||
      value.supersededByInputId !== null
    )
      return false;
    try {
      const draftSet = await readNativeDraftSet(
        tx,
        requireNativeInput(value).batchId,
        value,
      );
      if (
        draftSet &&
        (draftSet.drafts.some(
          (draft) =>
            draft.evaluationNodeId !== value.evaluationNodeId ||
            draft.personIds.some(
              (personId) => !value.personIds.includes(personId),
            ) ||
            draft.sourceReferences.some(
              (ref) =>
                !value.sourceContexts.some(
                  (context) =>
                    context.fragmentId === ref.fragmentId &&
                    context.originalVersionId === ref.originalVersionId,
                ),
            ),
        ) ||
          metadata.manifest.length !== draftSet.drafts.length ||
          metadata.manifest.some(
            (event) =>
              !draftSet.drafts.some((draft) => draft.draftId === event.draftId),
          ))
      )
        return false;
      // Read/control authorization only: a snapshot cannot widen access, and
      // the runner re-checks under SHARE before any model call.
      const snapshot = await loadRecordBatchSnapshot(
        tx,
        await readIntakeTable(tx, 'snapshot'),
        value,
        metadata,
        deps.businessNow(),
        draftSet?.revision ?? 1,
      );
      return snapshot !== null;
    } catch (error) {
      if (error instanceof NativeArrangeUnavailable) return false;
      throw error;
    }
  }
  async function receipt(
    tx: Transaction,
    job: JobRecord,
    input: StoredArrangeInput,
    metadata: BatchJobMetadata,
  ): Promise<MaterialBatchReceipt> {
    const native = requireNativeInput(input);
    const all = await readNativeDraftSet(tx, native.batchId, input);
    const active = await tx
      .select()
      .from(recordSaves)
      .where(
        and(
          eq(recordSaves.batchId, native.batchId),
          isNull(recordSaves.withdrawnAt),
        ),
      );
    const confirmed = new Map<
      string,
      MaterialBatchReceipt['confirmedDrafts'][number]
    >();
    for (const saved of active) {
      const value = recordSaveReceiptSchema.parse(saved.receipt);
      const draft = all?.drafts.find((row) => row.draftId === saved.draftId);
      const snapshot = recordBatchDraftSchema.parse(saved.draftSnapshot);
      // Human save/undo advances the current ledger revision, never the retained
      // AI draft body. Validate that transition instead of equating old/current.
      if (
        !draft ||
        value.revision !== snapshot.revision + 1 ||
        value.revision > draft.revision ||
        !isDeepStrictEqual({ ...snapshot, revision: draft.revision }, draft)
      )
        throw new NativeArrangeUnavailable('confirmation_snapshot_changed');
      const next = {
        draftId: saved.draftId,
        revision: draft.revision,
        events: [...value.events].sort((a, b) =>
          a.personId.localeCompare(b.personId),
        ),
      };
      const previous = confirmed.get(next.draftId);
      if (previous && !isDeepStrictEqual(previous, next))
        throw new NativeArrangeUnavailable('confirmation_mapping_conflict');
      confirmed.set(next.draftId, next);
    }
    const remaining = all
      ? all.drafts.filter((draft) => !confirmed.has(draft.draftId))
      : [];
    const pendingSet: RecordBatchDraftSet | null =
      all && remaining.length
        ? {
            ...all,
            drafts: remaining,
            duplicateCandidates: all.duplicateCandidates.filter((group) =>
              group.draftIds.every((id) =>
                remaining.some((draft) => draft.draftId === id),
              ),
            ),
          }
        : null;
    const actor = await loadArrangeActor(
      tx,
      input.creatorAccountId,
      deps.businessNow(),
    );
    const items = metadata.pending.map((item) =>
      item.kind === 'unknown_person'
        ? {
            ...item,
            candidates: actor.directory.people
              .filter((person) =>
                canWriteArrange(
                  actor,
                  [person.id],
                  input.projectId,
                  native.evaluationNodeId,
                ),
              )
              .map((person) => ({
                personId: person.id,
                displayName: person.name,
              })),
          }
        : item,
    );
    return projectBatchReceipt({
      batchId: native.batchId,
      revision: all?.revision ?? 1,
      evaluationNodeId: native.evaluationNodeId,
      personIds: [...input.personIds],
      projectId: input.projectId,
      // Native intake accepts only this one verified text and no files/review decisions.
      // Missing or legacy facts are rejected above; these empties are proven by intake.
      hasHiddenContent: false,
      files: [],
      textMaterial: {
        materialId: input.inputSource!.fragmentId,
        originalVersionId: input.inputSource!.originalVersionId,
      },
      jobId: ['queued', 'running', 'partial'].includes(job.status)
        ? job.jobId
        : null,
      items,
      resolvedItems: [],
      draftSet: pendingSet,
      confirmedDrafts: [...confirmed.values()],
      error:
        job.status === 'failed' || job.status === 'cancelled'
          ? {
              code: 'processing_failed',
              message:
                job.status === 'cancelled'
                  ? '整理已取消，原始文本仍保留'
                  : '整理未完成，原始文本仍保留',
              retryable:
                metadata.failure?.kind === 'network' &&
                metadata.failure.retryable &&
                job.attempt < 2,
            }
          : null,
    });
  }
  const policy: JobPolicy<Transaction> = {
    kind: 'record_organize',
    resultSchema: materialBatchReceiptSchema,
    async can(tx, accountId, job, action) {
      if (!(await authorized(tx, accountId, job))) return false;
      if (action === 'read') return true;
      if (action === 'cancel')
        return (
          ['queued', 'running', 'partial'].includes(job.status) &&
          job.cancelRequestedAt === null
        );
      if (action !== 'retry') return false;
      const metadata = parseBatchMetadata(job.result)!;
      return (
        job.status === 'failed' &&
        job.attempt < 2 &&
        job.cancelRequestedAt === null &&
        metadata.failure?.kind === 'network' &&
        metadata.failure.retryable
      );
    },
    canReplay: (tx, accountId, job) => authorized(tx, accountId, job),
    async project(tx, accountId, job) {
      const input = await inputForJob(tx, job);
      if (!input || !(await authorized(tx, accountId, job, input)))
        return { result: null, progress: null };
      return {
        result: await receipt(tx, job, input, parseBatchMetadata(job.result)!),
        progress: null,
      };
    },
    async inputVersion(tx, job) {
      return (await inputForJob(tx, job))?.inputVersion ?? null;
    },
    canResume: async () => false,
    enqueue: (tx, job) => deps.enqueue(tx, job),
  };
  const ports: BatchArrangePorts = {
    async locked(request, callback) {
      const inputs = await deps.db
        .select()
        .from(arrangeInputs)
        .where(
          and(
            eq(arrangeInputs.batchId, request.batchId),
            eq(arrangeInputs.creatorAccountId, request.accountId),
            isNull(arrangeInputs.supersededByInputId),
          ),
        );
      if (inputs.length !== 1)
        throw new NativeArrangeUnavailable('unique_native_input_required');
      return store.locked(inputs[0]!.jobId, async (locked) => {
        let job = locked.record;
        if (!job) throw new NativeArrangeUnavailable('native_job_required');
        const input = await inputForJob(locked.context, job);
        let metadata = parseBatchMetadata(job.result);
        if (!input || !metadata || metadata.operationId !== request.operationId)
          throw new NativeArrangeUnavailable('native_operation_required');
        let set = await readNativeDraftSet(
          locked.context,
          request.batchId,
          input,
        );
        let commit: BatchArrangeCommit | null = null;
        const operation = batchOperationFromJob(job, input, metadata, set);
        const tx: BatchArrangeTransaction = {
          operation,
          loadSnapshot: async () => {
            const revising =
              set !== null && ['queued', 'running'].includes(operation.phase);
            if (revising) {
              const saved = await locked.context
                .select({ id: recordSaves.saveId })
                .from(recordSaves)
                .where(eq(recordSaves.batchId, request.batchId))
                .limit(1);
              const mapped = await locked.context
                .select({ id: recordDraftEvents.eventId })
                .from(recordDraftEvents)
                .where(eq(recordDraftEvents.batchId, request.batchId))
                .limit(1);
              if (saved.length || mapped.length) return null;
            }
            return loadRecordBatchSnapshot(
              locked.context,
              // Before the model call: fence intake DML until this commits.
              await readIntakeTable(locked.context, 'locked'),
              input,
              metadata!,
              deps.businessNow(),
              set?.revision ?? 1,
              revising
                ? { kind: 'revise', events: metadata!.manifest }
                : { kind: 'initial' },
            );
          },
          readRules: (value) =>
            value.category === 'dimension_anchors' &&
            value.at === requireNativeInput(input).boundAt
              ? readBatchArrangeRules(locked.context, value.at)
              : Promise.resolve(null),
          async reserveIdentities(plan) {
            if (set) {
              const manifest = metadata!.manifest;
              if (
                manifest.length !== set.drafts.length ||
                plan.events.length !== manifest.length ||
                new Set(manifest.map((event) => event.eventKey)).size !==
                  manifest.length ||
                new Set(manifest.map((event) => event.draftId)).size !==
                  manifest.length ||
                new Set(plan.events.map((event) => event.eventKey)).size !==
                  manifest.length ||
                manifest.some(
                  (event) =>
                    !set!.drafts.some(
                      (draft) => draft.draftId === event.draftId,
                    ),
                ) ||
                plan.events.some(
                  (event) =>
                    !manifest.some(
                      (prior) => prior.eventKey === event.eventKey,
                    ),
                )
              )
                throw new NativeArrangeUnavailable(
                  'native_revision_identity_changed',
                );
              return {
                expectedBatchRevision: set.revision,
                drafts: plan.events.map((event) => {
                  const prior = manifest.find(
                    (entry) => entry.eventKey === event.eventKey,
                  )!;
                  return {
                    eventKey: event.eventKey,
                    draftId: prior.draftId,
                    previous: structuredClone(
                      set!.drafts.find(
                        (draft) => draft.draftId === prior.draftId,
                      )!,
                    ),
                  };
                }),
                candidates: plan.groups.map((group) => {
                  const prior = set!.duplicateCandidates.find((candidate) => {
                    const keys = candidate.draftIds.map(
                      (id) =>
                        manifest.find((event) => event.draftId === id)
                          ?.eventKey,
                    );
                    return (
                      keys.every((key) => key !== undefined) &&
                      batchDigest(keys.sort()) === group.key
                    );
                  });
                  return {
                    key: group.key,
                    candidateId: prior?.candidateId ?? newId(),
                  };
                }),
              };
            }
            if (metadata!.manifest.length)
              throw new NativeArrangeUnavailable(
                'native_revision_batch_missing',
              );
            return {
              expectedBatchRevision: 1,
              drafts: plan.events.map((event) => ({
                eventKey: event.eventKey,
                draftId: newId(),
                previous: null,
              })),
              candidates: plan.groups.map((group) => ({
                key: group.key,
                candidateId: newId(),
              })),
            };
          },
          async persistDraftSet(value, trace) {
            const { events, expectedJobRevision, ...producerTrace } = trace;
            if (
              expectedJobRevision !== job!.revision ||
              job!.attempt !== request.attempt ||
              !['running', 'partial'].includes(job!.status) ||
              job!.cancelRequestedAt !== null ||
              !isDeepStrictEqual(producerTrace, metadata!.trace) ||
              events.length !== value.drafts.length ||
              new Set(events.map((event) => event.eventKey)).size !==
                events.length ||
              new Set(events.map((event) => event.draftId)).size !==
                events.length ||
              events.some(
                (event) =>
                  !value.drafts.some(
                    (draft) => draft.draftId === event.draftId,
                  ),
              ) ||
              trace.inputVersion !== input.inputVersion ||
              trace.boundAt !== requireNativeInput(input).boundAt ||
              trace.occurredOn !== input.occurredOn
            )
              throw new NativeArrangeUnavailable('native_commit_changed');
            if (set) {
              await reviseTrustedRecordDraftBatch(locked.context, {
                expectedBatchRevision: set.revision,
                expectedDrafts: set.drafts.map((draft) => ({
                  draftId: draft.draftId,
                  revision: draft.revision,
                })),
                draftSet: value,
              });
            } else {
              await storeTrustedRecordDraftBatch(locked.context, {
                draftSet: value,
                originalInput: input.originalInput,
                occurredOn: input.occurredOn!,
                modelVersion: MODELINK_MODEL,
                createdByAccountId: input.creatorAccountId,
                createdAt: deps.now(),
              });
            }
            set = await readNativeDraftSet(
              locked.context,
              request.batchId,
              input,
            );
            if (!set)
              throw new NativeArrangeUnavailable(
                'native_writer_returned_no_batch',
              );
            // The writer stores rows in database order; compare by stable ID.
            const expected = {
              ...value,
              drafts: [...value.drafts].sort((a, b) =>
                a.draftId.localeCompare(b.draftId),
              ),
            };
            if (!isDeepStrictEqual(set, expected))
              throw new NativeArrangeUnavailable('native_writer_changed_draft');
            commit = trace;
            return value;
          },
          async saveOperation(next) {
            if (
              next.accountId !== input.creatorAccountId ||
              next.batchId !== input.batchId ||
              next.operationId !== metadata!.operationId ||
              next.attempt !== job!.attempt ||
              next.revision !== job!.revision ||
              next.inputVersion !== job!.inputVersion
            )
              throw new NativeArrangeUnavailable('native_operation_changed');
            metadata = batchMetadataSchema.parse({
              ...metadata,
              trace: next.trace,
              failure: next.failure,
              ...(commit ? { manifest: commit.events } : {}),
            });
            job = updateBatchJob(job!, next.phase, metadata, now());
            await locked.save(job);
            return job.revision;
          },
        };
        return callback(tx);
      });
    },
  };
  return { store, policy, ports, authorized, inputForJob, receipt };
}
