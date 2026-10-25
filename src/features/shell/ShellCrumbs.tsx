'use client';
import { usePathname } from 'next/navigation';
import type { ShellData } from '@/contracts/shell';
import { routeNav } from './route-nav';
import { useShellTitle } from './ShellTitle';
export function ShellCrumbs({
  navigation,
  isAdmin,
}: {
  navigation: ShellData['navigation'];
  isAdmin: boolean;
}) {
  const route = routeNav(navigation, usePathname(), isAdmin);
  const pageTitle = useShellTitle();
  const title = isAdmin ? route.title : (pageTitle ?? route.title);
  return (
    <nav className="nt-crumbs" aria-label="位置">
      {route.parent ? (
        <>
          <a href={route.parent.href}>{route.parent.label}</a>
          <span aria-hidden="true">/</span>
        </>
      ) : null}
      {title ? <b>{title}</b> : null}
    </nav>
  );
}
