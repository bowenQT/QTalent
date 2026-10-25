'use client';
import { useEffect } from 'react';
/** The approved narrow shell is a horizontal nav; keep its active item visible. */
export function ShellViewport() {
  useEffect(() => {
    if (window.matchMedia('(max-width: 860px)').matches) {
      document
        .querySelector('.nt-side [aria-current="page"]')
        ?.scrollIntoView({ inline: 'center', block: 'nearest' });
    }
  }, []);
  return null;
}
