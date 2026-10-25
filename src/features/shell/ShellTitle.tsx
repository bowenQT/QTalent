'use client';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
type TitleState = {
  title: string | null;
  setTitle: (title: string | null) => void;
};
const ShellTitleContext = createContext<TitleState | null>(null);
/** Holds the page-supplied crumb title. Neither the layout nor the shell
 * contract carries page data, so the page hands it over after it renders. */
export function ShellTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState<string | null>(null);
  const value = useMemo(() => ({ title, setTitle }), [title]);
  return <ShellTitleContext value={value}>{children}</ShellTitleContext>;
}
function useShellTitleState() {
  const context = useContext(ShellTitleContext);
  if (!context) throw new Error('ShellTitle 需要放在工作台外壳里使用');
  return context;
}
export const useShellTitle = () => useShellTitleState().title;
/**
 * Replaces the crumb tail with the visited object's name, e.g. a person page.
 * The server HTML keeps the route's fallback title and switches after
 * hydration; denied, missing and out-of-scope pages must not render this.
 */
export function ShellTitle({ title }: { title: string }) {
  const { setTitle } = useShellTitleState();
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [setTitle, title]);
  return null;
}
