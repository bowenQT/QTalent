'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { State } from '@/components/ui/State';
import { InterviewImport } from '@/features/interview-import/InterviewImport';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { restore, samplePorts, storageKey } from './sample-ports';
import { sampleBatch } from './samples';

// The stored rows are read once per page load; the ports keep them current afterwards.
const subscribe = () => () => {};

export function SampleImport() {
  // null on the server and while hydrating: sessionStorage exists only in the browser.
  const raw = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(storageKey(sampleBatch.id)) ?? '',
    () => null,
  );
  const ports = useMemo(
    () =>
      typeof window === 'undefined'
        ? null
        : samplePorts(sampleBatch, sessionStorage),
    [],
  );
  const batch = useMemo(
    () => (raw === null ? null : restore(sampleBatch, raw)),
    [raw],
  );
  return (
    <>
      <ShellTitle title="面评导入" />
      {batch && ports ? (
        <InterviewImport batch={batch} ports={ports} />
      ) : (
        <State kind="loading" title="面评读取中" />
      )}
    </>
  );
}
