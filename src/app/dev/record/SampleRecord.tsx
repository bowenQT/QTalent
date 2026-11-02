'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RecordPage } from '@/features/record/RecordPage';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { sampleServer } from './sample-actions';
import {
  sampleAccount,
  sampleAnchors,
  sampleDimensions,
  samplePeople,
  sampleProjects,
  type SampleRole,
  type SampleScene,
} from './samples';

export function SampleRecord({
  role,
  scene,
  personId,
  handoff,
  jobId,
}: {
  role: SampleRole;
  scene: SampleScene;
  personId: string | null;
  handoff: boolean;
  jobId: string | null;
}) {
  const router = useRouter();
  const account = sampleAccount(role);
  const [people] = useState(() => samplePeople(role));
  // The server keeps jobs across reloads; sessionStorage exists only in the browser,
  // and nothing calls the server before hydration.
  const [server] = useState(() =>
    sampleServer({
      scene,
      accountId: account.id,
      people,
      storage: typeof window === 'undefined' ? undefined : sessionStorage,
    }),
  );
  return (
    <>
      <ShellTitle title="记一件事" />
      <RecordPage
        accountId={account.id}
        accountName={account.name}
        roleLabel={account.label}
        people={people}
        projects={sampleProjects}
        dimensions={sampleDimensions}
        actions={server.actions}
        readJob={server.readJob}
        loadAnchors={server.loadAnchors}
        idleAnchor={{ dimensionId: 'mot', set: sampleAnchors('mot') }}
        entry={{ personId, handoff, jobId: jobId ?? undefined }}
        demo
        showExample
        onJobChange={(id) => {
          // `?job=` only: the typed text never goes into the URL.
          const params = new URLSearchParams(window.location.search);
          if (id) params.set('job', id);
          else params.delete('job');
          params.delete('draft');
          router.replace(`?${params}`, { scroll: false });
        }}
      />
    </>
  );
}
