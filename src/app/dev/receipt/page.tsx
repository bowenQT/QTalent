import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { sampleShell, type SampleRole, type SampleScene } from './sample-data';
import { SampleReceipt } from './SampleReceipt';

const roles: readonly SampleRole[] = ['mentor', 'hr'];
const scenes: readonly SampleScene[] = [
  'normal',
  'processing',
  'conflict',
  'empty',
  'hidden',
];

export const metadata = {
  title: '回执 · 分镜工厂 · 二组 结营路演 · Niu-Talent',
};

/**
 * 回执页的开发样张，跑在服务端替身上；生产 404。`?role=` 选查看人（导师确认、HR 看别人的事），
 * `?scene=` 选处理中、保存冲突、没有整理出事、部分内容按权限隐藏。
 */
export default async function ReceiptSample({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; scene?: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const role = roles.find((item) => item === (params.role ?? 'mentor'));
  const scene = scenes.find((item) => item === (params.scene ?? 'normal'));
  if (!role || !scene) notFound();
  return (
    <Shell data={sampleShell(role)}>
      <SampleReceipt key={`${role}:${scene}`} role={role} scene={scene} />
    </Shell>
  );
}
