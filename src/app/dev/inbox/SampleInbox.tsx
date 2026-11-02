'use client';
import { useState } from 'react';
import { Inbox } from '@/features/inbox/Inbox';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { samplePorts } from './sample-ports';
import { sampleData, type SampleRole } from './samples';

/** The sample page with in-memory ports; a reload starts over. */
export function SampleInbox({ role }: { role: SampleRole }) {
  const [initial] = useState(() => sampleData(role));
  const [ports] = useState(() => samplePorts(initial));
  return (
    <>
      <ShellTitle title="待核对" />
      <Inbox initial={initial} ports={ports} />
    </>
  );
}
