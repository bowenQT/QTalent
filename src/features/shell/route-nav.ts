import type { NavigationId, ShellData } from '@/contracts/shell';
type NavItem = ShellData['navigation'][number];
/** Child routes outside the navigation that belong to a navigation entry.
 * Mirrors the prototype page config (`nav`, fallback `title`, parent crumb). */
export const routeAliases: readonly {
  path: string;
  nav: NavigationId;
  title: string;
}[] = [{ path: '/person', nav: 'people', title: '人员档案' }];
export const ADMIN_TITLE = '这一页属于业务视角';
export type RouteNav = {
  active: NavigationId | null;
  parent: { label: string; href: string } | null;
  title: string | null;
};
export const hrefPath = (href: string) => href.split(/[?#]/, 1)[0]!;
const covers = (path: string, pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`);
/** Current navigation entry and crumbs, derived from the path alone. */
export function routeNav(
  navigation: readonly NavItem[],
  pathname: string,
  isAdmin: boolean,
): RouteNav {
  const alias = routeAliases.find((entry) => covers(entry.path, pathname));
  const item = alias
    ? navigation.find((entry) => entry.id === alias.nav)
    : navigation
        .filter((entry) => covers(hrefPath(entry.href), pathname))
        .sort((a, b) => hrefPath(b.href).length - hrefPath(a.href).length)[0];
  const active = item?.id ?? null;
  if (isAdmin) return { active, parent: null, title: ADMIN_TITLE };
  if (alias)
    return {
      active,
      parent: item ? { label: item.label, href: item.href } : null,
      title: alias.title,
    };
  return { active, parent: null, title: item?.label ?? null };
}
