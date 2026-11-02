import { z } from 'zod';
import { materialRequestUploadResultSchema } from '@/contracts/media';
import type { MaterialBatchSubmitResult } from '@/contracts/materials';
import { startRecordArrangeAction } from '@/server/actions/record-arrange';
import type {
  BatchSubmitResult,
  CollectionResult,
  CompleteResult,
  MaterialsTransport,
} from '@/features/workbench/sections/materials/live-port';
import { readBatch } from '../record/reads';

/** Same-origin entries for workbench material uploads. */
export const MATERIAL_ROUTES = {
  collections: '/api/record/uploads/collections',
  uploads: '/api/record/uploads',
  complete: '/api/record/uploads/complete',
};

const text = z.string().min(1);
const INTERRUPTED = '上传中断，可以重试';
const validationSchema = z.object({ status: z.literal('validation_error') });
const failureSchema = z.object({ status: text, message: text });

const collectionResponseSchema = z.union([
  z.object({
    status: z.literal('success'),
    recordCollectionId: text,
    evaluationNodeId: text,
  }),
  z.object({
    status: z.enum(['default_node_missing', 'default_node_ambiguous']),
  }),
  validationSchema,
  failureSchema,
]);

function toCollectionResult(
  result: z.infer<typeof collectionResponseSchema>,
): CollectionResult {
  if ('recordCollectionId' in result)
    return {
      status: 'ready',
      collection: {
        recordCollectionId: result.recordCollectionId,
        evaluationNodeId: result.evaluationNodeId,
      },
    };
  if (result.status === 'default_node_missing')
    return { status: 'node_missing' };
  if (result.status === 'default_node_ambiguous')
    return { status: 'node_ambiguous' };
  return {
    status: 'failed',
    message: 'message' in result ? result.message : INTERRUPTED,
  };
}

/** Success carries the staged upload; only its uploadId is used, never a jobId. */
const completeResponseSchema = z.union([
  z.object({
    status: z.literal('success'),
    result: z.object({ uploadId: text }),
  }),
  validationSchema,
  failureSchema,
]);

function toCompleteResult(
  result: z.infer<typeof completeResponseSchema>,
): CompleteResult {
  if ('result' in result)
    return { status: 'staged', uploadId: result.result.uploadId };
  return {
    status: 'failed',
    message: 'message' in result ? result.message : INTERRUPTED,
  };
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

/** A files-only batch: no text, people or project; the server picks the node. */
function toSubmitResult(result: MaterialBatchSubmitResult): BatchSubmitResult {
  switch (result.status) {
    case 'success':
      return { status: 'success', receipt: result.result };
    case 'validation_error':
      if (result.fieldErrors.evaluationNodeId)
        return { status: 'node_unresolved' };
      return {
        status: 'declined',
        message:
          result.fieldErrors.files?.[0] ?? '这批文件需要重新选择，再交一次',
      };
    default:
      return { status: 'declined', message: result.message };
  }
}

export const materialsTransport: MaterialsTransport = {
  openCollection: async (input) =>
    toCollectionResult(
      await post(MATERIAL_ROUTES.collections, input, collectionResponseSchema),
    ),
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
  submitBatch: async ({ operationId, files }) =>
    toSubmitResult(
      await startRecordArrangeAction({
        operationId,
        personIds: [],
        projectId: null,
        text: '',
        files,
      }),
    ),
  readBatch: (batchId) => readBatch({ batchId }),
};
