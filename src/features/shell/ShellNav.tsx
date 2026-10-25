'use client';
import { usePathname } from 'next/navigation';
import type { NavigationId, ShellData } from '@/contracts/shell';
import { Icon, type IconName } from '@/components/ui/Icon';
import { routeNav } from './route-nav';
const icons: Record<NavigationId, IconName> = {
  work: 'home',
  people: 'users',
  review: 'layers',
  queue: 'check2',
  programs: 'book',
  projects: 'folder',
  rules: 'grid',
  judge: 'swap',
  tags: 'tag',
  admin: 'lock',
};
/** The desk layout stays mounted across routes, so the current entry follows
 * the client path instead of being fixed in the server HTML. */
export function ShellNav({
  navigation,
}: {
  navigation: ShellData['navigation'];
}) {
  const { active } = routeNav(navigation, usePathname(), false);
  const groups = [
    ...new Set(
      navigation
        .map((item) => item.group)
        .filter((group): group is string => group !== null),
    ),
  ];
  const item = (entry: ShellData['navigation'][number]) => (
    <a
      className="n-navitem"
      key={entry.id}
      data-nav={entry.id}
      href={entry.href}
      aria-current={entry.id === active ? 'page' : undefined}
    >
      <Icon name={icons[entry.id]} />
      {entry.label}
    </a>
  );
  return (
    <nav className="nt-nav">
      {navigation.filter((entry) => !entry.group).map(item)}
      {groups.map((group) => (
        <div
          className="nt-nav__grp"
          key={group}
          role="group"
          aria-label={group}
        >
          <span className="nt-nav__h" aria-hidden="true">
            {group}
          </span>
          {navigation.filter((entry) => entry.group === group).map(item)}
        </div>
      ))}
    </nav>
  );
}
