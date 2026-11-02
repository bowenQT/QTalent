import { notFound } from 'next/navigation';
import { SourceSamples } from './SourceSamples';

export default function SourcesDesignSystem() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="nt-body">
      <h1>设计系统 · 原件与提取对照</h1>
      <p>
        样张用合成的演示材料。点角标里的「查看原件」，打开查看器并定位到引用的那一处。
      </p>
      <SourceSamples />
    </main>
  );
}
