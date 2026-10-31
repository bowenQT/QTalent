import { Worker } from 'node:worker_threads';
import type { InterviewReviewOptions } from '../../modules/records/attachments/interview-review/types';
import {
  pdfWorkerRequestSchema,
  decodePdfWorkerReply,
  type PdfIsolationBudget,
  type IsolatedPdfOutcome,
} from './pdf-protocol';

/** Internal Node adapter. The caller must authorize the original before reading
 * bytes. No URL, job, account, credentials or persistence callback enters the
 * parsing thread. This is not a Next/HTTP entry or an OS security sandbox.
 */
export async function parseInterviewPdfIsolated(input: {
  bytes: Uint8Array;
  options: InterviewReviewOptions;
  budget: PdfIsolationBudget;
  signal?: AbortSignal;
}): Promise<IsolatedPdfOutcome> {
  const checked = pdfWorkerRequestSchema.safeParse({
    bytes: input.bytes,
    options: input.options,
    budget: input.budget,
  });
  if (!checked.success) return { status: 'failed', reason: 'invalid_request' };
  const { bytes, options, budget } = checked.data;
  if (input.signal?.aborted) return { status: 'failed', reason: 'cancelled' };
  if (bytes.byteLength > budget.maxInputBytes)
    return { status: 'failed', reason: 'resource_limit' };
  const deadline = performance.now() + budget.maxDurationMs;
  // Copy only this exact view, not the Buffer pool or caller-owned backing store.
  const owned = Uint8Array.from(bytes);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./pdf-worker.ts', import.meta.url), {
        workerData: { bytes: owned, options, budget },
        transferList: [owned.buffer],
        execArgv: ['--import', 'tsx'],
        env: {},
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: budget.maxOldGenerationSizeMb,
          stackSizeMb: 4,
        },
      });
    } catch {
      resolve({ status: 'failed', reason: 'worker_failed' });
      return;
    }
    let settled = false;
    let diagnosticBytes = 0;
    const finish = async (outcome: IsolatedPdfOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', abort);
      try {
        await worker.terminate();
      } catch {
        outcome = { status: 'failed', reason: 'termination_failed' };
      } finally {
        worker.removeAllListeners();
        worker.stdout.removeAllListeners('data');
        worker.stderr.removeAllListeners('data');
      }
      resolve(outcome);
    };
    const abort = () => {
      void finish({ status: 'failed', reason: 'cancelled' });
    };
    const timer = setTimeout(
      () => {
        void finish({ status: 'failed', reason: 'timeout' });
      },
      Math.max(0, deadline - performance.now()),
    );
    const discardDiagnostic = (chunk: Buffer) => {
      diagnosticBytes += chunk.byteLength;
      if (diagnosticBytes > budget.maxOutputBytes)
        void finish({ status: 'failed', reason: 'resource_limit' });
    };
    // Explicit pipes keep private parser diagnostics out of the host logs.
    worker.stdout.on('data', discardDiagnostic);
    worker.stderr.on('data', discardDiagnostic);
    worker.on('message', (message: unknown) => {
      if (settled) return;
      if (performance.now() >= deadline) {
        void finish({ status: 'failed', reason: 'timeout' });
        return;
      }
      void finish(
        decodePdfWorkerReply(message, budget.maxOutputBytes - diagnosticBytes),
      );
    });
    worker.once('error', (error) => {
      void finish({
        status: 'failed',
        reason:
          'code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'resource_limit'
            : 'worker_failed',
      });
    });
    worker.once('exit', () => {
      void finish({ status: 'failed', reason: 'worker_failed' });
    });
    input.signal?.addEventListener('abort', abort, { once: true });
    // Cancellation can arrive while the thread is being constructed.
    if (input.signal?.aborted) abort();
  });
}
