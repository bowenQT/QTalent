import type { ReactNode } from 'react';
import { getShellPage } from '@/server/queries/shell';
import { AccessDenied } from '@/features/shell/AccessDenied';
import { Shell } from '@/features/shell/Shell';
export default async function DeskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const shell = await getShellPage();
  if (!shell)
    return (
      <main>
        <AccessDenied />
      </main>
    );
  return <Shell data={shell}>{children}</Shell>;
}
