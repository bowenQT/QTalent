import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { SamplePrint } from './SamplePrint';
import {
  sampleShell,
  type SampleMode,
  type SamplePerson,
  type SampleRole,
} from './samples';

const roles: readonly SampleRole[] = ['manager', 'hr', 'mentor'];
const people: readonly SamplePerson[] = ['x07', 'x03'];
const modes: readonly SampleMode[] = ['ok', 'deny', 'fail', 'live'];

export const metadata = { title: '打印档案 · Niu-Talent' };

/**
 * Development-only sample of the profile print (BOW-911); production serves 404.
 * `?print=deny|fail|live` shows a refusal, a lost print, or the real ports (not connected).
 */
export default async function PersonPrintSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; person?: string; print?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = roles.find((item) => item === params.role);
  const person = people.find((item) => item === (params.person ?? 'x07'));
  const mode = modes.find((item) => item === (params.print ?? 'ok'));
  if (!role || !person || !mode) notFound();
  return (
    <Shell data={sampleShell(role)}>
      <SamplePrint person={person} role={role} mode={mode} />
    </Shell>
  );
}
