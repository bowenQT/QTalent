'use client';
import { useCallback, useState } from 'react';
import type { StaffingDemand } from '@/contracts/staffing';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { Staffing } from './Staffing';
import { livePorts } from './live-ports';
import type { ProjectHead } from './view';

/** Keeps the address on what the page shows, so a reload comes back to it. */
function keepInAddress(params: Record<string, string>) {
  window.history.replaceState(
    null,
    '',
    `/staffing?${new URLSearchParams(params).toString()}`,
  );
}

/**
 * The find-people page on real data for one project. The address holds the project and
 * either the drafting job (`job`) or the demand (`demand`); the sentence itself never
 * goes into the address.
 */
export function LiveStaffing({
  project,
  demand,
  resumeJobId,
  accountId,
  fromWorkbench,
}: {
  project: ProjectHead;
  demand: StaffingDemand | null;
  resumeJobId: string | null;
  accountId: string;
  fromWorkbench: boolean;
}) {
  const [ports] = useState(() => livePorts(project.id));
  const onJobStarted = useCallback(
    (jobId: string) => keepInAddress({ project: project.id, job: jobId }),
    [project.id],
  );
  const onDemandReady = useCallback(
    (ready: StaffingDemand) =>
      keepInAddress({ project: project.id, demand: ready.id }),
    [project.id],
  );
  return (
    <>
      <ShellTitle title="找人" />
      <Staffing
        project={project}
        demand={demand}
        resumeJobId={resumeJobId}
        accountId={accountId}
        fromWorkbench={fromWorkbench}
        ports={ports}
        onJobStarted={onJobStarted}
        onDemandReady={onDemandReady}
      />
    </>
  );
}
