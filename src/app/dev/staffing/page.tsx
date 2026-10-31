import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { SampleStaffing } from './SampleStaffing';
import { sampleShell, type SampleRole, type SampleScene } from './samples';

const roles: readonly SampleRole[] = ['manager', 'hr'];
const scenes: readonly SampleScene[] = ['ts', 'agent', 'new'];

/** Development-only sample of the find-people page; production serves 404. */
export default async function StaffingSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; scene?: string; draft?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = roles.find((item) => item === params.role);
  const scene = scenes.find((item) => item === params.scene);
  if (!role || !scene) notFound();
  const shell = sampleShell(role);
  return (
    <Shell data={shell}>
      <SampleStaffing
        scene={scene}
        accountId={shell.account.id}
        actor={{ id: shell.account.id, name: shell.account.name }}
        fromWorkbench={params.draft === 'work'}
      />
    </Shell>
  );
}
