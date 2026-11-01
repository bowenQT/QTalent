import { offlineTranscriptInputSchema } from '../../../contracts/media';
import { z } from 'zod';
import { OfflineError } from '../../integrations/tingwu/offline';
import {
  contextFailure,
  createRecordingTranscript,
  matchesWork,
  recordingKey,
  RecordingError,
  speakerReview,
  validateArchive,
} from '../../modules/records/recordings/policy';
import type {
  RecordingFailure,
  RecordingRun,
  RecordingWork,
} from '../../modules/records/recordings/types';
import type { RecordingPorts, RecordingTransaction } from './ports';

/** Independent orchestration only. Production ports/worker registration are intentionally required. */
export function createRecordingProcessor(
  ports: RecordingPorts,
  options: { maxPolls: number; claimLeaseMs: number },
) {
  if (!Number.isSafeInteger(options.maxPolls) || options.maxPolls < 1)
    throw new Error('invalid_poll_limit');
  if (!Number.isSafeInteger(options.claimLeaseMs) || options.claimLeaseMs < 1)
    throw new Error('invalid_claim_lease');
  if (typeof ports.now !== 'function') throw new Error('invalid_claim_clock');
  function executionTime() {
    const value = ports.now();
    if (!z.iso.datetime().safeParse(value).success)
      throw new Error('invalid_claim_clock');
    const now = Date.parse(value);
    if (!Number.isSafeInteger(now)) throw new Error('invalid_claim_clock');
    return now;
  }
  function expiresAt(now: number) {
    const next = now + options.claimLeaseMs;
    // Stored timestamps use the same four-digit UTC year format as now().
    if (!Number.isSafeInteger(next) || next > 253402300799999)
      throw new Error('invalid_claim_clock');
    return new Date(next).toISOString();
  }
  function leaseExpiry(run: RecordingRun): number | null {
    if (run.claimExpiresAt === null) return null;
    if (!run.claim || !z.iso.datetime().safeParse(run.claimExpiresAt).success)
      throw new Error('invalid_claim_lease');
    return Date.parse(run.claimExpiresAt);
  }
  return async function process(
    work: RecordingWork,
  ): Promise<'ignored' | 'handled'> {
    const claim = ports.allocateId();
    const acquired = await ports.transaction(work.recordingId, async (tx) => {
      let run = tx.run;
      if (
        !run ||
        !matchesWork(run, work) ||
        run.phase === 'cancelled' ||
        run.phase === 'shaping'
      )
        return null;
      // A committed cancellation may fence an in-flight request. It does not cancel the cloud task.
      if (tx.context?.cancelRequested) {
        await tx.saveRun({ ...run, phase: 'cancelled', claimExpiresAt: null });
        return null;
      }
      if (run.phase === 'failed') return null;
      if (work.action === 'resume') {
        const g = tx.context?.resumeGrant;
        if (
          !run.transcript ||
          run.phase !== 'needs_review' ||
          !g ||
          g.recordingId !== work.recordingId ||
          g.transcriptVersionId !== work.transcriptVersionId ||
          g.bindingRevision !== work.bindingRevision ||
          g.operationId !== work.operationId ||
          run.transcript.id !== work.transcriptVersionId ||
          tx.context?.bindingRevision !== work.bindingRevision
        )
          return null;
        // A real resume ledger can advance the binding revision; an incoming payload cannot.
        run = { ...run, bindingRevision: work.bindingRevision };
      } else if (
        run.phase === 'needs_review' ||
        run.pollSequence !== work.pollSequence
      )
        return null;
      const failure = contextFailure(run, tx.context);
      if (failure) {
        await tx.saveRun({
          ...run,
          phase: 'failed',
          failure,
          claimExpiresAt: null,
        });
        return null;
      }
      // Reuse the existing job/attempt and claim fence. At the exact deadline
      // the old lease is inactive; a duplicate before it cannot take ownership.
      const now = executionTime();
      const expiry = leaseExpiry(run);
      if (expiry !== null && now < expiry) return null;
      if (!claim.trim() || claim === run.claim)
        throw new Error('invalid_claim');
      const next = {
        ...run,
        claim,
        claimExpiresAt: expiresAt(now),
        recordCollectionId: tx.context!.recordCollectionId,
        bindingRevision: tx.context!.bindingRevision,
      };
      await tx.saveRun(next);
      return next;
    });
    if (!acquired) return 'ignored';

    // Every checkpoint reloads current permission/member/binding facts under the native locks.
    async function checkpoint<T>(
      action: (tx: RecordingTransaction, run: RecordingRun) => Promise<T>,
    ): Promise<T | null> {
      return ports.transaction(work.recordingId, async (tx) => {
        const run = tx.run;
        if (
          !run ||
          !matchesWork(run, work) ||
          run.claim !== claim ||
          run.claimExpiresAt === null
        )
          return null;
        if (tx.context?.cancelRequested) {
          await tx.saveRun({
            ...run,
            phase: 'cancelled',
            claimExpiresAt: null,
          });
          return null;
        }
        const failure = contextFailure(run, tx.context);
        if (failure) {
          await tx.saveRun({
            ...run,
            phase: 'failed',
            failure,
            claimExpiresAt: null,
          });
          return null;
        }
        const now = executionTime();
        const expiry = leaseExpiry(run);
        if (expiry === null || now >= expiry) return null;
        // Renew only an unexpired owner. A returning old worker cannot renew
        // itself after expiry or after a new owner has taken over.
        const renewed = { ...run, claimExpiresAt: expiresAt(now) };
        await tx.saveRun(renewed);
        return action(tx, renewed);
      });
    }
    async function fail(failure: RecordingFailure) {
      await checkpoint(async (tx, run) => {
        await tx.saveRun({
          ...run,
          failure,
          phase: 'failed',
          claimExpiresAt: null,
        });
        return true;
      });
    }
    // Keep an accepted task receipt even when local cancellation/revocation fenced its output.
    // It is metadata only; never permits further provider work or an old attempt to write.
    async function rememberTask(providerTaskId: string) {
      return ports.transaction(work.recordingId, async (tx) => {
        const run = tx.run;
        if (
          !run ||
          !matchesWork(run, work) ||
          run.claim !== claim ||
          run.submission !== 'reserved' ||
          (run.providerTaskId !== null && run.providerTaskId !== providerTaskId)
        )
          return false;
        await tx.saveRun({ ...run, providerTaskId });
        return true;
      });
    }
    async function reconcile() {
      await checkpoint(async (tx, run) => {
        const transcript = run.transcript!;
        const pending = speakerReview(
          transcript,
          await tx.loadBindings(transcript),
          run.bindingRevision!,
        );
        await tx.replacePendingReview(pending);
        if (pending.length) {
          await tx.saveRun({
            ...run,
            phase: 'needs_review',
            claimExpiresAt: null,
          });
        } else {
          const input = offlineTranscriptInputSchema.parse({
            kind: 'offline_transcript',
            recordingId: run.recordingId,
            originalVersionId: run.originalVersionId,
            transcriptVersionId: transcript.id,
            bindingRevision: run.bindingRevision,
          });
          const { jobId } = await tx.enqueueShaping(
            input,
            recordingKey(
              'recording-shaping',
              transcript.id,
              run.bindingRevision!,
            ),
          );
          await tx.saveRun({
            ...run,
            phase: 'shaping',
            shapingJobId: jobId,
            claimExpiresAt: null,
          });
        }
        return true;
      });
    }
    async function pollLater() {
      await checkpoint(async (tx, run) => {
        if (run.pollSequence >= options.maxPolls) {
          await tx.saveRun({
            ...run,
            phase: 'failed',
            failure: 'poll_limit',
            claimExpiresAt: null,
          });
        } else {
          const next = {
            ...run,
            phase: 'transcribing' as const,
            claimExpiresAt: null,
            pollSequence: run.pollSequence + 1,
          };
          await tx.enqueuePoll({
            action: 'process',
            recordingId: run.recordingId,
            jobId: run.jobId,
            attempt: run.attempt,
            pollSequence: next.pollSequence,
          });
          await tx.saveRun(next);
        }
        return true;
      });
    }
    try {
      if (acquired.transcript) {
        await reconcile();
        return 'handled';
      }
      let run: RecordingRun = acquired;
      if (!run.providerTaskId) {
        // Crash/timeout after submit reservation cannot be retried by blindly submitting again.
        if (run.submission === 'reserved') {
          await fail('submission_unknown');
          return 'handled';
        }
        if (!(await checkpoint(async () => true))) return 'handled';
        const upload = await ports.readValidatedUpload({
          uploadId: run.uploadId,
          originalVersionId: run.originalVersionId,
        });
        if (!upload) throw new RecordingError('invalid_archive');
        if (!(await checkpoint(async () => true))) return 'handled';
        const media = validateArchive(
          run,
          upload,
          await ports.inspectAudio(upload),
        );
        if (!(await checkpoint(async () => true))) return 'handled';
        const source = await ports.prepareSource(upload, media);
        const reserved = await checkpoint(async (tx, current) => {
          const next = {
            ...current,
            media,
            submission: 'reserved' as const,
            phase: 'transcribing' as const,
          };
          await tx.saveRun(next);
          return next;
        });
        if (!reserved) return 'handled';
        const operationId = recordingKey(
          'recording-offline',
          run.originalVersionId,
          run.recordingId,
        );
        const receipt = await ports.transcriber.submitOffline({
          sourceRef: run.originalVersionId,
          source,
          operationId,
          media: {
            format: media.format,
            byteLength: media.byteLength,
            durationMs: media.durationMs,
          },
        });
        if (
          receipt.operationId !== operationId ||
          !receipt.providerTaskId.trim()
        )
          throw new RecordingError('submission_unknown');
        await rememberTask(receipt.providerTaskId);
        const saved = await checkpoint(async (tx, current) => {
          const next = { ...current, providerTaskId: receipt.providerTaskId };
          await tx.saveRun(next);
          return next;
        });
        if (!saved) return 'handled';
        run = saved;
      }
      if (!(await checkpoint(async () => true))) return 'handled';
      const status = await ports.transcriber.queryOffline(run.providerTaskId!);
      if (status.providerTaskId !== run.providerTaskId)
        throw new RecordingError('invalid_transcript');
      if (status.status === 'running') {
        await pollLater();
        return 'handled';
      }
      if (status.status === 'failed') {
        await fail('provider_failed');
        return 'handled';
      }
      if (!(await checkpoint(async () => true))) return 'handled';
      const result = await ports.transcriber.getTranscript(run.providerTaskId!);
      const transcript = createRecordingTranscript(
        run,
        result,
        ports.allocateId,
      );
      if (
        !(await checkpoint(async (tx, current) => {
          await tx.insertTranscript(transcript);
          await tx.saveRun({ ...current, transcript });
          return true;
        }))
      )
        return 'handled';
      await reconcile();
    } catch (error) {
      if (
        error instanceof OfflineError &&
        error.code === 'submission_unknown' &&
        error.providerTaskId
      ) {
        await rememberTask(error.providerTaskId);
        await pollLater();
      } else if (error instanceof OfflineError && error.retryable) {
        // Poll the known task only. Never turn a submit failure into a second CreateTask.
        const state = await checkpoint(async (_tx, run) => ({
          known: Boolean(run.providerTaskId),
          reserved: run.submission === 'reserved',
        }));
        if (state?.known) await pollLater();
        else
          await fail(
            state?.reserved ? 'submission_unknown' : 'provider_unavailable',
          );
      } else {
        await fail(
          error instanceof RecordingError
            ? error.code
            : error instanceof OfflineError &&
                error.code === 'submission_unknown'
              ? 'submission_unknown'
              : 'provider_unavailable',
        );
      }
    }
    return 'handled';
  };
}
