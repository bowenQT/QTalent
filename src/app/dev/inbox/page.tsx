import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { SampleInbox } from './SampleInbox';
import { sampleRoles, sampleShell } from './samples';

export const metadata = { title: '待核对 · Niu-Talent' };

/** Development-only sample of 待核对 (`?role=hr|mentor`); production serves 404. */
export default async function InboxSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { role: wanted } = await searchParams;
  const role = sampleRoles.find((item) => item === wanted);
  if (!role) notFound();
  return (
    <Shell data={sampleShell(role)}>
      <SampleInbox role={role} />
    </Shell>
  );
}
