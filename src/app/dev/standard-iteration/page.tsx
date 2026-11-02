import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import {
  SampleStandardIteration,
  type SampleQuery,
} from './SampleStandardIteration';
import { sampleRaters, sampleShell, type SampleRole } from './samples';

const roles: readonly SampleRole[] = ['hr', 'manager', 'rater'];
const seeds = ['fresh', 'pending', 'returned'] as const;
const ais = ['ok', 'fail', 'empty'] as const;

/**
 * Development-only walk of 判断对照 → 归因 → 起草 → 确认发布 on contract-shaped samples,
 * while BOW-918/919/921 are not on main. Production serves 404.
 */
export default async function StandardIterationSample({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = roles.find((item) => item === params.role);
  if (!role) notFound();
  const query: SampleQuery = {
    role,
    view: params.view === 'standard' ? 'standard' : 'judge',
    rater:
      params.rater && params.rater in sampleRaters
        ? (params.rater as SampleQuery['rater'])
        : null,
    seed: seeds.find((item) => item === params.seed) ?? null,
    ai: ais.find((item) => item === params.ai) ?? 'ok',
  };
  return (
    <Shell data={sampleShell(role)}>
      <SampleStandardIteration query={query} />
    </Shell>
  );
}
