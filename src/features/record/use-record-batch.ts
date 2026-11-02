'use client';
import { useEffect, useRef, useState } from 'react';
import type { BatchReceipt, RecordActions } from './types';

export const POLL_MS = 1_000;
const MAX_BACKOFF_MS = 10_000;

export type BatchConnection = 'loading' | 'connected' | 'error' | 'gone';

/**
 * 整理进行中轮询 897 批次回执：成功每秒读一次，读到不再处理中就停；
 * 失败退避重试，回到前台或恢复联网立即重读。批次不存在或不可见时停在 gone。
 * 897 写进任务快照的是批次元数据，不是整理结果，所以进度只从批次回执读（#248 6564975460）。
 */
export function useRecordBatch(
  batchId: string | null,
  readBatch: RecordActions['readBatch'],
) {
  const [state, setState] = useState<{
    batchId: string;
    receipt: BatchReceipt | null;
    connection: BatchConnection;
  } | null>(null);
  const readRef = useRef(readBatch);
  useEffect(() => {
    readRef.current = readBatch;
  });
  useEffect(() => {
    if (!batchId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let inFlight = false;
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void read(), ms);
    };
    const read = async () => {
      if (!live || inFlight) return;
      inFlight = true;
      try {
        const result = await readRef.current({ batchId });
        if (!live) return;
        if (result.status !== 'success') {
          setState((prev) => ({
            batchId,
            receipt: prev?.batchId === batchId ? prev.receipt : null,
            connection: 'gone',
          }));
          return;
        }
        failures = 0;
        setState({ batchId, receipt: result.result, connection: 'connected' });
        if (result.result.status === 'processing') schedule(POLL_MS);
      } catch {
        if (!live) return;
        failures += 1;
        setState((prev) => ({
          batchId,
          receipt: prev?.batchId === batchId ? prev.receipt : null,
          connection: 'error',
        }));
        schedule(Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures));
      } finally {
        inFlight = false;
      }
    };
    const wake = () => {
      if (document.visibilityState === 'visible' && failures > 0) void read();
    };
    void read();
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [batchId]);
  const current = state && state.batchId === batchId ? state : null;
  return {
    receipt: current?.receipt ?? null,
    connection: current?.connection ?? ('loading' as BatchConnection),
  };
}
