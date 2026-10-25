'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const TitleContext = createContext<{
  title: string | null;
  setTitle: (title: string | null) => void;
} | null>(null);

/** Holds the breadcrumb tail a page supplies; the shell mounts it once. */
export function ShellTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <TitleContext value={value}>{children}</TitleContext>;
}

/** The title a page has supplied, or null while it supplies none. */
export function usePageTitle(): string | null {
  return useContext(TitleContext)?.title ?? null;
}

/**
 * Writes the visited object's name (for example a person) into the breadcrumb tail.
 * The server-rendered tail is the route's fallback title; the name replaces it after
 * hydration and the fallback returns when the page unmounts. Render it only on a page
 * the viewer may see, so an unauthorized or missing page never carries a name.
 */
export function ShellTitle({ title }: { title: string }) {
  const context = useContext(TitleContext);
  const setTitle = context?.setTitle;
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
  return null;
}
