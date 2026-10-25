'use client';
import { useEffect } from 'react';
/** The narrow shell keeps the current route in the same reference position. */
export function ShellViewport({
  alignActiveToEnd = false,
}: {
  alignActiveToEnd?: boolean;
}) {
  useEffect(() => {
    if (!window.matchMedia('(max-width: 860px)').matches) return;
    const side = document.querySelector<HTMLElement>('.nt-side');
    const current = side?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView({
      inline: alignActiveToEnd ? 'end' : 'center',
      block: 'nearest',
    });
    if (alignActiveToEnd && side && current) {
      // The prototype's mentor list ends here. Keep its padded right alignment
      // while the newly authorized judgment entry remains reachable by scrolling.
      side.scrollLeft +=
        Number.parseFloat(getComputedStyle(side).paddingRight) || 0;
    }
  }, [alignActiveToEnd]);
  return null;
}
