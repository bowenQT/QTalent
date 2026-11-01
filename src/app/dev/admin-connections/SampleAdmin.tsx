'use client';
import { AdminPage } from '@/features/admin/AdminPage';
import type { AdminTab } from '@/features/admin/tabs';
import type { RetryPort } from '@/features/admin/Connections';
import { sampleConnections, type SampleQuery } from './samples';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A scripted jobs retry: success with the next revision, or a conflict. */
const sampleRetry =
  (outcome: 'ok' | 'conflict'): RetryPort =>
  async (command) => {
    await wait(300);
    if (outcome === 'conflict') return { status: 'conflict' };
    return {
      status: 'success',
      snapshot: {
        schemaVersion: 1,
        jobId: command.jobId,
        kind: 'entry_task',
        status: 'queued',
        attempt: 2,
        revision: command.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
        progress: null,
        result: null,
        error: null,
        canRetry: false,
        canCancel: true,
        cancelRequestedAt: null,
      },
    };
  };

export function SampleAdmin({
  tab,
  query,
  retry,
}: {
  tab: AdminTab;
  query: SampleQuery;
  retry: 'ok' | 'conflict';
}) {
  return (
    <AdminPage
      tab={tab}
      connections={sampleConnections(query)}
      retry={query.pending ? null : sampleRetry(retry)}
      demo
    />
  );
}
