'use client';
import { useState } from 'react';
import type { StaffingDemand } from '@/contracts/staffing';
import { ShellTitle } from '@/features/shell/ShellTitle';
import { Staffing } from '@/features/staffing/Staffing';
import type { ProjectHead } from '@/features/staffing/view';
import { samplePorts } from './sample-ports';
import { samplePages, sampleProjects, type SampleScene } from './samples';

export function SampleStaffing({
  scene,
  accountId,
  actor,
  fromWorkbench,
}: {
  scene: SampleScene;
  accountId: string;
  actor: { id: string; name: string };
  fromWorkbench: boolean;
}) {
  const [ports] = useState(() => samplePorts(scene, actor));
  const [opened, setOpened] = useState<{
    project: ProjectHead;
    demand: StaffingDemand;
  } | null>(() =>
    scene === 'new'
      ? null
      : { project: sampleProjects[scene], demand: samplePages[scene].demand },
  );
  return (
    <>
      <ShellTitle title="找人" />
      <Staffing
        // The real page navigates to the project once the card exists; here it remounts.
        key={opened ? opened.demand.id : 'entry'}
        project={opened?.project ?? null}
        demand={opened?.demand ?? null}
        accountId={accountId}
        fromWorkbench={fromWorkbench}
        ports={ports}
        onDemandReady={(demand) =>
          setOpened({ project: sampleProjects.new, demand })
        }
      />
    </>
  );
}
