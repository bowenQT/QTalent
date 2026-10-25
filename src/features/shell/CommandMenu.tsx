'use client';
import { useEffect, useState } from 'react';
import type { ShellData } from '@/contracts/shell';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
export function CommandMenu({
  navigation,
  compact,
}: {
  navigation: ShellData['navigation'];
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  const results = navigation.filter((item) =>
    item.label.includes(query.trim()),
  );
  return (
    <>
      <button
        className={
          compact ? 'n-btn n-btn--ghost n-btn--icon' : 'n-search nt-search'
        }
        style={compact ? { marginLeft: 'auto' } : undefined}
        type="button"
        id="nt-cmdk-open"
        aria-label="搜人或项目（⌘K）"
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <Icon name="search" />
        {compact ? null : (
          <>
            <span>搜人、项目，或输入要做的事</span>
            <kbd>⌘K</kbd>
          </>
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="前往页面">
        <label className="n-field">
          <span className="n-field__label">页面名称</span>
          <input
            className="n-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <nav aria-label="页面入口" className="nt-grid">
          {results.map((item) => (
            <a className="n-navitem" key={item.id} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        {results.length === 0 ? <p>换个页面名称试试。</p> : null}
      </Dialog>
    </>
  );
}
