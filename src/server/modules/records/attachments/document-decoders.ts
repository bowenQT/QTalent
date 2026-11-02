import type { AttachmentDecoder } from './types';
import { Worker } from 'node:worker_threads';
import {
  DOCX_DECODER_VERSION,
  PDF_DECODER_VERSION,
  documentBudgetSchema,
  documentOutcomeSchema,
  type DocumentDecoderOptions,
  type DocumentBudget,
  type DocumentOutcome,
} from './document-protocol';
function runWorker(
  format: 'docx' | 'pdf',
  bytes: Uint8Array,
  options: Parameters<AttachmentDecoder['decode']>[1],
  budget: DocumentBudget,
): Promise<DocumentOutcome> {
  if (options.signal?.aborted)
    return Promise.resolve({ status: 'failed', reason: 'cancelled' });
  return new Promise((resolve) => {
    // A Buffer can be a slice of a pooled backing ArrayBuffer. Transfer only an
    // exclusive, exact-size copy so adjacent memory never enters the worker.
    const owned = Uint8Array.from(bytes);
    const worker = new Worker(
      new URL('./document-worker.ts', import.meta.url),
      {
        workerData: { format, bytes: owned, limits: options.limits, budget },
        transferList: [owned.buffer],
        execArgv: ['--import', 'tsx'],
        stdout: true,
        stderr: true,
        resourceLimits: {
          maxOldGenerationSizeMb: budget.maxOldGenerationSizeMb,
          stackSizeMb: 4,
        },
      },
    );
    // Third-party parser diagnostics can contain source content. Drain privately;
    // only our strict result protocol is allowed back to the business process.
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const finish = async (result: DocumentOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      try {
        await worker.terminate();
      } catch {
        result = { status: 'failed', reason: 'processing_failed' };
      } finally {
        worker.removeAllListeners();
      }
      resolve(result);
    };
    const abort = () => {
      void finish({ status: 'failed', reason: 'cancelled' });
    };
    const timer = setTimeout(() => {
      void finish({ status: 'failed', reason: 'resource_limit' });
    }, budget.maxDurationMs);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (output) => {
      const checked = documentOutcomeSchema.safeParse(output);
      void finish(
        checked.success
          ? checked.data
          : { status: 'failed', reason: 'invalid_content' },
      );
    });
    worker.once('error', (error) => {
      void finish({
        status: 'failed',
        reason:
          'code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'resource_limit'
            : 'processing_failed',
      });
    });
    worker.once('exit', () => {
      void finish({ status: 'failed', reason: 'processing_failed' });
    });
    if (options.signal?.aborted) abort();
  });
}
export function createDocumentDecoders(
  options: DocumentDecoderOptions = {},
): Record<'docx' | 'pdf', AttachmentDecoder> {
  const budget = documentBudgetSchema.parse(options);
  return {
    docx: {
      version: DOCX_DECODER_VERSION,
      decode: (bytes, options) => runWorker('docx', bytes, options, budget),
    },
    pdf: {
      version: PDF_DECODER_VERSION,
      decode: (bytes, options) => runWorker('pdf', bytes, options, budget),
    },
  };
}
