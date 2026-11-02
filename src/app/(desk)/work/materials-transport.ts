import { z } from 'zod';
import {
  completeUploadResultSchema,
  materialRequestUploadResultSchema,
} from '@/contracts/media';
import { materialBatchReceiptSchema } from '@/contracts/materials';
import type {
  BatchSubmitResult,
  CompleteResult,
  MaterialsTransport,
} from '@/features/workbench/sections/materials/live-port';
import { readBatch } from '../record/reads';

/** Same-origin entries for workbench material intake. */
export const MATERIAL_ROUTES = {
  uploads: '/api/record/uploads',
  complete: '/api/record/uploads/complete',
  batches: '/api/materials/batches',
};

const text = z.string().min(1);
const batchSubmitResponseSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('success'),
    replayed: z.boolean(),
    result: materialBatchReceiptSchema,
  }),
  z.object({ status: z.literal('no_active_node'), message: text }),
  z.object({
    status: z.literal('validation_error'),
    fieldErrors: z.record(z.string(), z.array(z.string())),
  }),
  z.object({
    status: z.enum(['conflict', 'forbidden', 'not_found']),
    message: text,
  }),
]);

const completeResponseSchema = z.union([
  z.object({ status: z.literal('staged'), uploadId: text }),
  completeUploadResultSchema,
]);

function toCompleteResult(
  result: z.infer<typeof completeResponseSchema>,
): CompleteResult {
  switch (result.status) {
    case 'staged':
      return { status: 'staged', uploadId: result.uploadId };
    case 'success':
      return { status: 'staged', uploadId: result.result.uploadId };
    case 'validation_error':
      return { status: 'failed', message: '上传中断，可以重试' };
    default:
      return { status: 'failed', message: result.message };
  }
}

/** POSTs JSON and parses the answer; a sign-in redirect or unknown body is a transport failure. */
async function post<S extends z.ZodType>(
  url: string,
  body: unknown,
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (response.redirected) throw new Error('signed out');
  return schema.parse(await response.json()) as z.infer<S>;
}

function toSubmitResult(
  result: z.infer<typeof batchSubmitResponseSchema>,
): BatchSubmitResult {
  switch (result.status) {
    case 'success':
      return { status: 'success', receipt: result.result };
    case 'no_active_node':
      return { status: 'no_active_node' };
    case 'validation_error':
      return {
        status: 'declined',
        message: '这批文件需要重新选择，再交一次',
      };
    default:
      return { status: 'declined', message: result.message };
  }
}

export const materialsTransport: MaterialsTransport = {
  requestUpload: (input, signal) =>
    post(
      MATERIAL_ROUTES.uploads,
      input,
      materialRequestUploadResultSchema,
      signal,
    ),
  completeUpload: async (input, signal) =>
    toCompleteResult(
      await post(
        MATERIAL_ROUTES.complete,
        input,
        completeResponseSchema,
        signal,
      ),
    ),
  submitBatch: async (input) =>
    toSubmitResult(
      await post(MATERIAL_ROUTES.batches, input, batchSubmitResponseSchema),
    ),
  readBatch: (batchId) => readBatch({ batchId }),
};
