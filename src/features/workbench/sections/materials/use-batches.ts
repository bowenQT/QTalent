'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileSelection } from '@/components/ui/file-selection';
import type { MaterialsPort } from './materials-port';
import { settled, type Batch, type LocalFile } from './materials-model';

/** How often a processing receipt is read again. */
export const POLL_MS = 2000;

const newId = () => crypto.randomUUID();

/**
 * The batches dropped on this page. Every accepted file uploads on its own; once
 * no file is uploading or waiting for a retry, the uploaded ones go as one batch
 * and its receipt is read until it stops processing.
 */
export function useBatches(port: MaterialsPort | null) {
  const [batches, setBatches] = useState<Batch[]>([]);
  // Bumped when a read gives nothing new, so the next read is still scheduled.
  const [missed, setMissed] = useState(0);
  // Files kept for a retry, and transfers that can still be canceled.
  const files = useRef(new Map<string, File>());
  const transfers = useRef(new Map<string, AbortController>());
  // Guards against a second submission of the same batch from a repeated effect.
  const submitting = useRef(new Set<string>());

  const patchFile = useCallback(
    (batchId: string, clientFileId: string, next: LocalFile) =>
      setBatches((current) =>
        current.map((batch) =>
          batch.id === batchId
            ? {
                ...batch,
                files: batch.files.map((file) =>
                  file.clientFileId === clientFileId ? next : file,
                ),
              }
            : batch,
        ),
      ),
    [],
  );
  const patchBatch = useCallback(
    (batchId: string, change: (batch: Batch) => Batch) =>
      setBatches((current) =>
        current.map((batch) => (batch.id === batchId ? change(batch) : batch)),
      ),
    [],
  );

  const transfer = useCallback(
    (batchId: string, clientFileId: string) => {
      const file = files.current.get(clientFileId);
      if (!port || !file) return;
      const controller = new AbortController();
      transfers.current.set(clientFileId, controller);
      const base = { clientFileId, name: file.name };
      patchFile(batchId, clientFileId, {
        ...base,
        state: 'uploading',
        percent: 0,
      });
      const done = (next: LocalFile) => {
        if (controller.signal.aborted) return;
        transfers.current.delete(clientFileId);
        patchFile(batchId, clientFileId, next);
      };
      port
        .upload(
          file,
          (percent) => {
            if (!controller.signal.aborted)
              patchFile(batchId, clientFileId, {
                ...base,
                state: 'uploading',
                percent: Math.min(100, Math.max(0, Math.round(percent))),
              });
          },
          controller.signal,
        )
        .then(
          (outcome) => {
            if (outcome.status === 'uploaded')
              done({ ...base, state: 'uploaded', uploadId: outcome.uploadId });
            else if (outcome.status === 'rejected')
              done({ ...base, state: 'rejected', message: outcome.message });
            else
              done({ ...base, state: 'interrupted', message: outcome.message });
          },
          () =>
            done({
              ...base,
              state: 'interrupted',
              message: '连接中断，可以重试',
            }),
        );
    },
    [port, patchFile],
  );

  const add = useCallback(
    (selection: FileSelection) => {
      const total = selection.accepted.length + selection.rejected.length;
      if (!port || !total) return;
      const batchId = newId();
      const accepted = selection.accepted.map((file) => {
        const clientFileId = newId();
        files.current.set(clientFileId, file);
        return { clientFileId, file };
      });
      const batch: Batch = {
        id: batchId,
        title: `本次投递 · ${total} 个文件`,
        files: [
          ...accepted.map(({ clientFileId, file }): LocalFile => ({
            clientFileId,
            name: file.name,
            state: 'uploading',
            percent: 0,
          })),
          ...selection.rejected.map(({ file, message }): LocalFile => ({
            clientFileId: newId(),
            name: file.name,
            state: 'rejected',
            message,
          })),
        ],
        submission: { state: 'waiting' },
      };
      setBatches((current) => [batch, ...current]);
      for (const { clientFileId } of accepted) transfer(batchId, clientFileId);
    },
    [port, transfer],
  );

  const cancel = useCallback(
    (batchId: string, clientFileId: string) => {
      transfers.current.get(clientFileId)?.abort();
      transfers.current.delete(clientFileId);
      const file = files.current.get(clientFileId);
      files.current.delete(clientFileId);
      patchFile(batchId, clientFileId, {
        clientFileId,
        name: file?.name ?? '',
        state: 'canceled',
      });
    },
    [patchFile],
  );

  const retry = useCallback(
    (batchId: string, clientFileId: string) => transfer(batchId, clientFileId),
    [transfer],
  );

  const submit = useCallback(
    (batch: Batch, operationId: string) => {
      if (!port || submitting.current.has(batch.id)) return;
      const uploaded = batch.files.flatMap((file) =>
        file.state === 'uploaded'
          ? [{ clientFileId: file.clientFileId, uploadId: file.uploadId }]
          : [],
      );
      submitting.current.add(batch.id);
      patchBatch(batch.id, (current) => ({
        ...current,
        submission: { state: 'sending', operationId },
      }));
      const finish = (submission: Batch['submission']) => {
        submitting.current.delete(batch.id);
        patchBatch(batch.id, (current) => ({ ...current, submission }));
      };
      port.submit({ operationId, files: uploaded }).then(
        (outcome) =>
          finish(
            outcome.status === 'accepted'
              ? { state: 'sent', receipt: outcome.receipt }
              : { state: 'interrupted', operationId, message: outcome.message },
          ),
        () =>
          finish({
            state: 'interrupted',
            operationId,
            message: '连接中断，可以重新提交',
          }),
      );
    },
    [port, patchBatch],
  );

  const resubmit = useCallback(
    (batchId: string) => {
      const batch = batches.find((entry) => entry.id === batchId);
      if (batch?.submission.state === 'interrupted')
        submit(batch, batch.submission.operationId);
    },
    [batches, submit],
  );

  // A batch goes once every file has an outcome and at least one was uploaded;
  // with none uploaded it stays `waiting` and reads as ended (see batchState).
  useEffect(() => {
    for (const batch of batches)
      if (
        batch.submission.state === 'waiting' &&
        settled(batch.files) &&
        batch.files.some((file) => file.state === 'uploaded')
      )
        submit(batch, newId());
  }, [batches, submit]);

  // Processing receipts are read again until their status moves on.
  useEffect(() => {
    if (!port) return;
    const waiting = batches.flatMap((batch) =>
      batch.submission.state === 'sent' &&
      batch.submission.receipt.status === 'processing'
        ? [{ id: batch.id, batchId: batch.submission.receipt.batchId }]
        : [],
    );
    if (!waiting.length) return;
    let stopped = false;
    const timer = setTimeout(() => {
      for (const { id, batchId } of waiting)
        port.read(batchId).then(
          (receipt) => {
            if (stopped) return;
            if (!receipt) {
              setMissed((count) => count + 1);
              return;
            }
            patchBatch(id, (current) =>
              current.submission.state === 'sent' &&
              current.submission.receipt.revision <= receipt.revision
                ? { ...current, submission: { state: 'sent', receipt } }
                : current,
            );
          },
          () => {
            if (!stopped) setMissed((count) => count + 1);
          },
        );
    }, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [batches, missed, port, patchBatch]);

  // Leaving the page stops transfers; submitted batches keep going on the server.
  useEffect(() => {
    const running = transfers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  return { batches, add, cancel, retry, resubmit };
}
