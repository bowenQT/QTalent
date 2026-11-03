import {
  MEDIA_FORMATS,
  type MaterialFileInput,
  type MaterialRequestUploadResult,
  type MaterialUploadRequest,
} from '@/contracts/media';
import type {
  MaterialBatchReadResult,
  MaterialBatchReceipt,
} from '@/contracts/materials';
import { uploadToKodo } from './kodo-upload';
import type {
  MaterialsPort,
  PrepareOutcome,
  SubmitOutcome,
  UploadCollection,
  UploadOutcome,
} from './materials-port';

/** A file's upload declaration, staged unassigned in the batch's collection. */
export type UploadDeclaration = Omit<MaterialUploadRequest, 'target'> & {
  target: { kind: 'unassigned'; evaluationNodeId: string };
};

/**
 * Opening a batch's upload collection. The server picks the uploader's evaluation
 * node in progress; `node_missing` is none, `node_ambiguous` several at once.
 */
export type CollectionResult =
  | { status: 'ready'; collection: UploadCollection }
  | { status: 'node_missing' }
  | { status: 'node_ambiguous' }
  | { status: 'failed'; message: string };

/**
 * Batch submission answer from /work: the batch receipt, or why the server
 * declined it. `node_unresolved` is the server finding no single evaluation node
 * in progress to attach the batch to.
 */
export type BatchSubmitResult =
  | { status: 'success'; receipt: MaterialBatchReceipt }
  | { status: 'node_unresolved' }
  | { status: 'declined'; message: string };

/**
 * Completion of an unassigned upload: the file is staged under `uploadId`, which
 * the batch then names. Staging starts no processing job of its own.
 */
export type CompleteResult =
  | { status: 'staged'; uploadId: string }
  | { status: 'failed'; message: string };

/**
 * Server calls behind the live port, already parsed at the network boundary.
 * A rejected promise is a transport failure (offline, timeout, signed out).
 */
export type MaterialsTransport = {
  openCollection: (input: { operationId: string }) => Promise<CollectionResult>;
  requestUpload: (
    input: UploadDeclaration,
    signal: AbortSignal,
  ) => Promise<MaterialRequestUploadResult>;
  completeUpload: (
    input: {
      uploadId: string;
      receiptRef: string;
      operationId: string;
      expectedRevision: number;
    },
    signal: AbortSignal,
  ) => Promise<CompleteResult>;
  submitBatch: (input: {
    operationId: string;
    files: MaterialFileInput[];
  }) => Promise<BatchSubmitResult>;
  readBatch: (batchId: string) => Promise<MaterialBatchReadResult>;
};

const INTERRUPTED = '上传中断，可以重试';
const SUBMIT_INTERRUPTED = '提交中断，可以重新提交';
export const NODE_MISSING = '评价节点开始后，再把这批材料交上来';
export const NODE_AMBIGUOUS =
  '有几个评价节点同时进行中，请联系 HR 确认这批材料归哪一个';
export const NODE_UNRESOLVED =
  '这批材料要归到一个进行中的评价节点，请联系 HR 确认';

/** The declared type the server accepts for this file name, or null for an unknown format. */
export function declare(file: File) {
  const name = file.name.toLowerCase();
  const format = MEDIA_FORMATS.find((entry) =>
    name.endsWith(`.${entry.extension}`),
  );
  if (!format) return null;
  const types: readonly string[] = format.mediaTypes;
  const type = file.type.toLowerCase();
  return {
    purpose: format.purpose,
    declaredMediaType: types.includes(type) ? type : types[0]!,
  };
}

/**
 * The materials port over the real backend: the batch's upload collection, then
 * per file the upload grant, direct transfer to Kodo and completion check; batch
 * submission and receipt reads. A file's grant and completion get a new
 * operationId per attempt; the collection's and the batch's come from the caller,
 * which keeps them across retries so the server replays them.
 */
export function createLiveMaterialsPort(
  transport: MaterialsTransport,
  fetcher: typeof fetch = fetch,
): MaterialsPort {
  async function prepare(operationId: string): Promise<PrepareOutcome> {
    try {
      const result = await transport.openCollection({ operationId });
      switch (result.status) {
        case 'ready':
          return result;
        case 'node_missing':
          return { status: 'refused', message: NODE_MISSING };
        case 'node_ambiguous':
          return { status: 'refused', message: NODE_AMBIGUOUS };
        case 'failed':
          return { status: 'interrupted', message: result.message };
      }
    } catch {
      return { status: 'interrupted', message: INTERRUPTED };
    }
  }

  async function upload(
    file: File,
    collection: UploadCollection,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ): Promise<UploadOutcome> {
    const declared = declare(file);
    if (!declared)
      return {
        status: 'rejected',
        message: '请上传 MP3、M4A、WAV、AAC、TXT、DOCX 或文字型 PDF',
      };
    try {
      const granted = await transport.requestUpload(
        {
          ...declared,
          recordCollectionId: collection.recordCollectionId,
          target: {
            kind: 'unassigned',
            evaluationNodeId: collection.evaluationNodeId,
          },
          filename: file.name,
          declaredBytes: file.size,
          operationId: crypto.randomUUID(),
        },
        signal,
      );
      if (
        granted.status === 'unsupported' ||
        granted.status === 'validation_error'
      )
        return {
          status: 'rejected',
          message:
            granted.status === 'unsupported'
              ? granted.message
              : '请上传 MP3、M4A、WAV、AAC、TXT、DOCX 或文字型 PDF',
        };
      if (granted.status !== 'success')
        return { status: 'interrupted', message: granted.message };
      const grant = granted.upload;
      const stored = await uploadToKodo(
        grant,
        file,
        declared.declaredMediaType,
        onProgress,
        signal,
        fetcher,
      );
      if (stored.status !== 'stored')
        return { status: 'interrupted', message: INTERRUPTED };
      const completed = await transport.completeUpload(
        {
          uploadId: grant.uploadId,
          receiptRef: stored.hash,
          operationId: crypto.randomUUID(),
          expectedRevision: grant.revision,
        },
        signal,
      );
      return completed.status === 'staged'
        ? { status: 'uploaded', uploadId: completed.uploadId }
        : { status: 'interrupted', message: completed.message };
    } catch {
      return { status: 'interrupted', message: INTERRUPTED };
    }
  }

  async function submit(input: {
    operationId: string;
    files: MaterialFileInput[];
  }): Promise<SubmitOutcome> {
    try {
      const result = await transport.submitBatch(input);
      switch (result.status) {
        case 'success':
          return { status: 'accepted', receipt: result.receipt };
        case 'node_unresolved':
          return { status: 'refused', message: NODE_UNRESOLVED };
        case 'declined':
          return { status: 'refused', message: result.message };
      }
    } catch {
      return { status: 'interrupted', message: SUBMIT_INTERRUPTED };
    }
  }

  async function read(batchId: string) {
    try {
      const result = await transport.readBatch(batchId);
      return result.status === 'success' ? result.result : null;
    } catch {
      return null;
    }
  }

  return { prepare, upload, submit, read };
}
