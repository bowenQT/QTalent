import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { Workbench } from '@/features/workbench/Workbench';
import type { WorkbenchRole } from '@/features/workbench/view';
import { sampleShell, sampleViews } from './samples';
import { SampleExport } from './SampleExport';
import { SampleMaterials } from './SampleMaterials';

const roles: readonly WorkbenchRole[] = ['manager', 'hr', 'mentor'];

/** Development-only sample of the workbench sections; production serves 404. */
export default async function WorkbenchSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; export?: string; upload?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { role, export: exportRun, upload } = await searchParams;
  const current = roles.find((item) => item === role);
  if (!current) notFound();
  const view = sampleViews[current];
  return (
    <Shell data={sampleShell(current)}>
      <SampleExport
        failFirst={exportRun === 'fail'}
        scopes={
          view.exportable.status === 'ready' ? view.exportable.data.scopes : []
        }
      >
        <SampleMaterials failFirst={upload === 'fail'}>
          <Workbench view={view} />
        </SampleMaterials>
      </SampleExport>
    </Shell>
  );
}
