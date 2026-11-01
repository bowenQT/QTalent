import type { NavigationId, ShellData } from '@/contracts/shell';

type NavEntry = ShellData['navigation'][number];

/**
 * Pages that are not in the navigation but belong to one of its entries. Keep to the
 * pages that exist; add a row here when a new sub-page needs its parent highlighted.
 */
const aliases: readonly {
  path: string;
  parent: NavigationId;
  /** Shown until the page supplies its own title (see ShellTitle). */
  title: string;
}[] = [{ path: '/person', parent: 'people', title: '人员档案' }];

/** Admin sessions never see business titles: the shell shows one fixed line. */
export const adminTitle = '这一页属于业务视角';

export type RouteNav = {
  /** The navigation entry to highlight, or null when no entry owns this path. */
  currentId: NavigationId | null;
  /** Breadcrumb tail; null when nothing matches. */
  title: string | null;
  /** Breadcrumb link to the parent entry, only for alias pages. */
  parent: { label: string; href: string } | null;
};

/** `/judge?rater=me#x` → `/judge`. */
export function hrefPath(href: string): string {
  return href.split(/[?#]/, 1)[0];
}

function owns(base: string, pathname: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * The current navigation entry and breadcrumb for a pathname: the entry whose path equals
 * it or is its longest parent segment prefix, or the entry an alias page belongs to.
 */
export function resolveRouteNav(
  navigation: readonly NavEntry[],
  pathname: string,
  isAdmin: boolean,
): RouteNav {
  const alias = aliases.find((entry) => owns(entry.path, pathname));
  let current: NavEntry | null = null;
  let length = -1;
  for (const entry of navigation) {
    const base = hrefPath(entry.href);
    if (owns(base, pathname) && base.length > length) {
      current = entry;
      length = base.length;
    }
  }
  if (alias) {
    const parent =
      navigation.find((entry) => entry.id === alias.parent) ?? null;
    return {
      currentId: parent?.id ?? null,
      title: isAdmin ? adminTitle : alias.title,
      parent:
        parent && !isAdmin
          ? { label: parent.label, href: hrefPath(parent.href) }
          : null,
    };
  }
  return {
    currentId: current?.id ?? null,
    title: isAdmin ? adminTitle : (current?.label ?? null),
    parent: null,
  };
}
