'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { NavigationId } from '@/contracts/shell';
/** The narrow shell keeps the current route in the same reference position. */
export function ShellViewport({
  alignEndNav = null,
}: {
  alignEndNav?: NavigationId | null;
}) {
  const pathname = usePathname();
  useEffect(() => {
    if (!window.matchMedia('(max-width: 860px)').matches) return;
    const side = document.querySelector<HTMLElement>('.nt-side');
    const current = side?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!side || !current) return;
    const alignEnd = current.dataset.nav === alignEndNav;
    current.scrollIntoView({
      inline: alignEnd ? 'end' : 'center',
      block: 'nearest',
    });
    if (alignEnd) {
      // The prototype's mentor list ends here. Keep its padded right alignment
      // while the newly authorized judgment entry remains reachable by scrolling.
      side.scrollLeft +=
        Number.parseFloat(getComputedStyle(side).paddingRight) || 0;
    }
  }, [alignEndNav, pathname]);
  return null;
}
