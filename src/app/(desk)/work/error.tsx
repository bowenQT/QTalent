'use client';
import { State } from '@/components/ui/State';
import { Button } from '@/components/ui/Button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <State title="加载失败" text="请重试。">
      <Button onClick={reset}>重新加载</Button>
    </State>
  );
}
