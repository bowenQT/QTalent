import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { SampleRecord } from './SampleRecord';
import { sampleShell, type SampleRole, type SampleScene } from './samples';

const roles: readonly SampleRole[] = ['hr', 'mentor', 'manager'];
const scenes: readonly SampleScene[] = [
  'normal',
  'fail',
  'offline',
  'conflict',
  'selection',
];

export const metadata = { title: '记一件事 · Niu-Talent' };

/**
 * Development-only sample of the record page on a stand-in server; production serves
 * 404. `?role=` picks the viewer, `?scene=` a failure path; `?person=`, `?draft=work`
 * and `?job=` enter the page the way the real route will.
 */
export default async function RecordSample({
  searchParams,
}: {
  searchParams: Promise<{
    role?: string;
    scene?: string;
    person?: string;
    draft?: string;
    job?: string;
  }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = roles.find((item) => item === params.role);
  const scene = scenes.find((item) => item === (params.scene ?? 'normal'));
  if (!role || !scene) notFound();
  return (
    <Shell data={sampleShell(role)}>
      <SampleRecord
        key={`${role}:${scene}`}
        role={role}
        scene={scene}
        personId={params.person ?? null}
        handoff={params.draft === 'work'}
        jobId={params.job ?? null}
      />
    </Shell>
  );
}
