import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { officeLimits } from './limits';
import { OfficeParseError, type ParsedOffice } from './types';
import {
  decodeOfficeOutcome,
  OfficeIsolationError,
  officeWorkerBudgetSchema,
  type OfficeWorkerOptions,
} from './worker-protocol';
/** Local Node entry, not yet wired to production authorization, storage or the shared queue. */
export async function parseOfficeIsolated(
  input: { format: 'pptx' | 'xlsx'; bytes: Uint8Array; signal?: AbortSignal },
  options: OfficeWorkerOptions = {},
): Promise<ParsedOffice> {
  if (!input || !['pptx', 'xlsx'].includes(input.format))
    throw new OfficeParseError('unsupported_format', 'only_pptx_and_xlsx');
  if (!(input.bytes instanceof Uint8Array) || !input.bytes.byteLength)
    throw new OfficeParseError('invalid_document', 'empty_or_nonbinary');
  if (input.bytes.byteLength > officeLimits.maxInputBytes)
    throw new OfficeParseError('limit_exceeded', 'input_size');
  const signal = input.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new OfficeIsolationError('processing_failed', 'invalid_signal');
  if (signal?.aborted) throw new OfficeIsolationError('cancelled', 'aborted');
  const checked = officeWorkerBudgetSchema.safeParse(options);
  if (!checked.success)
    throw new OfficeIsolationError('processing_failed', 'invalid_budget');
  const budget = checked.data;
  const bytes = Uint8Array.from(input.bytes);
  const expected = {
    format: input.format,
    inputSha256: createHash('sha256').update(bytes).digest('hex'),
  };
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./parse-worker.ts', import.meta.url), {
        workerData: { version: 1, format: input.format, bytes, budget },
        transferList: [bytes.buffer],
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
      reject(new OfficeIsolationError('processing_failed', 'worker_start'));
      return;
    }
    let settled = false;
    let diagnosticBytes = 0;
    const finish = async (result?: ParsedOffice, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      try {
        await worker.terminate();
      } catch {
        error = new OfficeIsolationError(
          'processing_failed',
          'worker_termination',
        );
      } finally {
        worker.removeAllListeners();
        worker.stdout.removeAllListeners();
        worker.stderr.removeAllListeners();
      }
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => {
      void finish(undefined, new OfficeIsolationError('cancelled', 'aborted'));
    };
    const timer = setTimeout(() => {
      void finish(
        undefined,
        new OfficeIsolationError('limit_exceeded', 'timeout'),
      );
    }, budget.maxDurationMs);
    signal?.addEventListener('abort', abort, { once: true });
    const diagnostics = (chunk: Buffer) => {
      diagnosticBytes += chunk.byteLength;
      if (diagnosticBytes > budget.maxDiagnosticBytes)
        void finish(
          undefined,
          new OfficeIsolationError('limit_exceeded', 'diagnostic_bytes'),
        );
    };
    worker.stdout.on('data', diagnostics);
    worker.stderr.on('data', diagnostics);
    worker.once('message', (wire: unknown) => {
      try {
        const outcome = decodeOfficeOutcome(wire, budget, expected);
        if (outcome.status === 'parsed') void finish(outcome.result);
        else
          void finish(
            undefined,
            outcome.kind === 'processing_failed'
              ? new OfficeIsolationError('processing_failed', outcome.reason)
              : new OfficeParseError(outcome.kind, outcome.reason),
          );
      } catch (error) {
        void finish(undefined, error);
      }
    });
    worker.once('error', (error: Error & { code?: string }) => {
      void finish(
        undefined,
        new OfficeIsolationError(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'limit_exceeded'
            : 'processing_failed',
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'worker_heap'
            : 'worker_error',
        ),
      );
    });
    worker.once('exit', () => {
      void finish(
        undefined,
        new OfficeIsolationError('processing_failed', 'worker_exit'),
      );
    });
    if (signal?.aborted) abort();
  });
}
