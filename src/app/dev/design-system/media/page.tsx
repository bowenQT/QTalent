import { notFound } from 'next/navigation';
import { MediaSamples } from './media-samples';

export default function MediaDesignSystem() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <main className="nt-body">
      <h1>设计系统 · 上传与长任务</h1>
      <p>
        样张按原型文案渲染，用于与设计系统页逐项对比。业务页面传本次范围的格式清单。
      </p>
      <MediaSamples />
    </main>
  );
}
