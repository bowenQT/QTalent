import type { ReactNode } from 'react';
import { getShellForCurrentUser } from '@/server/queries/shell';
import { Shell } from '@/features/shell/Shell';
export default async function DeskLayout({
  children,
}: {
  children: ReactNode;
}) {
  const shell = await getShellForCurrentUser();
  return <Shell data={shell}>{children}</Shell>;
}
