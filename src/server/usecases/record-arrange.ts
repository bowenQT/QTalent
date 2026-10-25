import { isDeepStrictEqual } from 'node:util';
import { recordDraftSchema, type RecordDraft } from '../../contracts/record';
import type { JobStore } from '../jobs/service';
import { advanceJob, type JobRecord } from '../jobs/state';
import type { StructuredMaasClient } from '../integrations/maas';
import {
  prepareArrange,
  executePreparedArrange,
  arrangeJobResultSchema,
  type ArrangeFailure,
  type ArrangeSnapshot,
  type DraftPersistence,
} from '../modules/records/arrange';
export interface RecordArrangeDependencies<C> {
  store: JobStore<C>;
  /** Reload current source/classification/rules using THIS transaction context. */
  load(context: C, resourceId: string): Promise<ArrangeSnapshot | null>;
  /** Current business write authority; model-input read access is insufficient. */
  authorize(context: C, job: JobRecord): Promise<boolean>;
  /** 846 owns the concrete writer; this callback must use the passed transaction. */
  persistRecordDraft(context: C, value: DraftPersistence): Promise<RecordDraft>;
  client: StructuredMaasClient;
  now(): string;
}
export function createRecordArrangeUsecase<C>(
  deps: RecordArrangeDependencies<C>,
) {
  function failed(
    current: JobRecord,
    failure: ArrangeFailure,
    changed = false,
  ) {
    return advanceJob(
      current,
      {
        attempt: current.attempt,
        expectedRevision: current.revision,
        status: 'failed',
        errorCode: changed ? 'input_changed' : 'processing_failed',
        result: arrangeJobResultSchema.parse({
          state: 'failure',
          failure,
          inputVersion: current.inputVersion,
          attemptsUsed: current.attempt,
        }),
      },
      deps.now(),
    );
  }
  return {
    async run(jobId: string, attempt: number): Promise<string> {
      const claim = await deps.store.locked(jobId, async (tx) => {
        const current = tx.record;
        if (
          !current ||
          current.kind !== 'record_organize' ||
          current.attempt !== attempt ||
          attempt > 2 ||
          !Number.isInteger(attempt) ||
          attempt < 1 ||
          ['completed', 'cancelled'].includes(current.status)
        )
          return { status: 'ignored' } as const;
        if (current.cancelRequestedAt !== null) {
          await tx.save(
            advanceJob(
              current,
              {
                attempt,
                expectedRevision: current.revision,
                status: 'cancelled',
              },
              deps.now(),
            ),
          );
          return { status: 'cancelled' } as const;
        }
        // A running delivery might still be in flight, or might have crashed.
        // Neither case proves that another provider call is safe.
        if (current.status !== 'queued') return { status: 'ignored' } as const;
        const running = advanceJob(
          current,
          { attempt, expectedRevision: current.revision, status: 'running' },
          deps.now(),
        );
        if (!(await deps.authorize(tx.context, current))) {
          await tx.save(
            failed(running, { kind: 'permission', retryable: false }),
          );
          return { status: 'failed' } as const;
        }
        const snapshot = await deps.load(tx.context, current.resourceId);
        if (
          !snapshot ||
          snapshot.inputVersion !== current.inputVersion ||
          snapshot.draftId !== current.resourceId
        ) {
          await tx.save(
            failed(
              running,
              { kind: 'invalid_request', retryable: false },
              true,
            ),
          );
          return { status: 'failed' } as const;
        }
        const prepared = await prepareArrange(snapshot);
        if (prepared.status === 'not_found') {
          await tx.save(
            failed(running, { kind: 'permission', retryable: false }),
          );
          return { status: 'failed' } as const;
        }
        if (prepared.status === 'selection_required') {
          await tx.save(
            advanceJob(
              running,
              {
                attempt,
                expectedRevision: running.revision,
                status: 'awaiting_manual',
                result: arrangeJobResultSchema.parse({
                  state: 'selection_required',
                  inputVersion: snapshot.inputVersion,
                }),
              },
              deps.now(),
            ),
          );
          return { status: 'awaiting_manual' } as const;
        }
        await tx.save(running);
        return {
          status: 'claimed',
          prepared,
          revision: running.revision,
        } as const;
      });
      if (claim.status !== 'claimed') return claim.status;
      const outcome = await executePreparedArrange(claim.prepared, deps.client);
      return deps.store.locked(jobId, async (tx) => {
        const current = tx.record;
        if (
          !current ||
          current.kind !== 'record_organize' ||
          current.attempt !== attempt ||
          current.status !== 'running'
        )
          return 'ignored';
        if (current.cancelRequestedAt !== null) {
          await tx.save(
            advanceJob(
              current,
              {
                attempt,
                expectedRevision: current.revision,
                status: 'cancelled',
              },
              deps.now(),
            ),
          );
          return 'cancelled';
        }
        if (current.revision !== claim.revision) return 'ignored';
        const authorized = await deps.authorize(tx.context, current);
        const snapshot = authorized
          ? await deps.load(tx.context, current.resourceId)
          : null;
        const fresh = snapshot ? await prepareArrange(snapshot) : null;
        if (
          fresh?.status !== 'ready' ||
          fresh.fingerprint !== claim.prepared.fingerprint ||
          current.inputVersion !== fresh.snapshot.inputVersion
        ) {
          await tx.save(
            failed(
              current,
              {
                kind: authorized ? 'invalid_request' : 'permission',
                retryable: false,
              },
              true,
            ),
          );
          return 'failed';
        }
        if (outcome.status !== 'arranged') {
          await tx.save(
            failed(
              current,
              outcome.status === 'failed'
                ? outcome.failure
                : { kind: 'invalid_response', retryable: false },
            ),
          );
          return 'failed';
        }
        const draft = await deps.persistRecordDraft(tx.context, outcome.value);
        if (
          !recordDraftSchema.safeParse(draft).success ||
          !isDeepStrictEqual(draft, { ...outcome.value.draft, revision: 1 })
        )
          throw new Error('Draft persistence contract mismatch');
        const result = {
          state: 'draft' as const,
          draft,
          fingerprint: fresh.fingerprint,
          inputVersion: outcome.value.inputVersion,
          promptVersion: outcome.value.promptVersion,
          modelVersion: outcome.value.modelVersion,
          ruleVersionId: outcome.value.ruleVersionId,
        };
        arrangeJobResultSchema.parse(result);
        await tx.save(
          advanceJob(
            current,
            {
              attempt,
              expectedRevision: current.revision,
              status: 'awaiting_manual',
              result,
            },
            deps.now(),
          ),
        );
        return 'awaiting_manual';
      });
    },
  };
}
