import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/styles/globals.css';
import { IconSprite } from '@/components/ui/Icon';
export const metadata: Metadata = {
  title: 'Niu-Talent',
  description: '人才识别、追踪与盘点',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="nt-desk">
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
