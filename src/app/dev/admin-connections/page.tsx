import { notFound } from 'next/navigation';
import { adminTabOf } from '@/features/admin/tabs';
import { Shell } from '@/features/shell/Shell';
import { SampleAdmin } from './SampleAdmin';
import { sampleAdminShell, wecomSamples } from './samples';

/**
 * Development-only 系统管理 · 接入状态 on contract-shaped samples, while BOW-909/910/915
 * are not on main: ?wecom=on|down|never, ?empty=1, ?pending=1, ?retry=conflict.
 * Production serves 404.
 */
export default async function AdminConnectionsSample({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const wecom =
    params.wecom && params.wecom in wecomSamples
      ? (params.wecom as keyof typeof wecomSamples)
      : 'on';
  return (
    <Shell data={sampleAdminShell}>
      <SampleAdmin
        tab={adminTabOf(params.tab)}
        query={{
          wecom,
          empty: params.empty === '1',
          pending: params.pending === '1',
        }}
        retry={params.retry === 'conflict' ? 'conflict' : 'ok'}
      />
    </Shell>
  );
}
