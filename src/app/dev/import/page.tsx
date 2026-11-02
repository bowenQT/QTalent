import { notFound } from 'next/navigation';
import { Shell } from '@/features/shell/Shell';
import { SampleImport } from './SampleImport';
import { sampleShell } from './samples';

export const metadata = { title: '面评导入 · Niu-Talent' };

/** Development-only sample of the interview import preview; production serves 404. */
export default function ImportSample() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Shell data={sampleShell}>
      <SampleImport />
    </Shell>
  );
}
