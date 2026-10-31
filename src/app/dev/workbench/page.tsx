import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { Workbench } from '@/features/workbench/Workbench';
import type { WorkbenchRole } from '@/features/workbench/view';
import { sampleShell, sampleViews } from './samples';

const roles: readonly WorkbenchRole[] = ['manager', 'hr', 'mentor'];

/** Development-only sample of the workbench sections; production serves 404. */
export default async function WorkbenchSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { role } = await searchParams;
  const current = roles.find((item) => item === role);
  if (!current) notFound();
  return (
    <Shell data={sampleShell(current)}>
      <Workbench view={sampleViews[current]} />
    </Shell>
  );
}
