'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordJobSchema, type RecordArrangeResult } from '@/contracts/record';
import {
  readJobSnapshot,
  subscribeToJob,
  type JobSubscriptionState,
} from '@/lib/job-subscription';
import type { RecordJob } from './types';

export type ReadRecordJob = (
  jobId: string,
  signal: AbortSignal,
) => Promise<RecordJob>;

// 读取时按 recordJobSchema 校验，kind 一定是 record_organize
const readFromApi: ReadRecordJob = async (jobId, signal) =>
  (await readJobSnapshot(jobId, signal, recordJobSchema)) as RecordJob;

type State = JobSubscriptionState<RecordArrangeResult>;
const idle: State = { snapshot: null, stale: false, connection: 'loading' };

/**
 * 订阅一个整理任务的快照：成功每秒读取，失败退避重试；回到前台或恢复联网立即重读。
 * 卸载时只取消订阅，不取消服务端任务。jobId 为 null 时不订阅。
 * 终态（失败、等待人工）读取会停止，重试成功后调用 refresh 才会重新读取。
 */
export function useRecordJob(
  jobId: string | null,
  read: ReadRecordJob = readFromApi,
) {
  const [keyed, setKeyed] = useState<{ jobId: string; state: State } | null>(
    null,
  );
  const handle = useRef<ReturnType<typeof subscribeToJob> | null>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  });
  useEffect(() => {
    if (!jobId) return;
    const subscription = subscribeToJob<RecordArrangeResult>({
      jobId,
      read: (id, signal) => readRef.current(id, signal),
      onChange: (state) => setKeyed({ jobId, state }),
      lifecycle: { online: window, visibility: document },
    });
    handle.current = subscription;
    return () => {
      subscription.unsubscribe();
      if (handle.current === subscription) handle.current = null;
    };
  }, [jobId]);
  const refresh = useCallback(() => handle.current?.refresh(), []);
  const state = keyed && keyed.jobId === jobId ? keyed.state : idle;
  return {
    // 读取时已经过 recordJobSchema 校验
    snapshot: state.snapshot as RecordJob | null,
    stale: state.stale,
    connection: state.connection,
    refresh,
  };
}
