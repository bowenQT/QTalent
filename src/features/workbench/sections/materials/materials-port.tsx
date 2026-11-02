'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { MaterialFileInput } from '@/contracts/media';
import type { MaterialBatchReceipt } from '@/contracts/materials';

/**
 * One file's way into storage: upload grant, the transfer itself with progress, and
 * the completion check (BOW-873, `materialUploadRequestSchema` and
 * `completeUploadSchema`). `rejected` is the server's format or size answer and
 * the same file never goes again; `interrupted` may be retried with the same file.
 */
export type UploadOutcome =
  | { status: 'uploaded'; uploadId: string }
  | { status: 'rejected'; message: string }
  | { status: 'interrupted'; message: string };

export type SubmitOutcome =
  | { status: 'accepted'; receipt: MaterialBatchReceipt }
  | { status: 'interrupted'; message: string };

/**
 * The upload and batch backend (BOW-873 and the BOW-897 batch use cases). The
 * section is interactive only when a port is provided; without one it shows that
 * uploading is not connected and draws no tasks, counts or progress.
 */
export type MaterialsPort = {
  upload: (
    file: File,
    onProgress: (percent: number) => void,
    signal: AbortSignal,
  ) => Promise<UploadOutcome>;
  /** Same operationId on a retry, so the server replays instead of creating a second batch. */
  submit: (input: {
    operationId: string;
    files: MaterialFileInput[];
  }) => Promise<SubmitOutcome>;
  /** The current receipt snapshot; null when it cannot be read right now. */
  read: (batchId: string) => Promise<MaterialBatchReceipt | null>;
};

const PortContext = createContext<MaterialsPort | null>(null);

export function MaterialsPortProvider({
  port,
  children,
}: {
  port: MaterialsPort;
  children: ReactNode;
}) {
  return <PortContext.Provider value={port}>{children}</PortContext.Provider>;
}

export function useMaterialsPort() {
  return useContext(PortContext);
}
