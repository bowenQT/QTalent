'use client';
import { usePathname } from 'next/navigation';
import type { ShellData } from '@/contracts/shell';
import { resolveRouteNav } from './route-nav';
import { usePageTitle } from './ShellTitle';

/** Breadcrumb that follows the route; the page may replace its tail via ShellTitle. */
export function ShellCrumbs({
  navigation,
  isAdmin,
}: {
  navigation: ShellData['navigation'];
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const route = resolveRouteNav(navigation, pathname, isAdmin);
  const pageTitle = usePageTitle();
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
