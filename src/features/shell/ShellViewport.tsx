'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { NavigationId } from '@/contracts/shell';

/**
 * The narrow shell keeps the current route in the same reference position: centred like
 * the prototype, except that the entry named by `endNavId` sits at the padded right edge
 * (the prototype's mentor list ends with it). Runs again whenever the route changes.
 */
export function ShellViewport({ endNavId }: { endNavId?: NavigationId }) {
  const pathname = usePathname();
  useEffect(() => {
    if (!window.matchMedia('(max-width: 860px)').matches) return;
    const side = document.querySelector<HTMLElement>('.nt-side');
    const current = side?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!side || !current) return;
    const atEnd = endNavId !== undefined && current.dataset.nav === endNavId;
    current.scrollIntoView({
      inline: atEnd ? 'end' : 'center',
      block: 'nearest',
    });
    if (atEnd) {
      // Keep the padded right alignment while the entries after it (such as the
      // newly authorized judgment entry) stay reachable by scrolling.
      side.scrollLeft +=
        Number.parseFloat(getComputedStyle(side).paddingRight) || 0;
    }
  }, [pathname, endNavId]);
  return null;
}
